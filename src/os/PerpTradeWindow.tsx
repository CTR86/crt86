/* ============================================================
   PERP.EXE (Aster + Hyperliquid) — perp terminal inside the CRT.
   Two venues, one window: ASTER (agent-key, EIP-712 Message) and
   HYPERLIQUID (connected wallet signatures or local agent key).
   Same window system and styling as every other .EXE: Panel,
   boxes, telemetry, confirm dialogs. No new design language.
   (The parked Jupiter engine lives untouched in src/lib/perp/.)
   Market data is public (no key). Trading needs venue auth.
   Defaults to TESTNET — real funds only after explicit switch.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Hex } from 'viem'
import { useEvmWallet } from '../wallets/EvmWallet'
import { useUi } from '../store/ui'
import { Panel, Switch } from '../design/ui'
import { SystemDialog } from '../design/SystemDialog'
import { blocks, shortAddr } from '../lib/format'
import { play } from '../sound/sfx'
import { AsterProvider, asterKeepaliveListenKey, asterListenKey } from '../lib/futures/aster'
import {
  HyperliquidProvider,
  hlCreateAgent,
  isHlRejection,
  mapHlError,
} from '../lib/futures/hyperliquid'
import { useAsterLive, useHlLive } from '../lib/futures/live'
import { floorToDecimals } from '../lib/futures/hlWire'
import { roundDownToStep } from '../lib/futures/aster'
import {
  clearAsterCreds,
  clearHlAgent,
  loadAsterCreds,
  loadHlAgent,
  saveAsterCreds,
  saveHlAgent,
  type AsterAuth,
  type HlAuth,
  type PerpMarket,
  type PerpNetwork,
  type PerpOpenOrder,
  type PerpPosition,
  type PerpProvider,
  type PerpVenueId,
} from '../lib/futures/types'

type Phase = 'idle' | 'loading' | 'ready' | 'signing' | 'sending' | 'success' | 'error'

const PROVIDERS: Record<PerpVenueId, PerpProvider> = {
  aster: AsterProvider,
  hyperliquid: HyperliquidProvider,
}

const LEVERAGE_PRESETS = [1, 2, 3, 5, 10, 20, 50]

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '$—'
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1000) return `${sign}$${a.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (a > 0 && a < 0.01) return `${sign}$${a.toPrecision(3)}`
  return `${sign}$${a.toFixed(2)}`
}

function fmtPx(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 })
  if (n >= 1) return String(Number(n.toFixed(4)))
  return String(Number(n.toPrecision(4)))
}

export function PerpTradeWindow() {
  const nav = useNavigate()
  const evm = useEvmWallet()
  const openWalletHelp = useUi((s) => s.openWalletHelp)

  const [venue, setVenue] = useState<PerpVenueId>('hyperliquid')
  const [network, setNetwork] = useState<PerpNetwork>('mainnet')
  const provider = PROVIDERS[venue]

  const [markets, setMarkets] = useState<PerpMarket[]>([])
  const [symbol, setSymbol] = useState('BTC')
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG')
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [sizeUsd, setSizeUsd] = useState('')
  const [limitPx, setLimitPx] = useState('')
  const [leverage, setLeverage] = useState(5)

  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<string[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)

  const [equity, setEquity] = useState<number | null>(null)
  const [available, setAvailable] = useState<number | null>(null)
  const [positions, setPositions] = useState<PerpPosition[]>([])
  const [orders, setOrders] = useState<PerpOpenOrder[]>([])

  // Aster creds (browser-only)
  const [asterUser, setAsterUser] = useState('')
  const [asterKey, setAsterKey] = useState('')
  const [asterSaved, setAsterSaved] = useState(false)
  const [asterSessionOnly, setAsterSessionOnly] = useState(false)
  // HL local agent display address
  const [hlAgentAddr, setHlAgentAddr] = useState<string | null>(null)
  const [hlSessionOnly, setHlSessionOnly] = useState(false)
  const [hlSessionKey, setHlSessionKey] = useState<string | null>(null)
  // TP/SL panel
  const [tpslSymbol, setTpslSymbol] = useState('')
  const [tpPx, setTpPx] = useState('')
  const [slPx, setSlPx] = useState('')
  // live socket state
  const [liveUp, setLiveUp] = useState(false)
  const [asterWsKey, setAsterWsKey] = useState<string | null>(null)

  const busy = useRef(false)

  const log = useCallback((l: string) => {
    setTelemetry((s) => [...s.slice(-24), `[${new Date().toLocaleTimeString()}] ${l}`])
  }, [])

  function setQuoteReset() {
    setPhase('idle')
    setErr(null)
    setConfirmOpen(false)
  }

  /* ---------- venue/network switch resets market-dependent state ---------- */
  const switchVenue = (v: PerpVenueId) => {
    setVenue(v)
    setSymbol(v === 'hyperliquid' ? 'BTC' : 'BTCUSDT')
    setMarkets([])
    setPositions([])
    setOrders([])
    setEquity(null)
    setAvailable(null)
    setQuoteReset()
    play('click')
  }
  const switchNetwork = (n: PerpNetwork) => {
    setNetwork(n)
    setMarkets([])
    setPositions([])
    setOrders([])
    setEquity(null)
    setAvailable(null)
    setQuoteReset()
    play('click')
  }

  /* ---------- markets (public) ---------- */
  useEffect(() => {
    let dead = false
    setPhase('loading')
    provider
      .fetchMarkets(network)
      .then((ms) => {
        if (dead) return
        setMarkets(ms)
        setPhase('idle')
      })
      .catch((e) => {
        if (dead) return
        setErr(String((e as Error).message ?? e).slice(0, 200))
        setPhase('error')
      })
    return () => {
      dead = true
    }
  }, [provider, network])

  const market: PerpMarket | null = useMemo(
    () => markets.find((m) => m.symbol === symbol) ?? markets.find((m) => m.symbol.startsWith('BTC')) ?? markets[0] ?? null,
    [markets, symbol],
  )

  useEffect(() => {
    if (market && orderType === 'LIMIT' && !limitPx && market.mark != null) {
      setLimitPx(String(fmtPx(market.mark)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market?.symbol])

  /* ---------- auth resolution ---------- */
  useEffect(() => {
    const c = loadAsterCreds()
    if (c) {
      setAsterUser(c.user)
      setAsterKey(c.agentKey)
      setAsterSaved(true)
    }
  }, [])

  useEffect(() => {
    if (venue !== 'hyperliquid' || !evm.address) {
      setHlAgentAddr(null)
      return
    }
    const key = hlSessionKey ?? loadHlAgent(evm.address)
    if (!key) {
      setHlAgentAddr(null)
      return
    }
    let dead = false
    void import('viem/accounts').then(({ privateKeyToAccount }) => {
      if (dead) return
      try {
        setHlAgentAddr(privateKeyToAccount(key as Hex).address)
      } catch {
        setHlAgentAddr(null)
      }
    })
    return () => {
      dead = true
    }
  }, [venue, evm.address, hlSessionKey])

  const hlAuth: HlAuth | null = useMemo(
    () =>
      venue === 'hyperliquid' && evm.address
        ? { user: evm.address, agentKey: hlSessionKey ?? loadHlAgent(evm.address), ethRequest: evm.ethRequest }
        : null,
    [venue, evm.address, evm.ethRequest, hlSessionKey],
  )

  const asterAuth: AsterAuth | null = useMemo(
    () =>
      venue === 'aster' && asterSaved && /^0x[0-9a-fA-F]{40}$/.test(asterUser) && /^0x[0-9a-fA-F]{64}$/.test(asterKey)
        ? { user: asterUser, agentKey: asterKey }
        : null,
    [venue, asterSaved, asterUser, asterKey],
  )

  const authed = venue === 'hyperliquid' ? !!hlAuth : !!asterAuth

  // stable handle so socket callbacks can refresh without re-subscribing
  const refreshAccountRef = useRef<() => Promise<void>>(() => Promise.resolve())

  /* ---------- live feeds (sockets; REST remains the fallback) ---------- */
  const mergeMarks = useCallback((marks: Record<string, number>, funding?: Record<string, number>) => {
    setMarkets((prev) => {
      if (prev.length === 0) return prev
      let changed = false
      const next = prev.map((m) => {
        const px = marks[m.symbol]
        if (px == null || !isFinite(px) || px === m.mark) return m
        changed = true
        const f = funding?.[m.symbol]
        return { ...m, mark: px, funding: f != null && isFinite(f) ? f : m.funding }
      })
      return changed ? next : prev
    })
  }, [])

  useHlLive({
    net: network,
    user: venue === 'hyperliquid' ? (hlAuth?.user ?? null) : null,
    onMids: useCallback((mids: Record<string, number>) => mergeMarks(mids), [mergeMarks]),
    onUserEvent: useCallback(() => {
      log('WALLET EVENT — REFRESHING')
      void refreshAccountRef.current()
    }, [log]),
    onState: setLiveUp,
  })

  // Aster listenKey lifecycle (signed; keepalive every 20 min)
  useEffect(() => {
    if (venue !== 'aster' || !asterAuth) {
      setAsterWsKey(null)
      return
    }
    let dead = false
    const auth = asterAuth
    const net = network
    void asterListenKey(net, auth)
      .then((k) => {
        if (!dead) setAsterWsKey(k)
      })
      .catch(() => {
        if (!dead) setAsterWsKey(null)
      })
    const iv = window.setInterval(() => {
      void asterKeepaliveListenKey(net, auth)
    }, 20 * 60_000)
    return () => {
      dead = true
      window.clearInterval(iv)
      setAsterWsKey(null)
    }
  }, [venue, network, asterAuth])

  useAsterLive({
    net: network,
    symbol: venue === 'aster' ? (market?.symbol ?? null) : null,
    listenKey: venue === 'aster' ? asterWsKey : null,
    onMark: useCallback(
      (sym: string, mark: number, funding: number | null) =>
        mergeMarks({ [sym]: mark }, funding != null ? { [sym]: funding } : undefined),
      [mergeMarks],
    ),
    onUserEvent: useCallback(() => {
      log('WALLET EVENT — REFRESHING')
      void refreshAccountRef.current()
    }, [log]),
    onState: setLiveUp,
  })

  /* ---------- account data ---------- */
  const refreshAccount = useCallback(async () => {
    const auth = venue === 'hyperliquid' ? hlAuth : asterAuth
    if (!auth) {
      setEquity(null)
      setAvailable(null)
      setPositions([])
      setOrders([])
      return
    }
    try {
      const [acc, pos, ord] = await Promise.all([
        provider.fetchAccount(network, auth),
        provider.fetchPositions(network, auth),
        provider.fetchOpenOrders(network, auth),
      ])
      setEquity(acc.equity)
      setAvailable(acc.available)
      setPositions(pos)
      setOrders(ord)
    } catch (e) {
      log('ACCOUNT REFRESH FAILED — ' + String((e as Error).message ?? e).slice(0, 100))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue, provider, network, evm.address, asterSaved])

  refreshAccountRef.current = refreshAccount

  /* ---------- order sizing ---------- */
  const sizeNum = useMemo(() => (isFinite(Number(sizeUsd)) ? Number(sizeUsd) : 0), [sizeUsd])
  const sizeBase: number | null = useMemo(() => {
    if (!market || market.mark == null || !(sizeNum > 0)) return null
    try {
      const raw = sizeNum / market.mark
      return venue === 'hyperliquid' ? floorToDecimals(raw, market.sizeDecimals) : roundDownToStep(raw, 10 ** -market.sizeDecimals)
    } catch {
      return null
    }
  }, [market, sizeNum, venue])

  const inputErr: string | null = useMemo(() => {
    if (!authed) return venue === 'hyperliquid' ? 'Connect an EVM wallet to trade.' : 'Save Aster agent credentials to trade.'
    if (!market) return 'Loading markets…'
    if (!(sizeNum > 0)) return 'Enter a size in USD.'
    if (sizeNum < market.minNotional) return `Below $${market.minNotional} minimum notional.`
    if (sizeBase == null) return 'Size below minimum lot — raise USD amount.'
    if (orderType === 'LIMIT' && !(Number(limitPx) > 0)) return 'Enter a limit price.'
    return null
  }, [authed, venue, market, sizeNum, sizeBase, orderType, limitPx])

  /* ---------- place order ---------- */
  const doOrder = useCallback(async () => {
    const auth = venue === 'hyperliquid' ? hlAuth : asterAuth
    if (!auth || !market || sizeBase == null) return
    if (busy.current) return
    busy.current = true
    setConfirmOpen(false)
    setErr(null)
    try {
      if (venue === 'hyperliquid' && !hlAuth?.agentKey) {
        setPhase('signing')
        log('REQUESTING WALLET SIGNATURE…')
        play('alert')
      } else {
        setPhase('sending')
        log('SIGNING LOCALLY — SENDING…')
      }
      const lev = Math.min(leverage, market.maxLeverage)
      const receipt = await provider.placeOrder(
        network,
        auth,
        {
          market,
          side,
          sizeBase,
          type: orderType,
          ...(orderType === 'LIMIT' ? { limitPx: Number(limitPx) } : {}),
          leverage: lev,
        },
        log,
      )
      log(`✓ ${receipt}`)
      setPhase('success')
      play('win')
      void refreshAccount()
    } catch (e) {
      const m = String((e as Error).message ?? e)
      play('error')
      if (venue === 'hyperliquid') {
        setErr(isHlRejection(m) ? 'You rejected the signature in your wallet.' : mapHlError(m).slice(0, 300))
      } else {
        setErr(m.slice(0, 300))
      }
      setPhase('error')
      log('ERROR — ' + m.slice(0, 140))
    } finally {
      busy.current = false
    }
  }, [venue, hlAuth, asterAuth, market, sizeBase, network, provider, side, orderType, limitPx, leverage, log, refreshAccount])

  const doClose = useCallback(
    async (pos: PerpPosition) => {
      const auth = venue === 'hyperliquid' ? hlAuth : asterAuth
      if (!auth || busy.current) return
      busy.current = true
      setErr(null)
      try {
        setPhase('sending')
        log(`CLOSING ${pos.side} ${pos.symbol}…`)
        play('alert')
        const receipt = await provider.closePosition(network, auth, pos, pos.markPx ?? pos.entryPx)
        log(`✓ ${receipt}`)
        play('win')
        void refreshAccount()
        setPhase('success')
      } catch (e) {
        const m = String((e as Error).message ?? e)
        play('error')
        setErr((venue === 'hyperliquid' ? mapHlError(m) : m).slice(0, 300))
        setPhase('error')
        log('ERROR — ' + m.slice(0, 140))
      } finally {
        busy.current = false
      }
    },
    [venue, hlAuth, asterAuth, network, provider, log, refreshAccount],
  )

  const doTpSl = useCallback(async () => {
    const auth = venue === 'hyperliquid' ? hlAuth : asterAuth
    if (!auth || busy.current) return
    const pos = positions.find((p) => p.symbol === (tpslSymbol || positions[0]?.symbol))
    if (!pos) {
      setErr('No open position to protect.')
      play('error')
      return
    }
    const marketFor = markets.find((m) => m.symbol === pos.symbol)
    if (!marketFor) {
      setErr('Market data missing — refresh and retry.')
      play('error')
      return
    }
    const tp = tpPx.trim() ? Number(tpPx) : null
    const sl = slPx.trim() ? Number(slPx) : null
    if ((tp == null || !(tp > 0)) && (sl == null || !(sl > 0))) {
      setErr('Set a TP price, an SL price, or both.')
      play('error')
      return
    }
    busy.current = true
    setErr(null)
    try {
      setPhase(venue === 'hyperliquid' && !hlAuth?.agentKey ? 'signing' : 'sending')
      log(`ARMING TP/SL ON ${pos.side} ${pos.symbol}…`)
      play('alert')
      const receipt = await provider.placeTpSl(network, auth, { market: marketFor, position: pos, tpPx: tp, slPx: sl })
      log(`✓ ${receipt}`)
      play('win')
      setTpPx('')
      setSlPx('')
      void refreshAccount()
      setPhase('success')
    } catch (e) {
      const m = String((e as Error).message ?? e)
      play('error')
      if (venue === 'hyperliquid') {
        setErr(isHlRejection(m) ? 'You rejected the signature in your wallet.' : mapHlError(m).slice(0, 300))
      } else {
        setErr(m.slice(0, 300))
      }
      setPhase('error')
      log('ERROR — ' + m.slice(0, 140))
    } finally {
      busy.current = false
    }
  }, [venue, hlAuth, asterAuth, network, provider, positions, markets, tpslSymbol, tpPx, slPx, log, refreshAccount])

  const doCancel = useCallback(
    async (o: PerpOpenOrder) => {
      const auth = venue === 'hyperliquid' ? hlAuth : asterAuth
      if (!auth || busy.current) return
      busy.current = true
      try {
        log(`CANCELING ${o.symbol} #${o.orderId}…`)
        const receipt = await provider.cancelOrder(network, auth, o)
        log(`✓ ${receipt}`)
        play('coin')
        void refreshAccount()
      } catch (e) {
        const m = String((e as Error).message ?? e)
        play('error')
        setErr(m.slice(0, 300))
        log('ERROR — ' + m.slice(0, 140))
      } finally {
        busy.current = false
      }
    },
    [venue, hlAuth, asterAuth, network, provider, log, refreshAccount],
  )

  /* ---------- HL agent creation ---------- */
  const createAgent = useCallback(async () => {
    if (!hlAuth || busy.current) return
    busy.current = true
    setErr(null)
    try {
      setPhase('signing')
      log('REQUESTING AGENT APPROVAL SIGNATURE…')
      play('alert')
      const { agentAddress, agentKey } = await hlCreateAgent(network, hlAuth, 'CRT86')
      if (hlSessionOnly) {
        setHlSessionKey(agentKey)
        log(`AGENT APPROVED ${shortAddr(agentAddress, 6)} — SESSION ONLY, CLEARED ON REFRESH`)
      } else {
        saveHlAgent({ owner: hlAuth.user, agentKey })
        log(`AGENT APPROVED ${shortAddr(agentAddress, 6)} — ORDERS NOW SIGN SILENTLY`)
      }
      setHlAgentAddr(agentAddress)
      play('win')
      setPhase('idle')
    } catch (e) {
      const m = String((e as Error).message ?? e)
      play('error')
      setErr(mapHlError(m).slice(0, 300))
      setPhase('error')
    } finally {
      busy.current = false
    }
  }, [hlAuth, network, log, hlSessionOnly])

  const saveAster = () => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(asterUser.trim())) {
      setErr('Aster main wallet must be a 0x address.')
      play('error')
      return
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(asterKey.trim())) {
      setErr('Agent key must be a 0x 64-hex private key.')
      play('error')
      return
    }
    if (asterSessionOnly) {
      setAsterSaved(true)
      log('ASTER AGENT ACTIVE FOR THIS SESSION ONLY — CLEARED ON REFRESH')
    } else {
      saveAsterCreds({ user: asterUser.trim(), agentKey: asterKey.trim() })
      setAsterSaved(true)
      log('ASTER AGENT SAVED IN THIS BROWSER ONLY')
    }
    setErr(null)
    play('coin')
    void refreshAccount()
  }

  /* ---------- contextual action ---------- */
  const action = useMemo(() => {
    if (venue === 'hyperliquid' && !evm.address) {
      return {
        label: '🔷 CONNECT WALLET',
        act: () => (evm.available ? evm.connect().catch(() => play('error')) : openWalletHelp('evm')),
        disabled: false,
      }
    }
    if (venue === 'aster' && !asterAuth) {
      return { label: 'SAVE AGENT KEY BELOW', act: () => {}, disabled: true }
    }
    if (!market) return { label: 'LOADING MARKETS…', act: () => {}, disabled: true }
    if (phase === 'loading') return { label: 'LOADING…', act: () => {}, disabled: true }
    if (phase === 'signing') return { label: 'SIGNING…', act: () => {}, disabled: true }
    if (phase === 'sending') return { label: 'PLACING…', act: () => {}, disabled: true }
    if (inputErr) return { label: 'CHECK INPUT', act: () => {}, disabled: true }
    return {
      label: side === 'LONG' ? `▲ LONG ${market.symbol}` : `▼ SHORT ${market.symbol}`,
      act: () => {
        setConfirmOpen(true)
        play('alert')
      },
      disabled: false,
    }
  }, [venue, evm, market, phase, inputErr, side, asterAuth, openWalletHelp])

  const statusTone = phase === 'success' ? 'var(--green)' : phase === 'error' ? 'var(--red)' : 'var(--amber)'
  const isTestnet = network === 'testnet'

  return (
    <div className="page" style={{ alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: '70vh' }}>
      <div style={{ maxWidth: 720, width: '100%' }}>
        <Panel title={`PERP.EXE — ${provider.label} PERPS`} end={<span className="pt-end" style={{ color: liveUp ? 'var(--green)' : undefined }}>{liveUp ? '● LIVE' : '○ POLL'} · {isTestnet ? 'TESTNET' : 'MAINNET'}</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
            {/* VENUE + NETWORK */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', gap: 4 }}>
                {(['hyperliquid', 'aster'] as PerpVenueId[]).map((v) => (
                  <button key={v} className={venue === v ? 'bevel-btn b-sm b-cyan' : 'bevel-btn b-sm'} onClick={() => switchVenue(v)}>
                    {v === 'hyperliquid' ? 'HL' : 'ASTER'}
                  </button>
                ))}
              </div>
              <div style={{ display: 'inline-flex', gap: 4 }}>
                {(['testnet', 'mainnet'] as PerpNetwork[]).map((n) => (
                  <button
                    key={n}
                    className={network === n ? 'bevel-btn b-sm b-cyan' : 'bevel-btn b-sm'}
                    style={network === n && n === 'mainnet' ? { background: 'linear-gradient(180deg,#ff5b8d,#ff2a6d)', color: '#fff' } : {}}
                    onClick={() => switchNetwork(n)}
                  >
                    {n.toUpperCase()}
                  </button>
                ))}
              </div>
              <button className="bevel-btn b-sm" onClick={() => void refreshAccount()} title="refresh account">↻</button>
            </div>

            {/* MARKET */}
            <div style={{ border: '2px solid var(--line)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="t9 dim">MARKET</span>
                {venue === 'hyperliquid' ? (
                  <button
                    className="bevel-btn b-sm"
                    onClick={() => (evm.address ? void evm.disconnect() : evm.available ? evm.connect().catch(() => play('error')) : openWalletHelp('evm'))}
                  >
                    {evm.address ? `🔷 ${shortAddr(evm.address, 4)}` : evm.available ? 'CONNECT WALLET' : 'INSTALL METAMASK'}
                  </button>
                ) : (
                  <span className="faint" style={{ fontSize: 14 }}>
                    {asterAuth ? `🔑 ${shortAddr(asterUser, 4)}` : 'NO AGENT KEY'}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={market?.symbol ?? ''}
                  onChange={(e) => {
                    setSymbol(e.target.value)
                    setLimitPx('')
                    setQuoteReset()
                  }}
                  style={{ fontSize: 20, padding: '8px 10px', maxWidth: '100%' }}
                >
                  {markets.map((m) => (
                    <option key={m.symbol} value={m.symbol}>
                      {m.symbol} @ {fmtPx(m.mark)}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: 'clamp(28px, 5vw, 38px)', color: 'var(--amber)', textShadow: 'var(--glow-amber)' }}>
                  {market ? fmtPx(market.mark) : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 15 }}>
                <span className="faint">FUNDING {market?.funding != null ? `${(market.funding * 100).toFixed(4)}%` : '—'}</span>
                <span className="faint">MAX LEV {market ? `${market.maxLeverage}x` : '—'}</span>
                <span className="faint">EQUITY {fmtUsd(equity)}</span>
                <span className="faint">AVAIL {fmtUsd(available)}</span>
              </div>
            </div>

            {/* SIDE + TYPE */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', gap: 4 }}>
                <button
                  className="bevel-btn b-sm"
                  style={side === 'LONG' ? { background: 'linear-gradient(180deg,#4ade80,#16a34a)', color: '#00140a' } : {}}
                  onClick={() => setSide('LONG')}
                >
                  ▲ LONG
                </button>
                <button
                  className="bevel-btn b-sm"
                  style={side === 'SHORT' ? { background: 'linear-gradient(180deg,#ff5b8d,#ff2a6d)', color: '#fff' } : {}}
                  onClick={() => setSide('SHORT')}
                >
                  ▼ SHORT
                </button>
              </div>
              <div style={{ display: 'inline-flex', gap: 4 }}>
                {(['MARKET', 'LIMIT'] as const).map((t) => (
                  <button key={t} className={orderType === t ? 'bevel-btn b-sm b-cyan' : 'bevel-btn b-sm'} onClick={() => setOrderType(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <label className="faint" style={{ fontSize: 14, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                LEV
                <select value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} style={{ fontSize: 14, padding: '4px 6px' }}>
                  {LEVERAGE_PRESETS.filter((l) => !market || l <= market.maxLeverage).map((l) => (
                    <option key={l} value={l}>{l}x</option>
                  ))}
                </select>
              </label>
            </div>

            {/* SIZE */}
            <div style={{ border: '2px solid var(--line)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={sizeUsd}
                  onChange={(e) => {
                    setSizeUsd(e.target.value.replace(/[^0-9.]/g, ''))
                    setErr(null)
                  }}
                  style={{ flex: 1, minWidth: 0, fontSize: 'clamp(32px, 6vw, 44px)', border: 'none', background: 'transparent', padding: '2px 0', color: 'var(--amber)', textShadow: 'var(--glow-amber)' }}
                />
                <span className="t9 dim">USD</span>
              </div>
              {orderType === 'LIMIT' && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    inputMode="decimal"
                    placeholder="LIMIT PRICE"
                    value={limitPx}
                    onChange={(e) => {
                      setLimitPx(e.target.value.replace(/[^0-9.]/g, ''))
                      setErr(null)
                    }}
                    style={{ flex: 1, minWidth: 0, fontSize: 24, border: 'none', background: 'transparent', padding: '2px 0', color: 'var(--cyan)', textShadow: 'var(--glow-cyan)' }}
                  />
                  <span className="t9 dim">PX</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                <span className="faint" style={{ fontSize: 15 }}>
                  ≈ {sizeBase != null && market ? `${sizeBase} ${market.symbol.replace('USDT', '')}` : '—'} · {leverage}x
                </span>
                <span className="faint" style={{ fontSize: 15 }}>
                  {orderType === 'MARKET' ? 'IOC ±2% from mark' : 'GTC post to book'}
                </span>
              </div>
            </div>

            {/* VENUE AUTH */}
            {venue === 'hyperliquid' && evm.address && !hlAgentAddr && (
              <div className="stat-row">
                <span className="sk">AGENT</span>
                <span className="sv" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="bevel-btn b-sm" onClick={() => void createAgent()}>+ CREATE LOCAL AGENT (1 SIGN)</button>
                  <Switch checked={hlSessionOnly} onChange={setHlSessionOnly} label="SESSION ONLY" />
                </span>
              </div>
            )}
            {venue === 'hyperliquid' && evm.address && hlAgentAddr && (
              <div className="stat-row">
                <span className="sk">AGENT</span>
                <span className="sv">
                  {shortAddr(hlAgentAddr, 6)} — {hlSessionKey ? 'SESSION ONLY' : 'SILENT SIGN'}
                  <button className="bevel-btn b-sm" style={{ color: 'var(--red)', marginLeft: 8 }} onClick={() => { clearHlAgent(); setHlSessionKey(null); setHlAgentAddr(null); play('click') }}>⏏ FORGET</button>
                </span>
              </div>
            )}
            {venue === 'aster' && !asterAuth && (
              <div style={{ border: '2px solid var(--line)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className="t9 dim">ASTER AGENT — BROWSER ONLY, NEVER LEAVES THIS DEVICE</span>
                <input placeholder="MAIN WALLET (0x…)…" value={asterUser} onChange={(e) => setAsterUser(e.target.value.trim())} style={{ width: '100%' }} />
                <input
                  type="password"
                  placeholder="AGENT PRIVATE KEY (0x…)…"
                  value={asterKey}
                  onChange={(e) => setAsterKey(e.target.value.trim())}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="bevel-btn b-sm b-cyan" onClick={saveAster}>✓ SAVE AGENT</button>
                  <Switch checked={asterSessionOnly} onChange={setAsterSessionOnly} label="SESSION ONLY" />
                </div>
                <div className="faint" style={{ fontSize: 14 }}>
                  Create one at {isTestnet ? 'asterdex-testnet.com' : 'asterdex.com'} → API wallet → Pro API, approve from main wallet.
                  {isTestnet ? ' Funded testnet wallet required.' : ' Main wallet must have deposited once (Aster rule).'}
                </div>
              </div>
            )}
            {venue === 'aster' && asterAuth && (
              <div className="stat-row">
                <span className="sk">AGENT</span>
                <span className="sv">
                  {asterSessionOnly ? 'SESSION ONLY' : 'SAVED — LOCAL ONLY'} <button className="bevel-btn b-sm" style={{ color: 'var(--red)', marginLeft: 8 }} onClick={() => { clearAsterCreds(); setAsterSaved(false); setAsterKey(''); play('click') }}>⏏ FORGET</button>
                </span>
              </div>
            )}

            {inputErr && sizeUsd.trim() && authed ? (
              <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>⚠ {inputErr}</div>
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
            {(phase === 'loading' || phase === 'sending' || phase === 'signing') && (
              <div className="blocks" style={{ textAlign: 'center' }}>
                {blocks((Date.now() / 3000) % 1, 22)}
              </div>
            )}

            <button
              className="bevel-btn b-lg"
              style={{
                width: '100%',
                fontSize: 15,
                padding: '14px 18px',
                ...(action.label.includes('CONNECT')
                  ? { background: 'linear-gradient(180deg,#4cf0fa,#05d9e8)', color: '#001416', borderColor: '#b3f7fb' }
                  : action.label.includes('LONG')
                    ? { background: 'linear-gradient(180deg,#4ade80,#16a34a)', color: '#00140a' }
                    : action.label.includes('SHORT')
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
                <span className="t9 dim">OPEN POSITIONS</span>
                {positions.map((p, i) => (
                  <div className="stat-row" key={`${p.symbol}-${i}`} style={{ alignItems: 'center' }}>
                    <span className="sk" style={{ color: p.side === 'LONG' ? 'var(--green)' : 'var(--red)' }}>
                      {p.side} {p.symbol} {p.leverage}x
                    </span>
                    <span className="sv" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ color: p.upnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {p.upnl >= 0 ? '+' : ''}{fmtUsd(Math.abs(p.upnl))}
                      </span>
                      <button className="bevel-btn b-sm" style={{ color: 'var(--red)' }} onClick={() => void doClose(p)}>
                        ✕ CLOSE
                      </button>
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
                    <span className="sk">{o.side} {o.size} {o.symbol} @ {fmtPx(o.price)}</span>
                    <span className="sv">
                      <button className="bevel-btn b-sm" style={{ color: 'var(--red)' }} onClick={() => void doCancel(o)}>
                        ✕ CANCEL
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* TP/SL — reduce-only triggers on an open position */}
            {positions.length > 0 && authed && (
              <div style={{ border: '2px solid var(--line)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span className="t9 dim">TP / SL — REDUCE-ONLY TRIGGERS</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select
                    value={tpslSymbol || positions[0].symbol}
                    onChange={(e) => setTpslSymbol(e.target.value)}
                    style={{ fontSize: 16, padding: '6px 8px' }}
                  >
                    {positions.map((p, i) => (
                      <option key={`${p.symbol}-${i}`} value={p.symbol}>
                        {p.side} {p.symbol}
                      </option>
                    ))}
                  </select>
                  <input
                    inputMode="decimal"
                    placeholder="TP PRICE"
                    value={tpPx}
                    onChange={(e) => setTpPx(e.target.value.replace(/[^0-9.]/g, ''))}
                    style={{ flex: 1, minWidth: 120, fontSize: 18, padding: '6px 8px' }}
                  />
                  <input
                    inputMode="decimal"
                    placeholder="SL PRICE"
                    value={slPx}
                    onChange={(e) => setSlPx(e.target.value.replace(/[^0-9.]/g, ''))}
                    style={{ flex: 1, minWidth: 120, fontSize: 18, padding: '6px 8px' }}
                  />
                  <button className="bevel-btn b-sm b-cyan" onClick={() => void doTpSl()}>ARM TP/SL</button>
                </div>
                <div className="faint" style={{ fontSize: 14 }}>
                  Triggers market-close when hit. Set either or both — wallet popup (or silent agent sign) confirms.
                </div>
              </div>
            )}

            <div className="faint" style={{ fontSize: 14 }}>
              {venue === 'hyperliquid'
                ? 'Hyperliquid perps · wallet signs each order (or 1-click local agent) · nothing submits until you sign.'
                : 'Aster perps · agent key signs locally in your browser · nothing submits without your CONFIRM.'}
              {' '}Long/short {isTestnet ? 'TESTNET' : 'MAINNET'} — real PnL only on mainnet.
            </div>
          </div>
        </Panel>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <button className="bevel-btn b-lg b-cyan" onClick={() => nav('/')}>◀ BACK TO DESKTOP</button>
        </div>
      </div>

      {/* confirm */}
      {confirmOpen && market && sizeBase != null && (
        <SystemDialog
          title={`CONFIRM ${side} — USER APPROVAL REQUIRED`}
          onClose={() => setConfirmOpen(false)}
          actions={
            <>
              <button className="bevel-btn" onClick={() => setConfirmOpen(false)}>✕ CANCEL</button>
              <button
                className="bevel-btn b-danger"
                style={side === 'LONG' ? { background: 'linear-gradient(180deg,#4ade80,#16a34a)', color: '#00140a' } : {}}
                onClick={() => void doOrder()}
              >
                ✓ CONFIRM {side}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="stat-row"><span className="sk">VENUE</span><span className="sv">{provider.label} · {network.toUpperCase()}</span></div>
            <div className="stat-row"><span className="sk">ORDER</span><span className="sv">{side} {sizeBase} {market.symbol} · {orderType}</span></div>
            <div className="stat-row"><span className="sk">NOTIONAL</span><span className="sv">≈ {fmtUsd(sizeNum)} @ {fmtPx(orderType === 'LIMIT' ? Number(limitPx) : market.mark)}</span></div>
            <div className="stat-row"><span className="sk">LEVERAGE</span><span className="sv">{Math.min(leverage, market.maxLeverage)}x</span></div>
            {venue === 'hyperliquid' && !hlAuth?.agentKey && (
              <div className="faint" style={{ fontSize: 14 }}>After CONFIRM, your wallet opens — sign there. Nothing submits until you sign.</div>
            )}
            {isTestnet && <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>TESTNET — no real funds. Fund the testnet account first (HL faucet / Aster testnet).</div>}
          </div>
        </SystemDialog>
      )}
    </div>
  )
}
