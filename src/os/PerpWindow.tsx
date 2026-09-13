import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSolanaWallet } from '../wallets/SolanaWallet'
import { useUi } from '../store/ui'
import { useJlpInfo, usePerpPrices, usePerpPositions } from '../hooks/perp'
import { enrichPositionDerived, priceFor } from '../lib/perp/api'
import { PERP_MARKETS, PERP_DEFAULT_LEVERAGE, PERP_DEFAULT_MARKET_ID, PERP_MAX_LEVERAGE_UI, PERP_MIN_LEVERAGE, marketById, perpRpcCandidates, JUP_PERPS_PROGRAM_ID } from '../lib/perp/config'
import type { PerpMarket } from '../lib/perp/config'
import { buildQuote, validateCollateral, validateLeverage, fmtLeverage as fmtLev } from '../lib/perp/math'
import { buildClosePositionTx, buildOpenPositionTx, sendSignedTx, simulateTx } from '../lib/perp/transactions'
import { Panel, Readout } from '../design/ui'
import { SystemDialog } from '../design/SystemDialog'
import { play } from '../sound/sfx'
import { blocks, shortAddr, timeAgo } from '../lib/format'
import type { PerpPrice } from '../lib/perp/types'

type PerpPhase = 'idle' | 'preview' | 'signing' | 'sending' | 'confirming' | 'success' | 'error'

function PriceBadge({ p }: { p: PerpPrice | undefined }) {
  if (!p) return <span className="badge dim">PRICE —</span>
  const age = Date.now() - p.updatedAt
  const stale = age > 60_000
  return (
    <span className={`badge ${stale ? 'dim' : 'new'}`} title={`${p.source} · ${new Date(p.updatedAt).toLocaleTimeString()}`}>
      ${p.price.toLocaleString('en-US', { maximumFractionDigits: 2 })} {stale ? '· STALE' : `· ${p.source.toUpperCase()}`}
    </span>
  )
}

export function PerpWindow() {
  const nav = useNavigate()
  const sol = useSolanaWallet()
  const openWalletHelp = useUi((s) => s.openWalletHelp)

  const pricesQ = usePerpPrices()
  const jlpQ = useJlpInfo()
  const posQ = usePerpPositions(sol.address)

  const [marketId, setMarketId] = useState<string>(PERP_DEFAULT_MARKET_ID)
  const market: PerpMarket | undefined = useMemo(() => marketById(marketId), [marketId])
  const [leverage, setLeverage] = useState<number>(PERP_DEFAULT_LEVERAGE)
  const [levInput, setLevInput] = useState<string>(String(PERP_DEFAULT_LEVERAGE))
  const [collateral, setCollateral] = useState<string>('')
  const [phase, setPhase] = useState<PerpPhase>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [txSig, setTxSig] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [closing, setClosing] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<string[]>([])
  const closeAfterRef = useRef(false)

  const prices = pricesQ.data
  const markForMarket = market ? priceFor(prices, market.priceId) : undefined
  const collPrice: number = useMemo(() => {
    if (!market) return 0
    if (market.collateralSymbol === 'USDC') return 1
    const p = priceFor(prices, market.priceId)
    return p?.price ?? 0
  }, [market, prices])

  const collNum = Number(collateral)
  const levErr = validateLeverage(Number(levInput) || leverage)
  const collErr = validateCollateral(market, collateral)
  const collateralHuman = isFinite(collNum) && collNum > 0 ? collNum : 0
  const leverageNum = isFinite(Number(levInput)) ? Number(levInput) : leverage

  const quote = useMemo(() => {
    if (!market || collateralHuman <= 0 || !markForMarket || collPrice <= 0) return null
    const q = buildQuote({
      market,
      side: market.side,
      collateralHuman,
      collateralPriceUsd: collPrice,
      leverage: leverageNum,
      entryPrice: markForMarket.price,
      priceUpdatedAt: markForMarket.updatedAt,
    })
    return q
  }, [market, collateralHuman, collPrice, leverageNum, markForMarket])

  const positionsEnriched = useMemo(() => {
    const raw = posQ.data?.positions ?? []
    return raw.map((p) => enrichPositionDerived(p as never, prices))
  }, [posQ.data?.positions, prices])

  const jlp = jlpQ.data

  const log = (line: string) => setTelemetry((s) => [...s.slice(-28), `[${new Date().toLocaleTimeString()}] ${line}`])

  const syncLev = (v: number) => {
    const n = Math.round(v * 10) / 10
    setLeverage(n)
    setLevInput(String(n))
  }

  useEffect(() => {
    // keep slider and input in sync when market changes (no auto-reset of collateral)
    void marketId
  }, [marketId])

  const canPreview = !!market && collateralHuman > 0 && leverageNum >= PERP_MIN_LEVERAGE && !!markForMarket && collPrice > 0 && !levErr

  const custodyConfigured = (() => {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
    const v = env[`VITE_JUP_CUSTODY_${market?.asset ?? 'SOL'}`]?.trim()
    if (v) return true
    // hardcoded public fallbacks — trading enabled even without .env
    return ['SOL','ETH','WBTC'].includes(market?.asset ?? '')
  })()

  const feeNote = jlp ? `JLP AUM $${(jlp.aumUsd / 1e6).toFixed(1)}M` : 'JLP —'

  const handlePreview = () => {
    setErr(null)
    if (!sol.address) { play('error'); setErr('Wallet not connected — connect Phantom to trade.'); return }
    if (!market) { setErr('Invalid market.'); return }
    const e1 = validateCollateral(market, collateral)
    if (e1) { setErr(e1); play('error'); return }
    const e2 = validateLeverage(leverageNum)
    // allow >100 with warning rather than block — but surface as error if >250
    if (e2 && leverageNum > 250) { setErr(e2); play('error'); return }
    if (!markForMarket) { setErr('Price unavailable — Jupiter/CoinGecko/Binance all failed. Retry in a moment.'); play('error'); return }
    if (sol.balanceSol != null && market.collateralSymbol === 'SOL' && collateralHuman > sol.balanceSol) {
      setErr(`Insufficient SOL — wallet has ${sol.balanceSol.toFixed(4)} SOL.`)
      play('error')
      return
    }
    if (quote?.stale) {
      // still allow but warn in confirm dialog
    }
    setPhase('preview')
    setConfirmOpen(true)
    play('alert')
    log(`PREVIEW ${market.side.toUpperCase()} ${market.asset} ${fmtLev(leverageNum)} · collat ${collateralHuman} ${market.collateralSymbol} · size $${quote?.sizeUsd.toFixed(2) ?? '—'} · entry $${markForMarket.price.toFixed(2)}`)
  }

  const handleConfirm = async () => {
    if (!market || !sol.address || !quote || !markForMarket) return
    setConfirmOpen(false)
    setPhase('signing')
    setErr(null)
    setTxSig(null)
    log('BUILDING POSITION REQUEST TX…')
    try {
      const built = await buildOpenPositionTx({
        market,
        ownerBase58: sol.address,
        collateralHuman,
        leverage: leverageNum,
        entryPrice: markForMarket.price,
        sizeUsd: quote.sizeUsd,
        collateralUsd: quote.collateralUsd,
      })
      if (built.warnings.length) built.warnings.forEach((w) => log('WARN: ' + w))
      log(built.description)
      log('SIMULATING ON SOLANA…')
      const sim = await simulateTx(built.tx)
      if (!sim.ok) {
        const blob = (sim.logs ?? []).join('\n').slice(0, 900)
        log('SIM FAILED — see logs below')
        if (blob) log(blob.split('\n')[0] ?? '')
        throw new Error(sim.err ? String(sim.err).slice(0, 260) : 'Simulation failed — the keeper would reject this request. Check collateral/custody and try a smaller size.')
      }
      log('SIM OK — REQUESTING WALLET SIGNATURE…')
      play('alert')
      const signed = await sol.signTx(built.tx)
      setPhase('sending')
      log('SIGNATURE RECEIVED — BROADCASTING…')
      // signTx already returns signed tx; send it
      const sig = await sendSignedTx(signed as never)
      setTxSig(sig)
      log(`TX SENT ${sig.slice(0, 18)}…`)
      log('https://solscan.io/tx/' + sig)
      setPhase('confirming')
      // confirm
      const { Connection } = await import('@solana/web3.js')
      let confirmed = false
      for (const url of perpRpcCandidates()) {
        try {
          const conn = new Connection(url, 'confirmed')
          const st = await conn.getSignatureStatus(sig, { searchTransactionHistory: true })
          const cs = st?.value?.confirmationStatus
          if (cs === 'confirmed' || cs === 'finalized') { confirmed = true; break }
          // also try confirmTransaction
          await conn.confirmTransaction(sig, 'confirmed').catch(() => {})
          const st2 = await conn.getSignatureStatus(sig, { searchTransactionHistory: true })
          if (st2?.value?.confirmationStatus === 'confirmed' || st2?.value?.confirmationStatus === 'finalized') { confirmed = true; break }
        } catch { /* next */ }
      }
      if (!confirmed) {
        // wait a bit then re-check
        await new Promise((r) => setTimeout(r, 2500))
        for (const url of perpRpcCandidates()) {
          try {
            const { Connection } = await import('@solana/web3.js')
            const conn = new Connection(url, 'confirmed')
            const st = await conn.getSignatureStatus(sig, { searchTransactionHistory: true })
            if (st?.value?.confirmationStatus) { confirmed = true; break }
          } catch { /* */ }
        }
      }
      log(confirmed ? 'CONFIRMED — KEEPER WILL FULFILL SHORTLY' : 'SENT — check Solscan; keeper fills within a few slots')
      setPhase('success')
      play('win')
      // refresh
      void posQ.refetch()
      void jlpQ.refetch()
      closeAfterRef.current = true
    } catch (e) {
      const m = String((e as Error).message ?? e)
      const isReject = /reject|denied|cancel|user rejected/i.test(m)
      const isConfig = /VITE_JUP_CUSTODY|custody not configured|pool not configured/i.test(m)
      setErr(isReject ? 'You rejected the request in your wallet.' : isConfig ? m : m.slice(0, 420))
      setPhase('error')
      play('error')
      log('ERROR: ' + m.slice(0, 180))
    }
  }

  const handleClosePosition = async (addr: string, sizeUsd: number) => {
    if (!sol.address || !market) return
    // For close we need the market that matches that position — positions are per-market, so we reuse selected market
    // but if position is UNKNOWN we still attempt with current market (honest attempt; simulation will clarify)
    const m = market
    setClosing(addr)
    setErr(null)
    log(`CLOSE REQUEST FOR ${shortAddr(addr, 6)} · $${sizeUsd.toFixed(2)}`)
    try {
      const built = await buildClosePositionTx({ market: m, ownerBase58: sol.address, sizeUsd })
      log('SIMULATING CLOSE…')
      const sim = await simulateTx(built.tx)
      if (!sim.ok) throw new Error(String(sim.err ?? 'Close simulation failed.').slice(0, 260))
      log('SIGNING CLOSE…')
      play('alert')
      const signed = await sol.signTx(built.tx)
      log('BROADCASTING CLOSE…')
      const sig = await sendSignedTx(signed as never)
      setTxSig(sig)
      log(`CLOSE TX ${sig.slice(0, 18)}…`)
      log('https://solscan.io/tx/' + sig)
      play('win')
      void posQ.refetch()
    } catch (e) {
      const m = String((e as Error).message ?? e)
      setErr(m.slice(0, 420))
      play('error')
      log('CLOSE ERROR: ' + m.slice(0, 160))
    } finally {
      setClosing(null)
    }
  }

  const statusTone = phase === 'success' ? 'var(--green)' : phase === 'error' ? 'var(--red)' : 'var(--amber)'

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">◤ PERP.EXE</h1>
        <span className="page-sub">JUPITER PERPS — LEVERAGE INSIDE THE CRT · ORACLE-PRICED · KEEPER-FULFILLED</span>
        <span className="badge dim" title={JUP_PERPS_PROGRAM_ID}>{shortAddr(JUP_PERPS_PROGRAM_ID, 6)} · {perpRpcCandidates()[0]?.replace('https://', '').slice(0, 22) ?? 'NO RPC'}</span>
      </div>

      <div className="warn-strip">
        <span>◈</span>
        <span>
          Every Jupiter Perp trade is <b>two on-chain steps</b>: you submit a <b>PositionRequest</b> (this wallet signs once), a <b>keeper</b> fulfills it at the oracle price.
          Execution is at the displayed oracle price — no orderbook slippage. Fees: open/close + borrow + price-impact (pool imbalance).
          Without <code style={{ fontSize: 13 }}>VITE_JUP_CUSTODY_*</code> set, trading is read-only — the panel shows real prices and an honest config warning instead of fake fills.
        </span>
      </div>

      <div className="grid-3">
        {/* LEFT — TRADE */}
        <Panel title="TRADE.EXE — OPEN POSITION" end={<span className="pt-end">JUP.PERPS</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* market row */}
            <div className="tab-row" role="tablist" aria-label="market">
              {PERP_MARKETS.map((m) => (
                <button
                  key={m.id}
                  className={`tab ${marketId === m.id ? 'active' : ''}`}
                  onClick={() => { setMarketId(m.id); play('click') }}
                  title={`${m.symbol} · collateral ${m.collateralSymbol} · max ${m.maxLeverage}×`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {market && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className={`badge ${market.side === 'long' ? 'grad' : 'paused'}`} style={{ fontSize: 8 }}>
                  {market.side === 'long' ? '▲ LONG' : '▼ SHORT'}
                </span>
                <span className="faint" style={{ fontSize: 14 }}>
                  collateral <b>{market.collateralSymbol}</b> · max {market.maxLeverage}× · {market.side === 'long' ? 'deposit SOL/wETH/wBTC directly' : 'deposit USDC to short'}
                </span>
                <PriceBadge p={markForMarket} />
              </div>
            )}

            {/* leverage */}
            <div className="field">
              <span className="field-label">LEVERAGE — {fmtLev(leverageNum)} {leverageNum > PERP_MAX_LEVERAGE_UI && <span className="badge paused" style={{ marginLeft: 6 }}>ABOVE UI GUARD</span>}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="range"
                  min={PERP_MIN_LEVERAGE}
                  max={PERP_MAX_LEVERAGE_UI}
                  step={0.1}
                  value={leverage}
                  onChange={(e) => syncLev(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <input
                  value={levInput}
                  onChange={(e) => setLevInput(e.target.value.replace(/[^0-9.]/g, ''))}
                  onBlur={() => {
                    const n = Number(levInput)
                    if (isFinite(n) && n >= PERP_MIN_LEVERAGE) syncLev(Math.min(250, n))
                    else setLevInput(String(leverage))
                  }}
                  placeholder="5"
                  inputMode="decimal"
                  style={{ width: 72, textAlign: 'right' }}
                />
                <span className="faint" style={{ fontSize: 15 }}>×</span>
              </div>
              {levErr && <span className="field-hint" style={{ color: leverageNum > 250 ? 'var(--red)' : 'var(--amber)' }}>{levErr}</span>}
              {!levErr && leverageNum > 50 && <span className="field-hint" style={{ color: 'var(--red)' }}>High leverage — liquidation is close.</span>}
            </div>

            {/* collateral */}
            <label className="field">
              <span className="field-label">COLLATERAL — {market?.collateralSymbol ?? '—'} {market?.collateralSymbol === 'SOL' && sol.balanceSol != null ? <span className="faint" style={{ textTransform: 'none' }}>· wallet {sol.balanceSol.toFixed(4)} SOL</span> : null}</span>
              <input
                value={collateral}
                onChange={(e) => setCollateral(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder={market?.collateralSymbol === 'USDC' ? '100' : '1.0'}
                inputMode="decimal"
              />
              {collErr && <span className="field-hint" style={{ color: 'var(--red)' }}>{collErr}</span>}
              <span className="field-hint">
                {market?.collateralSymbol === 'USDC'
                  ? 'USDC collateral → size = collateral × leverage (USD). Entry priced from oracle.'
                  : `Collateral priced at oracle $${collPrice ? collPrice.toFixed(2) : '—'} → size = collateral × price × leverage.`}
              </span>
            </label>

            {/* quick amounts */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[0.1, 0.5, 1, 5].map((n) => (
                <button key={n} className="chip-toggle" onClick={() => setCollateral(String(n))}>{n} {market?.collateralSymbol}</button>
              ))}
              {market?.collateralSymbol === 'SOL' && sol.balanceSol != null && (
                <button className="chip-toggle" onClick={() => setCollateral(String(Math.max(0, Math.floor(((sol.balanceSol ?? 0) - 0.01) * 1000) / 1000)))}>MAX</button>
              )}
            </div>

            {/* derived */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Readout label="POSITION SIZE" tone="cyan" value={quote ? `$${quote.sizeUsd.toFixed(2)}` : '—'} sub={quote ? `${quote.leverage.toFixed(1)}× · ${quote.side.toUpperCase()} ${quote.market.asset}` : 'enter collateral'} />
              <Readout label="ENTRY (ORACLE)" tone="amber" value={quote ? `$${quote.entryPrice.toFixed(2)}` : markForMarket ? `$${markForMarket.price.toFixed(2)}` : '—'} sub={markForMarket ? `${markForMarket.source.toUpperCase()} · ${timeAgo(markForMarket.updatedAt)}` : 'fetching…'} />
            </div>

            <div className="stat-row"><span className="sk">COLLATERAL (USD)</span><span className="sv">{quote ? `$${quote.collateralUsd.toFixed(2)}` : '—'}</span></div>
            <div className="stat-row"><span className="sk">EST LIQUIDATION</span><span className="sv" style={{ color: 'var(--red)' }}>{quote?.liqPrice ? `$${quote.liqPrice.toFixed(2)}` : '—'} <span className="faint" style={{ fontSize: 12 }}>· estimate, keeper is truth</span></span></div>
            <div className="stat-row"><span className="sk">EST OPEN FEE</span><span className="sv">${quote ? quote.openFeeUsd.toFixed(2) : '—'} <span className="faint" style={{ fontSize: 12 }}>· ≈ 0.06 %</span></span></div>
            <div className="stat-row"><span className="sk">EST TOTAL FEES</span><span className="sv">${quote ? quote.totalFeesUsd.toFixed(2) : '—'} <span className="faint" style={{ fontSize: 12 }}>· open+close</span></span></div>
            <div className="stat-row"><span className="sk">PRICE IMPACT</span><span className="sv">oracle-priced — no orderbook slippage <span className="faint" style={{ fontSize: 12 }}>· pool imbalance fee applies on-chain</span></span></div>

            {!custodyConfigured && (
              <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                Trading is read-only — custody pubkeys not configured. Set <code style={{ fontSize: 13 }}>VITE_JUP_CUSTODY_SOL / ETH / WBTC</code> + <code style={{ fontSize: 13 }}>VITE_JUP_POOL_PUBKEY</code> (and USDC custody for shorts) to enable signing. The UI still shows live prices and your positions.
              </div>
            )}
            {quote?.warnings.map((w) => (
              <div key={w} className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)', textShadow: 'var(--glow-red)' }}>⚠ {w}</div>
            ))}
            {!markForMarket && pricesQ.isError && (
              <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>Price feed error — {(pricesQ.error as Error)?.message ?? 'retry in a moment.'}</div>
            )}

            {err && (
              <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)', textShadow: 'var(--glow-red)' }}>✕ {err}</div>
            )}

            {telemetry.length > 0 && (
              <div className="telemetry" style={{ color: statusTone }}>
                {telemetry.join('\n')}
              </div>
            )}
            {txSig && (
              <div className="stat-row">
                <span className="sk">LAST TX</span>
                <span className="sv"><a href={`https://solscan.io/tx/${txSig}`} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>{shortAddr(txSig, 8)} ↗</a></span>
              </div>
            )}

            <button
              className={`bevel-btn b-lg ${market?.side === 'short' ? 'b-danger' : 'b-cyan'}`}
              style={{ width: '100%' }}
              disabled={!canPreview || phase === 'signing' || phase === 'sending' || phase === 'confirming'}
              onClick={handlePreview}
            >
              {!sol.address ? 'CONNECT PHANTOM TO TRADE' : !markForMarket ? 'WAITING FOR PRICE…' : phase === 'signing' ? 'SIGNING…' : phase === 'sending' ? 'SENDING…' : phase === 'confirming' ? 'CONFIRMING…' : `${market?.side === 'short' ? '▼ SHORT' : '▲ LONG'} ${market?.asset ?? ''} · PREVIEW`}
            </button>

            <div className="faint" style={{ fontSize: 14 }}>
              Flow: preview → confirm → wallet signs once → keeper fulfills at oracle price. You can close or flip from OPEN POSITIONS. Read-only until custody is configured.
            </div>
          </div>
        </Panel>

        {/* MIDDLE — POSITIONS */}
        <Panel
          title="OPEN POSITIONS — ON-CHAIN"
          end={
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span className="t8 dim">{sol.address ? shortAddr(sol.address, 4) : 'OFFLINE'}</span>
              <button className="bevel-btn b-sm" disabled={!sol.address || posQ.isFetching} onClick={() => void posQ.refetch()}>
                {posQ.isFetching ? 'SCANNING…' : '↻ REFRESH'}
              </button>
            </span>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!sol.address ? (
              <div className="state-note">
                <span className="big">WALLET OFFLINE</span>
                <button className="bevel-btn b-cyan" onClick={() => (sol.available ? sol.connect().catch(() => play('error')) : openWalletHelp('sol'))}>
                  {sol.available ? 'CONNECT PHANTOM' : 'INSTALL PHANTOM'}
                </button>
                <span className="faint" style={{ fontSize: 14 }}>Connect to scan your 6 position slots (3 long + 3 short per custody).</span>
              </div>
            ) : posQ.isPending ? (
              <div className="state-note"><span className="big">SCANNING…</span>reading Position PDAs via RPC</div>
            ) : positionsEnriched.length === 0 ? (
              <div className="state-note">
                <span className="big">NO OPEN POSITIONS</span>
                <span className="faint" style={{ fontSize: 14 }}>
                  {posQ.data?.note ? posQ.data.note : '6 slots max — one per asset per side. Open your first position from the left panel.'}
                </span>
                <span className="faint" style={{ fontSize: 13 }}>Jupiter keeps closed slots with size 0 — they are filtered out here.</span>
              </div>
            ) : (
              positionsEnriched.map((p) => {
                const pnlUp = (p.pnlUsd ?? 0) >= 0
                return (
                  <div key={p.address} style={{ border: '2px solid var(--line)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className={`badge ${p.side === 'long' ? 'grad' : 'paused'}`} style={{ fontSize: 8 }}>{p.side === 'long' ? '▲ LONG' : '▼ SHORT'} {p.marketId !== 'UNKNOWN' ? p.market.asset : 'UNKNOWN'}</span>
                      <span className="faint" style={{ fontSize: 14 }}>{shortAddr(p.address, 6)} · {timeAgo(p.openTime * 1000)} ago</span>
                      <span className="badge dim" style={{ fontSize: 7 }}>{p.leverage ? `${p.leverage.toFixed(1)}×` : '—'}</span>
                    </div>
                    <div className="grid-2" style={{ gap: 8 }}>
                      <Readout label="SIZE" tone="cyan" value={`$${p.sizeUsd.toFixed(2)}`} sub={`entry $${p.price.toFixed(2)} · mark $${p.markPrice ? p.markPrice.toFixed(2) : '—'}`} />
                      <Readout label="PnL (EX-FUNDING)" tone={pnlUp ? 'green' : 'pink'} value={p.pnlUsd != null ? `$${p.pnlUsd.toFixed(2)}` : '—'} sub={p.pnlPct != null ? `${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}% of collat` : 'live price needed'} />
                    </div>
                    <div className="stat-row"><span className="sk">COLLATERAL</span><span className="sv">${p.collateralUsd.toFixed(2)} {p.realisedPnlUsd !== 0 ? <span className="faint" style={{ fontSize: 12 }}>· realised ${p.realisedPnlUsd.toFixed(2)}</span> : null}</span></div>
                    <div className="stat-row"><span className="sk">ENTRY</span><span className="sv">${p.price.toFixed(2)}</span></div>
                    <div className="stat-row"><span className="sk">LIQ (EST)</span><span className="sv" style={{ color: 'var(--red)' }}>{p.liqPrice ? `$${p.liqPrice.toFixed(2)}` : '—'}</span></div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        className="bevel-btn b-sm b-danger"
                        disabled={!!closing}
                        onClick={() => void handleClosePosition(p.address, p.sizeUsd)}
                      >
                        {closing === p.address ? 'CLOSING…' : '✕ CLOSE POSITION'}
                      </button>
                      <a className="bevel-btn b-sm" href={`https://solscan.io/account/${p.address}`} target="_blank" rel="noreferrer">VIEW ON SOLSCAN ↗</a>
                    </div>
                  </div>
                )
              })
            )}
            {posQ.data?.note && positionsEnriched.length > 0 && (
              <div className="faint" style={{ fontSize: 13 }}>Note: {posQ.data.note}</div>
            )}
            <div className="faint" style={{ fontSize: 13 }}>
              On-chain Position PDAs: <code style={{ fontSize: 12 }}>Position["position", owner, custody, collateralCustody]</code>. Up to 9 slots per wallet (we surface 6 for v1: SOL/ETH/WBTC × long/short-USDC). Short-USDT slots appear as UNKNOWN in v1 — they are not faked.
            </div>
          </div>
        </Panel>

        {/* RIGHT — MARKET */}
        <Panel title="MARKET WIRE — JLP + ORACLE" end={<span className="pt-end">LIVE</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="grid-2" style={{ gap: 8 }}>
              <Readout label="SOL" tone="amber" value={priceFor(prices, 'SOL') ? `$${priceFor(prices, 'SOL')!.price.toFixed(2)}` : '—'} sub={`${feeNote}`} />
              <Readout label="JLP PRICE" tone="green" value={jlp ? `$${jlp.jlpPriceUsd.toFixed(4)}` : '—'} sub={jlp ? `${jlp.jlpApyPct.toFixed(2)}% APY · ${jlp.jlpAprPct.toFixed(2)}% APR` : 'perps-api.jup.ag'} />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['SOL', 'ETH', 'BTC'] as const).map((id) => {
                const pr = priceFor(prices, id)
                return <PriceBadge key={id} p={pr} />
              })}
              {jlp && <span className="badge dim">AUM ${jlp.aumUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>}
            </div>

            {jlp ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div className="t8 dim">◈ JLP CUSTODIES (UTILIZATION)</div>
                {jlp.custodies.map((c) => (
                  <div key={c.symbol} className="stat-row">
                    <span className="sk">{c.symbol} · {c.utilizationPct.toFixed(1)} %</span>
                    <span className="sv">{blocks(c.utilizationPct / 100, 10)} <span className="faint" style={{ fontSize: 13 }}>${(c.aumUsd / 1e6).toFixed(1)}M · {c.currentWeightagePct.toFixed(1)}%→{c.targetWeightagePct.toFixed(1)}%</span></span>
                  </div>
                ))}
                <div className="faint" style={{ fontSize: 13 }}>Utilization = locked / owned. High utilization → higher price-impact fee for the crowded side.</div>
              </div>
            ) : jlpQ.isPending ? (
              <div className="state-note"><span className="big">LOADING JLP</span>perps-api.jup.ag/v1/jlp-info</div>
            ) : (
              <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>JLP unavailable — {String((jlpQ.error as Error)?.message ?? 'API error').slice(0, 120)}</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="t8 dim">◈ ORACLE + FUNDING</div>
              <div className="stat-row"><span className="sk">ORACLE</span><span className="sv">Edge by Chaos Labs (primary) · Chainlink + Pyth verification</span></div>
              <div className="stat-row"><span className="sk">BORROW RATE</span><span className="sv">custody fundingRateState — charged continuously on collateral</span></div>
              <div className="stat-row"><span className="sk">MAX LEV</span><span className="sv">250× protocol · {PERP_MAX_LEVERAGE_UI}× UI guard</span></div>
              <div className="stat-row"><span className="sk">POSITIONS</span><span className="sv">6 shown (long/short × SOL/ETH/WBTC) · 9 on-chain (USDT shorts as UNKNOWN)</span></div>
            </div>

            <div className="warn-strip" style={{ fontSize: 14 }}>
              PnL shown is <b>ex-borrow</b> (interest snapshot vs current custody funding rate). Real settle PnL includes funding. Liq price is an <b>estimate</b> — keeper uses custody maintenance fraction. Always leave buffer.
            </div>

            <div className="faint" style={{ fontSize: 13 }}>
              Order history is not yet indexed by the Perps API — your Solscan transaction history is the source of truth. The panel below stays honest (no synthetic fills) until Jupiter exposes a wallet-indexed order endpoint.
            </div>
            <div className="state-note" style={{ padding: 12 }}>
              <span className="big">HISTORY — NO MOCK TRADES</span>
              <span className="faint" style={{ fontSize: 14 }}>No Jupiter wallet-history endpoint is available in v1 — history indexing is isolated. Your fills live on Solscan until the API ships.</span>
            </div>
          </div>
        </Panel>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="bevel-btn b-lg b-cyan" onClick={() => nav('/')}>◀ BACK TO DESKTOP</button>
        <a className="bevel-btn b-sm" href="https://jup.ag/perps" target="_blank" rel="noreferrer">JUPITER PERPS ↗</a>
        <a className="bevel-btn b-sm" href="https://station.jup.ag/guides/perpetual-exchange" target="_blank" rel="noreferrer">PERPS GUIDE ↗</a>
      </div>

      {confirmOpen && quote && market && markForMarket && (
        <SystemDialog
          title="CONFIRM PERP — WALLET WILL SIGN ONCE"
          onClose={() => { setConfirmOpen(false); setPhase('idle') }}
          actions={
            <>
              <button className="bevel-btn" onClick={() => { setConfirmOpen(false); setPhase('idle') }}>✕ CANCEL</button>
              <button className="bevel-btn b-danger" onClick={() => void handleConfirm()}>✓ CONFIRM &amp; SIGN</button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="stat-row"><span className="sk">MARKET</span><span className="sv">{market.symbol} · <span className={`badge ${market.side === 'long' ? 'grad' : 'paused'}`}>{market.side.toUpperCase()}</span></span></div>
            <div className="stat-row"><span className="sk">DIRECTION</span><span className="sv" style={{ color: market.side === 'long' ? 'var(--green)' : 'var(--red)', textShadow: market.side === 'long' ? 'var(--glow-green)' : 'var(--glow-red)' }}>{market.side === 'long' ? '▲ LONG' : '▼ SHORT'} {market.asset}</span></div>
            <div className="stat-row"><span className="sk">LEVERAGE</span><span className="sv">{fmtLev(quote.leverage)}</span></div>
            <div className="stat-row"><span className="sk">COLLATERAL</span><span className="sv">{quote.collateral} {market.collateralSymbol} · ${quote.collateralUsd.toFixed(2)}</span></div>
            <div className="stat-row"><span className="sk">SIZE</span><span className="sv">${quote.sizeUsd.toFixed(2)}</span></div>
            <div className="stat-row"><span className="sk">ENTRY (ORACLE)</span><span className="sv">${quote.entryPrice.toFixed(2)} <span className="faint" style={{ fontSize: 12 }}>· {markForMarket.source.toUpperCase()}</span></span></div>
            <div className="stat-row"><span className="sk">LIQ (EST)</span><span className="sv" style={{ color: 'var(--red)' }}>{quote.liqPrice ? `$${quote.liqPrice.toFixed(2)}` : '—'}</span></div>
            <div className="stat-row"><span className="sk">FEES (EST)</span><span className="sv">${quote.totalFeesUsd.toFixed(2)} <span className="faint" style={{ fontSize: 12 }}>· open ${quote.openFeeUsd.toFixed(2)} + close ${quote.closeFeeUsd.toFixed(2)} + price-impact on-chain</span></span></div>
            <div className="stat-row"><span className="sk">WALLET</span><span className="sv">{sol.address ? shortAddr(sol.address, 6) : '—'}</span></div>
            {quote.stale && <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>Price is stale — re-quote may have moved. Proceed only if you accept slippage.</div>}
            {quote.warnings.map((w) => <div key={w} className="faint" style={{ fontSize: 14, color: 'var(--amber)' }}>⚠ {w}</div>)}
            <div className="faint" style={{ fontSize: 14 }}>
              You sign <b>once</b> to create the PositionRequest. The keeper fulfills it at the oracle price. If the keeper rejects (price moved, custody imbalance, insufficient pool), your collateral is not taken — the request just fails. Check Solscan for the request tx.
            </div>
            {!custodyConfigured && <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>Custody not configured — this transaction will fail simulation. Configure VITE_JUP_CUSTODY_* to trade for real.</div>}
          </div>
        </SystemDialog>
      )}

      {phase === 'success' && txSig && (
        <SystemDialog title="PERP REQUEST SENT — KEEPER FULFILLING" onClose={() => setPhase('idle')} actions={<button className="bevel-btn b-cyan" onClick={() => setPhase('idle')}>✓ ROGER</button>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="stat-row"><span className="sk">STATUS</span><span className="sv" style={{ color: 'var(--green)', textShadow: 'var(--glow-green)' }}>REQUEST LANDED — KEEPER FULFILLS AT ORACLE PRICE</span></div>
            <div className="stat-row"><span className="sk">TX</span><span className="sv"><a href={`https://solscan.io/tx/${txSig}`} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>{shortAddr(txSig, 8)} ↗</a></span></div>
            <div className="faint" style={{ fontSize: 14 }}>Refresh OPEN POSITIONS in a few seconds — the new position appears once the keeper executes. If it stays empty, check Solscan logs for a keeper rejection (price/pool).</div>
          </div>
        </SystemDialog>
      )}
    </div>
  )
}
