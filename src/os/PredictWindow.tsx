/* ============================================================
   PREDICT.EXE — two live prediction markets inside the CRT.
   One Polymarket market + one Kalshi market, same window system
   as every other .EXE (Panel, telemetry, confirm dialogs).
   No new design language. No mock data — every number is live.
   Order flow per spec: OPEN → YES/NO → BUY → PRICE/AMOUNT →
   PREVIEW → CONFIRM → SIGN → order id → status → fills → positions.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Address } from 'viem'
import { useEvmWallet } from '../wallets/EvmWallet'
import { Panel } from '../design/ui'
import { SystemDialog } from '../design/SystemDialog'
import { blocks, shortAddr } from '../lib/format'
import { play } from '../sound/sfx'
import { addChainParams, evmChain } from '../lib/swap/chains'
import {
  KalshiProvider,
  getKalshiExchangeStatus,
  mapKalshiError,
} from '../lib/predict/kalshi'
import { setKalshiDemo as setKalshiDemoMode } from '../lib/predict/kalshi'
import {
  POLY_EXCHANGE,
  POLY_USDC,
  PolymarketProvider,
  bookTops,
  derivePolyCreds,
  mapPolyError,
  polyAllowance,
  polyExchangeFor,
  polyIsNegRisk,
  polyUsdcBalance,
} from '../lib/predict/polymarket'
import type {
  KalshiAuth,
  NormalizedOrder,
  PolyAuth,
  PredictBook,
  PredictPosition,
  PredictProvider,
  PredictVenueId,
  PredictionMarket,
} from '../lib/predict/types'
import { fmtCents, fmtTime, fmtUsd2 } from '../lib/predict/types'

type Phase = 'idle' | 'loading' | 'ready' | 'signing' | 'sending' | 'success' | 'error'

const PROVIDERS: Record<PredictVenueId, PredictProvider> = {
  polymarket: PolymarketProvider as unknown as PredictProvider,
  kalshi: KalshiProvider as unknown as PredictProvider,
}

const LS_POLY = 'crt86.poly.creds.v1'
const LS_POLY_ADDR = 'crt86.poly.addr.v1'
const LS_KALSHI = 'crt86.kalshi.creds.v1'

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function BookTable({ book, outcome }: { book: PredictBook | null; outcome: 'YES' | 'NO' }) {
  if (!book) return <span className="faint" style={{ fontSize: 14 }}>BOOK —</span>
  const bids = outcome === 'YES' ? book.yesBids : book.noBids
  const asks = outcome === 'YES' ? book.yesAsks : book.noAsks
  const rows = Math.max(bids.length, asks.length, 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14 }}>
      <div className="stat-row"><span className="sk">BID × ASK</span><span className="sv">{outcome}</span></div>
      {Array.from({ length: Math.min(rows, 5) }).map((_, i) => (
        <div className="stat-row" key={i}>
          <span className="sk" style={{ color: 'var(--green)' }}>{bids[i] ? `${fmtCents(bids[i].price)} × ${bids[i].size}` : '—'}</span>
          <span className="sv" style={{ color: 'var(--red)' }}>{asks[i] ? `${fmtCents(asks[i].price)} × ${asks[i].size}` : '—'}</span>
        </div>
      ))}
    </div>
  )
}

export function PredictWindow() {
  const nav = useNavigate()
  const evm = useEvmWallet()

  const [venue, setVenue] = useState<PredictVenueId>('polymarket')
  const provider = PROVIDERS[venue]

  const [market, setMarket] = useState<PredictionMarket | null>(null)
  const [book, setBook] = useState<PredictBook | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<string[]>([])

  const [detailOpen, setDetailOpen] = useState(false)
  const [outcome, setOutcome] = useState<'YES' | 'NO'>('YES')
  const [isMarket, setIsMarket] = useState(true)
  const [amount, setAmount] = useState('') // USD (poly market) or contracts (kalshi/limit)
  const [limitPx, setLimitPx] = useState('') // cents, limit only
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [lastOrder, setLastOrder] = useState<NormalizedOrder | null>(null)

  const [balance, setBalance] = useState<number | null>(null)
  const [positions, setPositions] = useState<PredictPosition[]>([])
  const [orders, setOrders] = useState<NormalizedOrder[]>([])

  // Poly auth (browser-held API creds, revocable)
  const [polyAddr, setPolyAddr] = useState<string | null>(() => localStorage.getItem(LS_POLY_ADDR))
  const [polyCreds, setPolyCreds] = useState<PolyAuth['creds'] | null>(() => loadJson(LS_POLY))
  const [polySessionOnly, setPolySessionOnly] = useState(false)
  const [usdcBal, setUsdcBal] = useState<number | null>(null)
  const [allowOk, setAllowOk] = useState<boolean | null>(null)
  const [manualKey, setManualKey] = useState('')
  const [manualSecret, setManualSecret] = useState('')
  const [manualPass, setManualPass] = useState('')
  // Kalshi auth (per-request server signing; browser holds key material)
  const [kalshiDemo, setKalshiDemo] = useState(true)
  const [kalshiKeyId, setKalshiKeyId] = useState('')
  const [kalshiPem, setKalshiPem] = useState('')
  const [kalshiSaved, setKalshiSaved] = useState(false)
  const [kalshiRemember, setKalshiRemember] = useState(false)
  const [exchangeStatus, setExchangeStatus] = useState<'open' | 'paused' | 'unknown'>('unknown')

  const busy = useRef(false)
  const log = useCallback((l: string) => {
    setTelemetry((s) => [...s.slice(-24), `[${new Date().toLocaleTimeString()}] ${l}`])
  }, [])

  /* ---------- discovery (one market per venue) ---------- */
  const discover = useCallback(async () => {
    setPhase('loading')
    setErr(null)
    setMarket(null)
    setBook(null)
    setLastOrder(null)
    log(`DISCOVERING ${provider.label} MARKET…`)
    try {
      const m = await provider.discoverMarket()
      setMarket(m)
      setPhase('ready')
      play('coin')
      log(`FOUND ${m.title.slice(0, 60)}`)
      if (m.status !== 'open') {
        setErr(`Market is ${m.status.toUpperCase()} — trading disabled.`)
        setPhase('error')
      }
    } catch (e) {
      const msg = String((e as Error).message ?? e)
      setErr(msg.slice(0, 250))
      setPhase('error')
      play('error')
      log('DISCOVERY FAILED — ' + msg.slice(0, 100))
    }
  }, [provider, log])

  useEffect(() => {
    void discover()
  }, [discover])

  /* ---------- book refresh (8s poll; Poly WS upgrade where trivially safe) ---------- */
  const refreshBook = useCallback(async () => {
    if (!market) return
    try {
      const b = await provider.getOrderBook(market)
      setBook(b)
      const tops = venue === 'polymarket' ? bookTops(b as PredictBook) : null
      if (tops) {
        setMarket((m) => (m ? { ...m, ...tops } : m))
      } else {
        // kalshi: refresh market snapshot for prices
        const fresh = await provider.getMarket(market.marketId)
        setMarket(fresh)
        const bb = await provider.getOrderBook(fresh)
        setBook(bb)
      }
    } catch (e) {
      log('BOOK REFRESH FAILED — ' + String((e as Error).message ?? e).slice(0, 80))
    }
  }, [market, provider, venue, log])

  useEffect(() => {
    if (!market || market.status !== 'open') return
    void refreshBook()
    const iv = window.setInterval(() => void refreshBook(), 8000)
    return () => window.clearInterval(iv)
  }, [market?.marketId, venue]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Poly market WS (public channel, no creds) ---------- */
  useEffect(() => {
    if (venue !== 'polymarket' || !market?.ref.yesToken) return
    let dead = false
    let ws: WebSocket | null = null
    try {
      ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market')
    } catch {
      return
    }
    ws.onopen = () => {
      if (dead) return
      ws?.send(JSON.stringify({ assets_ids: [market.ref.yesToken, market.ref.noToken].filter(Boolean), type: 'market' }))
    }
    ws.onmessage = (ev) => {
      if (dead) return
      try {
        const j = JSON.parse(String(ev.data)) as { event_type?: string }
        if (j?.event_type === 'book' || j?.event_type === 'price_change') void refreshBook()
      } catch {
        /* ignore */
      }
    }
    return () => {
      dead = true
      try {
        ws?.close()
      } catch {
        /* ignore */
      }
    }
  }, [venue, market?.marketId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- auth resolution ---------- */
  useEffect(() => {
    const saved = loadJson<{ keyId: string; pem: string; demo: boolean }>(LS_KALSHI)
    if (saved?.keyId && saved?.pem) {
      setKalshiKeyId(saved.keyId)
      setKalshiPem(saved.pem)
      setKalshiDemo(saved.demo !== false)
      setKalshiSaved(true)
    }
  }, [])

  const polyAuth: PolyAuth | null =
    venue === 'polymarket' && polyAddr && polyCreds ? { address: polyAddr, creds: polyCreds } : null
  const kalshiAuth: KalshiAuth | null =
    venue === 'kalshi' && kalshiSaved && kalshiKeyId.trim() && kalshiPem.includes('PRIVATE KEY')
      ? { keyId: kalshiKeyId.trim(), pem: kalshiPem, demo: kalshiDemo }
      : null

  /* ---------- account data ---------- */
  const refreshAccount = useCallback(async () => {
    const auth = venue === 'polymarket' ? polyAuth : kalshiAuth
    if (!auth || !market) {
      setBalance(null)
      setPositions([])
      setOrders([])
      return
    }
    try {
      const [bal, pos, ord] = await Promise.all([
        provider.getBalance(auth).catch(() => ({ provider: venue, available: null })),
        provider.getPositions(auth, market).catch(() => []),
        provider.getOrders(auth, market).catch(() => []),
      ])
      setBalance(bal.available)
      setPositions(pos)
      setOrders(ord as NormalizedOrder[])
    } catch (e) {
      log('ACCOUNT REFRESH FAILED — ' + String((e as Error).message ?? e).slice(0, 100))
    }
  }, [venue, provider, market, polyAddr, polyCreds, kalshiSaved]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!market) return
    void refreshAccount()
    const iv = window.setInterval(() => void refreshAccount(), 12000)
    return () => window.clearInterval(iv)
  }, [market?.marketId, venue, polyAddr, kalshiSaved]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Kalshi exchange status gate ---------- */
  useEffect(() => {
    if (venue !== 'kalshi') return
    let dead = false
    void getKalshiExchangeStatus(kalshiDemo).then((s) => {
      if (!dead) setExchangeStatus(s)
    })
    return () => {
      dead = true
    }
  }, [venue, kalshiDemo])

  /* ---------- Poly: connect + derive + allowance ---------- */
  const polyConnect = async () => {
    try {
      const addr = (await evm.ethRequest<string[]>('eth_requestAccounts', []))[0] as string
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error('Wallet returned no address.')
      await evm.switchEvmChain(evmChain(137).hex, addChainParams(137)).catch(() => {})
      setPolyAddr(addr)
      localStorage.setItem(LS_POLY_ADDR, addr)
      play('coin')
      log(`WALLET ${shortAddr(addr, 4)} ON POLYGON`)
    } catch (e) {
      setErr(String((e as Error).message ?? e).slice(0, 200))
      play('error')
    }
  }

  const polyDerive = async () => {
    if (!polyAddr || busy.current) return
    busy.current = true
    setErr(null)
    try {
      setPhase('signing')
      log('REQUESTING API-CRED SIGNATURE (NO FUNDS MOVE)…')
      play('alert')
      const creds = await derivePolyCreds(polyAddr as Address)
      if (!polySessionOnly) localStorage.setItem(LS_POLY, JSON.stringify(creds))
      setPolyCreds(creds)
      log('API CREDS READY — CHECKING USDC…')
      const [bal, allow] = await Promise.all([
        polyUsdcBalance(polyAddr as Address),
        polyAllowance(polyAddr as Address, POLY_USDC, POLY_EXCHANGE).catch(() => 0n),
      ])
      setUsdcBal(bal)
      setAllowOk(allow > 0n)
      setPhase('ready')
      play('win')
      void refreshAccount()
    } catch (e) {
      const m = String((e as Error).message ?? e)
      play('error')
      setErr(mapPolyError(m).slice(0, 300))
      setPhase('error')
    } finally {
      busy.current = false
    }
  }

  const polyApprove = async () => {
    if (!polyAddr || !market || busy.current) return
    busy.current = true
    try {
      setPhase('signing')
      log('REQUESTING USDC APPROVAL (ONE-TIME)…')
      const negRisk = await polyIsNegRisk(market.ref.yesToken ?? '').catch(() => false)
      const spender = polyExchangeFor(negRisk)
      const { encodeFunctionData } = await import('viem')
      const data = encodeFunctionData({
        abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const,
        functionName: 'approve',
        args: [spender, (2n ** 256n - 1n) as unknown as bigint],
      })
      const hash = await evm.ethRequest<string>('eth_sendTransaction', [{ from: polyAddr, to: POLY_USDC, data }])
      log(`APPROVAL TX ${String(hash).slice(0, 18)}…`)
      setAllowOk(true)
      setPhase('ready')
      play('win')
    } catch (e) {
      setErr(mapPolyError(String((e as Error).message ?? e)).slice(0, 250))
      setPhase('error')
      play('error')
    } finally {
      busy.current = false
    }
  }

  const polyForget = () => {
    localStorage.removeItem(LS_POLY)
    localStorage.removeItem(LS_POLY_ADDR)
    setPolyCreds(null)
    setPolyAddr(null)
    setUsdcBal(null)
    setAllowOk(null)
    setManualKey('')
    setManualSecret('')
    setManualPass('')
    play('click')
  }

  const polySaveManual = () => {
    if (!polyAddr) {
      setErr('Connect wallet first — manual creds must match that address.')
      play('error')
      return
    }
    if (!manualKey.trim() || !manualSecret.trim() || !manualPass.trim()) {
      setErr('Paste key + secret + passphrase (from polymarket.com Settings → API).')
      play('error')
      return
    }
    const creds = { key: manualKey.trim(), secret: manualSecret.trim(), passphrase: manualPass.trim() }
    if (!polySessionOnly) localStorage.setItem(LS_POLY, JSON.stringify(creds))
    setPolyCreds(creds)
    setErr(null)
    log('MANUAL CREDS SAVED — checking USDC…')
    play('coin')
    void (async () => {
      const [bal, allow] = await Promise.all([
        polyUsdcBalance(polyAddr as Address).catch(() => null),
        polyAllowance(polyAddr as Address, POLY_USDC, POLY_EXCHANGE).catch(() => 0n),
      ])
      setUsdcBal(bal)
      setAllowOk((allow as bigint) > 0n)
      void refreshAccount()
    })()
  }

  /* ---------- Kalshi: save creds ---------- */
  const kalshiSave = () => {
    if (!kalshiKeyId.trim()) {
      setErr('Paste your Kalshi Key ID.')
      play('error')
      return
    }
    if (!kalshiPem.includes('PRIVATE KEY')) {
      setErr('Paste your RSA private key PEM (BEGIN PRIVATE KEY).')
      play('error')
      return
    }
    if (kalshiRemember) localStorage.setItem(LS_KALSHI, JSON.stringify({ keyId: kalshiKeyId.trim(), pem: kalshiPem, demo: kalshiDemo }))
    else localStorage.removeItem(LS_KALSHI)
    setKalshiSaved(true)
    setErr(null)
    log(kalshiRemember ? 'KALSHI CREDS SAVED IN THIS BROWSER ONLY' : 'KALSHI CREDS SESSION-ONLY')
    play('coin')
    void refreshAccount()
  }

  /* ---------- order sizing ---------- */
  const markFor = (o: 'YES' | 'NO'): number | null => {
    if (!market) return null
    if (venue === 'polymarket') {
      const b = o === 'YES' ? book?.yesAsks[0]?.price ?? market.yesPrice : book?.noAsks[0]?.price ?? market.noPrice
      return b ?? null
    }
    return o === 'YES' ? (market.yesAsk ?? market.yesPrice) : (market.noAsk ?? market.noPrice)
  }

  const amountNum = useMemo(() => (isFinite(Number(amount)) ? Number(amount) : 0), [amount])

  // shares/contracts + max cost preview
  const preview = useMemo(() => {
    if (!market || !(amountNum > 0)) return null
    if (venue === 'polymarket') {
      if (isMarket) {
        // USD notional → shares computed at fill; estimate at ask
        const px = markFor(outcome)
        if (px == null || px <= 0 || px >= 1) return null
        return { qty: amountNum / px, px, cost: amountNum }
      }
      const px = Number(limitPx) / 100
      if (!(px > 0) || px >= 1) return null
      return { qty: amountNum, px, cost: amountNum * px }
    }
    // kalshi: amount = contracts
    if (!Number.isInteger(amountNum) || amountNum < 1) return null
    const px = isMarket ? (markFor(outcome) ?? 0) : Number(limitPx) / 100
    if (!(px > 0) || px >= 1) return null
    return { qty: amountNum, px, cost: amountNum * px }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, amountNum, isMarket, limitPx, outcome, book, venue])

  const inputErr: string | null = useMemo(() => {
    if (venue === 'polymarket' && !polyAuth) return 'Connect wallet + derive API creds to trade.'
    if (venue === 'kalshi' && !kalshiAuth) return 'Save Kalshi Key ID + PEM to trade.'
    if (!market) return 'Loading market…'
    if (market.status !== 'open') return `Market is ${market.status.toUpperCase()} — trading disabled.`
    if (venue === 'kalshi' && exchangeStatus === 'paused') return 'EXCHANGE UNAVAILABLE — trading paused.'
    if (!(amountNum > 0)) return venue === 'polymarket' && isMarket ? 'Enter USD amount.' : 'Enter size.'
    if (!preview) return 'Price unavailable — refresh the book.'
    if (preview.cost <= 0) return 'Size too small.'
    return null
  }, [venue, polyAuth, kalshiAuth, market, amountNum, preview, exchangeStatus, isMarket])

  /* ---------- place order ---------- */
  const doOrder = useCallback(async () => {
    const auth = venue === 'polymarket' ? polyAuth : kalshiAuth
    if (!auth || !market || !preview || busy.current) return
    busy.current = true
    setConfirmOpen(false)
    setErr(null)
    try {
      setPhase('signing')
      log(`SIGNING ${outcome} BUY — ${venue.toUpperCase()}…`)
      play('alert')
      const orderId = await provider.placeOrder(auth, {
        market,
        outcome,
        side: 'BUY',
        price: preview.px,
        size: preview.qty,
        isMarket,
      })
      log(`ORDER ${orderId.slice(0, 18)}… SUBMITTED`)
      setPhase('sending')
      // poll status a few times for fill visibility
      let shown: NormalizedOrder | null = null
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 2500))
        try {
          shown = await provider.getOrder(auth, market, orderId)
          if (shown.status === 'filled' || shown.status === 'partial' || shown.status === 'canceled') break
        } catch {
          /* keep polling */
        }
      }
      if (shown) {
        setLastOrder(shown)
        log(`STATUS ${shown.status.toUpperCase()} — filled ${shown.filledQty}/${shown.size}`)
      } else {
        log('STATUS UNKNOWN AFTER POLL — CHECK OPEN ORDERS')
      }
      setPhase('success')
      play('win')
      void refreshAccount()
    } catch (e) {
      const m = String((e as Error).message ?? e)
      play('error')
      setErr((venue === 'polymarket' ? mapPolyError(m) : mapKalshiError(m)).slice(0, 300))
      setPhase('error')
      log('ERROR — ' + m.slice(0, 140))
    } finally {
      busy.current = false
    }
  }, [venue, polyAuth, kalshiAuth, market, preview, provider, outcome, isMarket, log, refreshAccount])

  const doCancel = useCallback(
    async (orderId: string) => {
      const auth = venue === 'polymarket' ? polyAuth : kalshiAuth
      if (!auth || !market || busy.current) return
      busy.current = true
      try {
        log(`CANCELING #${orderId.slice(0, 12)}…`)
        const receipt = await provider.cancelOrder(auth, market, orderId)
        log(`✓ ${receipt}`)
        play('coin')
        void refreshAccount()
      } catch (e) {
        setErr(String((e as Error).message ?? e).slice(0, 250))
        play('error')
      } finally {
        busy.current = false
      }
    },
    [venue, polyAuth, kalshiAuth, market, provider, log, refreshAccount],
  )

  /* ---------- contextual action ---------- */
  const action = useMemo(() => {
    if (venue === 'polymarket' && !polyAuth) {
      return {
        label: !polyAddr ? '🔷 CONNECT WALLET' : '🔑 DERIVE API CREDS',
        act: () => void (!polyAddr ? polyConnect() : polyDerive()),
        disabled: false,
      }
    }
    if (venue === 'kalshi' && !kalshiAuth) {
      return { label: 'SAVE CREDENTIALS BELOW', act: () => {}, disabled: true }
    }
    if (!market) return { label: 'LOADING MARKET…', act: () => {}, disabled: true }
    if (phase === 'loading') return { label: 'LOADING…', act: () => {}, disabled: true }
    if (phase === 'signing' || phase === 'sending') return { label: 'PLACING…', act: () => {}, disabled: true }
    if (inputErr) return { label: 'CHECK INPUT', act: () => {}, disabled: true }
    return {
      label: `BUY ${outcome} @ ${fmtCents(preview?.px ?? null)}`,
      act: () => {
        setConfirmOpen(true)
        play('alert')
      },
      disabled: false,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue, polyAuth, kalshiAuth, market, phase, inputErr, outcome, preview, polyAddr])

  const statusTone = phase === 'success' ? 'var(--green)' : phase === 'error' ? 'var(--red)' : 'var(--amber)'
  const yesBig = market ? (market.yesAsk ?? market.yesPrice) : null
  const noBig = market ? (market.noAsk ?? market.noPrice) : null

  const switchVenue = (v: PredictVenueId) => {
    setVenue(v)
    setDetailOpen(false)
    setConfirmOpen(false)
    setLastOrder(null)
    setErr(null)
    setPhase('idle')
    play('click')
  }

  useEffect(() => {
    setKalshiDemoMode(kalshiDemo)
  }, [kalshiDemo])

  return (
    <div className="page" style={{ alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: '70vh' }}>
      <div style={{ maxWidth: 720, width: '100%' }}>
        <Panel title="PREDICT.EXE — TWO LIVE MARKETS" end={<span className="pt-end">{provider.label}</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
            {/* VENUE TABS */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', gap: 4 }}>
                {(['polymarket', 'kalshi'] as PredictVenueId[]).map((v) => (
                  <button key={v} className={venue === v ? 'bevel-btn b-sm b-cyan' : 'bevel-btn b-sm'} onClick={() => switchVenue(v)}>
                    {v === 'polymarket' ? 'POLYMARKET' : 'KALSHI'}
                  </button>
                ))}
              </div>
              {venue === 'kalshi' && (
                <div style={{ display: 'inline-flex', gap: 4 }}>
                  <button className={kalshiDemo ? 'bevel-btn b-sm b-cyan' : 'bevel-btn b-sm'} onClick={() => { setKalshiDemo(true); play('click') }}>DEMO</button>
                  <button
                    className={kalshiDemo ? 'bevel-btn b-sm' : 'bevel-btn b-sm b-cyan'}
                    style={!kalshiDemo ? { background: 'linear-gradient(180deg,#ff5b8d,#ff2a6d)', color: '#fff' } : {}}
                    onClick={() => { setKalshiDemo(false); play('click') }}
                  >
                    PROD
                  </button>
                </div>
              )}
              <button className="bevel-btn b-sm" onClick={() => void discover()} title="re-discover market">↻</button>
            </div>

            {/* MARKET CARD */}
            <div style={{ border: '2px solid var(--line)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="t9 dim">{provider.label}</span>
                <span className="faint" style={{ fontSize: 14 }}>
                  {market ? `EXPIRY ${fmtTime(market.closeTime)}` : '—'}
                </span>
              </div>
              <div className="t10" style={{ color: 'var(--amber)', textShadow: 'var(--glow-amber)', lineHeight: 1.3 }}>
                {market ? market.title : phase === 'loading' ? 'SCANNING LIVE MARKETS…' : '—'}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1, border: '2px solid var(--line)', padding: 12, textAlign: 'center' }}>
                  <div className="t9 dim">YES</div>
                  <div style={{ fontSize: 'clamp(28px, 5vw, 38px)', color: 'var(--green)', textShadow: 'var(--glow-green)' }}>
                    {market ? fmtCents(yesBig) : '—'}
                  </div>
                </div>
                <div style={{ flex: 1, border: '2px solid var(--line)', padding: 12, textAlign: 'center' }}>
                  <div className="t9 dim">NO</div>
                  <div style={{ fontSize: 'clamp(28px, 5vw, 38px)', color: 'var(--red)', textShadow: 'var(--glow-red)' }}>
                    {market ? fmtCents(noBig) : '—'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 15 }}>
                <span className="faint">VOL {market ? fmtUsd2(market.volume) : '—'}</span>
                <span className="faint">LIQ {market ? fmtUsd2(market.liquidity) : venue === 'kalshi' ? 'OI' : '—'}</span>
                <span className="faint">STATUS {market ? market.status.toUpperCase() : '—'}</span>
                {venue === 'kalshi' && <span className="faint">XCHG {exchangeStatus.toUpperCase()}</span>}
              </div>
              {market && (
                <button className="bevel-btn b-lg" style={{ width: '100%' }} onClick={() => { setDetailOpen((v) => !v); play('open') }}>
                  {detailOpen ? '▾ CLOSE MARKET' : '▸ OPEN MARKET'}
                </button>
              )}
            </div>

            {/* DETAIL */}
            {detailOpen && market && (
              <>
                <div style={{ border: '2px solid var(--line)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span className="t9 dim">ORDERBOOK — {outcome}</span>
                  <BookTable book={book} outcome={outcome} />
                  <span className="faint" style={{ fontSize: 14 }}>
                    RULES: {market.rules ? market.rules.slice(0, 300) : '—'}
                  </span>
                  <span className="faint" style={{ fontSize: 14 }}>
                    <a href={market.url} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>VIEW ON {provider.label} ↗</a>
                    {' · '}BAL {fmtUsd2(balance)}
                  </span>
                </div>

                {/* AUTH */}
                {venue === 'polymarket' && !polyAuth && (
                  <div style={{ border: '2px solid var(--line)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span className="t9 dim">TRADE AUTH — WALLET SIGNS, NO PRIVATE KEY</span>
                    <span className="faint" style={{ fontSize: 14 }}>
                      1 · Connect on Polygon · 2 · Derive API creds (1 free signature) · 3 · Approve USDC once ·
                      creds are revocable, {polySessionOnly ? 'session-only' : 'stored in this browser'}.
                    </span>
                    <label className="faint" style={{ fontSize: 14, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={polySessionOnly} onChange={(e) => setPolySessionOnly(e.target.checked)} />
                      SESSION ONLY (no localStorage)
                    </label>
                    {polyAddr && (
                      <div className="stat-row"><span className="sk">USDC</span><span className="sv">{usdcBal != null ? fmtUsd2(usdcBal) : '—'}</span></div>
                    )}
                    <div className="faint" style={{ fontSize: 14, borderTop: '1px dashed var(--line)', paddingTop: 8, marginTop: 4 }}>
                      DERIVE FAILED? Paste existing creds from polymarket.com → Settings → API (they match this wallet address). This bypasses the EIP-712 derive step — useful if derive is geo-blocked or your wallet blocks signTypedData.
                    </div>
                    <input placeholder="API KEY (hex)…" value={manualKey} onChange={(e) => setManualKey(e.target.value.trim())} style={{ width: '100%' }} />
                    <input placeholder="API SECRET (base64)…" value={manualSecret} onChange={(e) => setManualSecret(e.target.value.trim())} style={{ width: '100%' }} />
                    <input placeholder="PASSPHRASE…" value={manualPass} onChange={(e) => setManualPass(e.target.value.trim())} style={{ width: '100%' }} />
                    <button className="bevel-btn b-sm b-cyan" onClick={polySaveManual} disabled={!polyAddr}>✓ USE PASTED CREDS</button>
                  </div>
                )}
                {venue === 'polymarket' && polyAuth && (
                  <div className="stat-row">
                    <span className="sk">TRADER</span>
                    <span className="sv">
                      {shortAddr(polyAddr!, 4)} · USDC {fmtUsd2(usdcBal)}
                      {allowOk === false && <button className="bevel-btn b-sm b-cyan" style={{ marginLeft: 8 }} onClick={() => void polyApprove()}>APPROVE USDC</button>}
                      <button className="bevel-btn b-sm" style={{ color: 'var(--red)', marginLeft: 8 }} onClick={polyForget}>⏏ FORGET</button>
                    </span>
                  </div>
                )}
                {venue === 'kalshi' && !kalshiAuth && (
                  <div style={{ border: '2px solid var(--line)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span className="t9 dim">TRADE AUTH — KEY ID + RSA PEM ({kalshiDemo ? 'DEMO' : 'PROD'})</span>
                    <input placeholder="KEY ID (uuid)…" value={kalshiKeyId} onChange={(e) => setKalshiKeyId(e.target.value.trim())} style={{ width: '100%' }} />
                    <input type="password" placeholder="RSA PRIVATE KEY PEM…" value={kalshiPem} onChange={(e) => setKalshiPem(e.target.value.trim())} style={{ width: '100%' }} />
                    <label className="faint" style={{ fontSize: 14, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={kalshiRemember} onChange={(e) => setKalshiRemember(e.target.checked)} />
                      REMEMBER IN THIS BROWSER (else session-only)
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="bevel-btn b-sm b-cyan" onClick={kalshiSave}>✓ SAVE</button>
                    </div>
                    <div className="faint" style={{ fontSize: 14 }}>
                      Create at kalshi.com → Account → API Keys{kalshiDemo ? ' (demo account)' : ''}. Key signs
                      server-side per request, never stored or logged. No wallet authorizes Kalshi — only this key.
                    </div>
                  </div>
                )}
                {venue === 'kalshi' && kalshiAuth && (
                  <div className="stat-row">
                    <span className="sk">TRADER</span>
                    <span className="sv">
                      KEY {shortAddr(kalshiKeyId, 4)} · BAL {fmtUsd2(balance)}
                      <button className="bevel-btn b-sm" style={{ color: 'var(--red)', marginLeft: 8 }} onClick={() => { localStorage.removeItem(LS_KALSHI); setKalshiSaved(false); setKalshiPem(''); play('click') }}>⏏ FORGET</button>
                    </span>
                  </div>
                )}

                {/* TICKET */}
                <div style={{ border: '2px solid var(--line)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button className="bevel-btn b-sm" style={outcome === 'YES' ? { background: 'linear-gradient(180deg,#4ade80,#16a34a)', color: '#00140a' } : {}} onClick={() => setOutcome('YES')}>YES</button>
                      <button className="bevel-btn b-sm" style={outcome === 'NO' ? { background: 'linear-gradient(180deg,#ff5b8d,#ff2a6d)', color: '#fff' } : {}} onClick={() => setOutcome('NO')}>NO</button>
                    </div>
                    <div style={{ display: 'inline-flex', gap: 4 }}>
                      <button className={isMarket ? 'bevel-btn b-sm b-cyan' : 'bevel-btn b-sm'} onClick={() => setIsMarket(true)}>MARKET</button>
                      <button className={isMarket ? 'bevel-btn b-sm' : 'bevel-btn b-sm b-cyan'} onClick={() => setIsMarket(false)}>LIMIT</button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                      inputMode="decimal"
                      placeholder={venue === 'polymarket' && isMarket ? 'USD' : venue === 'kalshi' ? 'CONTRACTS' : 'SHARES'}
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value.replace(/[^0-9.]/g, ''))
                        setErr(null)
                      }}
                      style={{ flex: 1, minWidth: 0, fontSize: 'clamp(28px, 5vw, 38px)', border: 'none', background: 'transparent', padding: '2px 0', color: 'var(--amber)', textShadow: 'var(--glow-amber)' }}
                    />
                    <span className="t9 dim">BUY</span>
                  </div>
                  {!isMarket && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <input
                        inputMode="decimal"
                        placeholder="LIMIT ¢"
                        value={limitPx}
                        onChange={(e) => {
                          setLimitPx(e.target.value.replace(/[^0-9.]/g, ''))
                          setErr(null)
                        }}
                        style={{ flex: 1, minWidth: 0, fontSize: 24, border: 'none', background: 'transparent', padding: '2px 0', color: 'var(--cyan)', textShadow: 'var(--glow-cyan)' }}
                      />
                      <span className="t9 dim">¢</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                    <span className="faint" style={{ fontSize: 15 }}>
                      {preview ? `≈ ${Number(preview.qty.toFixed(4))} ${outcome === 'YES' ? 'YES' : 'NO'} @ ${fmtCents(preview.px)}` : '—'}
                    </span>
                    <span className="faint" style={{ fontSize: 15 }}>
                      MAX COST {preview ? fmtUsd2(preview.cost) : '—'}
                    </span>
                  </div>
                </div>

                {(inputErr && amount.trim()) || (venue === 'kalshi' && exchangeStatus === 'paused') ? (
                  <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                    ⚠ {venue === 'kalshi' && exchangeStatus === 'paused' ? 'EXCHANGE UNAVAILABLE — trading paused.' : inputErr}
                  </div>
                ) : null}

                {err && (
                  <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)', textShadow: 'var(--glow-red)' }}>
                    ✕ {err}
                  </div>
                )}

                {telemetry.length > 0 && (
                  <div className="telemetry" style={{ color: statusTone }}>
                    {telemetry.join('\n')}
                  </div>
                )}
                {(phase === 'loading' || phase === 'signing' || phase === 'sending') && (
                  <div className="blocks" style={{ textAlign: 'center' }}>
                    {blocks((Date.now() / 3000) % 1, 22)}
                  </div>
                )}

                <button
                  className="bevel-btn b-lg"
                  style={{
                    width: '100%', fontSize: 15, padding: '14px 18px',
                    ...(action.label.includes('CONNECT') || action.label.includes('DERIVE')
                      ? { background: 'linear-gradient(180deg,#4cf0fa,#05d9e8)', color: '#001416', borderColor: '#b3f7fb' }
                      : action.label.includes('BUY YES')
                        ? { background: 'linear-gradient(180deg,#4ade80,#16a34a)', color: '#00140a' }
                        : action.label.includes('BUY NO')
                          ? { background: 'linear-gradient(180deg,#ff5b8d,#ff2a6d)', color: '#fff' }
                          : {}),
                  }}
                  disabled={action.disabled}
                  onClick={action.act}
                >
                  {action.label}
                </button>

                {/* POSITIONS */}
                {positions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="t9 dim">POSITIONS</span>
                    {positions.map((p, i) => (
                      <div className="stat-row" key={`${p.outcome}-${i}`}>
                        <span className="sk" style={{ color: p.outcome === 'YES' ? 'var(--green)' : 'var(--red)' }}>
                          {p.size} {p.outcome} @ {fmtCents(p.avgPrice)}
                        </span>
                        <span className="sv" style={{ color: (p.pnl ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {p.pnl != null ? `${p.pnl >= 0 ? '+' : ''}${fmtUsd2(Math.abs(p.pnl))}` : fmtUsd2(p.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* OPEN ORDERS */}
                {orders.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="t9 dim">OPEN ORDERS</span>
                    {orders.map((o) => (
                      <div className="stat-row" key={o.orderId} style={{ alignItems: 'center' }}>
                        <span className="sk">{o.side} {o.size} {o.outcome} @ {fmtCents(o.price)} · {o.status.toUpperCase()}</span>
                        <span className="sv">
                          <button className="bevel-btn b-sm" style={{ color: 'var(--red)' }} onClick={() => void doCancel(o.orderId)}>
                            ✕ CANCEL
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {lastOrder && (
                  <div className="stat-row">
                    <span className="sk">LAST ORDER</span>
                    <span className="sv">#{lastOrder.orderId.slice(0, 12)}… · {lastOrder.status.toUpperCase()} · filled {lastOrder.filledQty}/{lastOrder.size}</span>
                  </div>
                )}

                <div className="faint" style={{ fontSize: 14 }}>
                  {venue === 'polymarket'
                    ? 'Polymarket CLOB · wallet-signed orders on Polygon · USDC needed · nothing submits until CONFIRM + wallet sign.'
                    : 'Kalshi · RSA key signs server-side per request, never stored · nothing submits until CONFIRM.'}
                </div>
              </>
            )}

            {err && !detailOpen && (
              <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)', textShadow: 'var(--glow-red)' }}>
                ✕ {err}
              </div>
            )}
          </div>
        </Panel>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <button className="bevel-btn b-lg b-cyan" onClick={() => nav('/')}>◀ BACK TO DESKTOP</button>
        </div>
      </div>

      {/* confirm */}
      {confirmOpen && market && preview && (
        <SystemDialog
          title="CONFIRM ORDER — USER APPROVAL REQUIRED"
          onClose={() => setConfirmOpen(false)}
          actions={
            <>
              <button className="bevel-btn" onClick={() => setConfirmOpen(false)}>✕ CANCEL</button>
              <button className="bevel-btn b-danger" onClick={() => void doOrder()}>✓ CONFIRM ORDER</button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="stat-row"><span className="sk">VENUE</span><span className="sv">{provider.label}</span></div>
            <div className="stat-row"><span className="sk">MARKET</span><span className="sv">{market.title.slice(0, 60)}</span></div>
            <div className="stat-row"><span className="sk">OUTCOME</span><span className="sv">{outcome} · BUY</span></div>
            <div className="stat-row"><span className="sk">PRICE</span><span className="sv">{fmtCents(preview.px)} {isMarket ? '(MARKET REF)' : '(LIMIT)'}</span></div>
            <div className="stat-row"><span className="sk">SIZE</span><span className="sv">{Number(preview.qty.toFixed(4))}</span></div>
            <div className="stat-row"><span className="sk">MAX COST</span><span className="sv">{fmtUsd2(preview.cost)}</span></div>
            <div className="faint" style={{ fontSize: 14 }}>After CONFIRM, {venue === 'polymarket' ? 'your wallet opens to sign — approve there.' : 'the order is signed server-side with your key and submitted.'} Nothing submits until you confirm.</div>
          </div>
        </SystemDialog>
      )}
    </div>
  )
}
