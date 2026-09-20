import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSolanaWallet } from '../wallets/SolanaWallet'
import { useUi } from '../store/ui'
import { Panel } from '../design/ui'
import { SystemDialog } from '../design/SystemDialog'
import { blocks, shortAddr } from '../lib/format'
import { play } from '../sound/sfx'
import { MINT_SOL, POPULAR_TOKENS, SOL_FEE_RESERVE, explorerTxUrl } from '../lib/dex/config'
import {
  executeOrder,
  fetchOrder,
  fetchPrices,
  formatTokenAmount,
  fromBaseUnits,
  getTokenBalanceHuman,
  isQuoteStale,
  isWalletRejection,
  mapExecuteError,
  mapOrderError,
  parseOrder,
  searchTokens,
  toBaseUnits,
  validateSwapInput,
  friendlyQuoteError,
  type DexToken,
  type ExecuteResponse,
  type OrderResponse,
  type ParsedQuote,
} from '../lib/dex/api'

type Phase = 'idle' | 'quoting' | 'ready' | 'signing' | 'sending' | 'success' | 'error'

const SOL_TOKEN: DexToken = { mint: MINT_SOL, symbol: 'SOL', name: 'Solana', decimals: 9 }
const USDC_TOKEN: DexToken = {
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
}

function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(s)
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function TokenIcon({ token, size = 26 }: { token: DexToken; size?: number }) {
  const [err, setErr] = useState(false)
  if (token.icon && !err) {
    return (
      <img
        src={token.icon}
        alt={token.symbol}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setErr(true)}
        style={{ width: size, height: size, imageRendering: 'auto' }}
      />
    )
  }
  return (
    <span
      className="token-logo"
      style={{ width: size, height: size, fontSize: 9 }}
      title={`${token.symbol} — no icon`}
    >
      {token.symbol.slice(0, 3)}
    </span>
  )
}

export function DexWindow() {
  const nav = useNavigate()
  const sol = useSolanaWallet()
  const openWalletHelp = useUi((s) => s.openWalletHelp)

  const [inputToken, setInputToken] = useState<DexToken>(SOL_TOKEN)
  const [outputToken, setOutputToken] = useState<DexToken>(USDC_TOKEN)
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState<'auto' | '50' | '100' | '300'>('auto')
  const [quote, setQuote] = useState<OrderResponse | null>(null)
  const [parsed, setParsed] = useState<ParsedQuote | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<string[]>([])
  const [txSig, setTxSig] = useState<string | null>(null)
  const [execResult, setExecResult] = useState<ExecuteResponse | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [successOpen, setSuccessOpen] = useState(false)
  const [tokenDialog, setTokenDialog] = useState<'in' | 'out' | null>(null)
  const [tokenQuery, setTokenQuery] = useState('')
  const [tokenResults, setTokenResults] = useState<DexToken[]>([])
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)
  const [balIn, setBalIn] = useState<number | null>(null)
  const [balOut, setBalOut] = useState<number | null>(null)
  const [priceMap, setPriceMap] = useState<Map<string, number>>(new Map())
  const busy = useRef(false)
  const quoteTimer = useRef<number | null>(null)

  const log = useCallback((l: string) => {
    setTelemetry((s) => [...s.slice(-24), `[${new Date().toLocaleTimeString()}] ${l}`])
  }, [])

  /* ---------- balances ---------- */
  const refreshBalances = useCallback(async () => {
    if (!sol.address) {
      setBalIn(null)
      setBalOut(null)
      return
    }
    const [a, b] = await Promise.all([
      getTokenBalanceHuman(sol.address, inputToken.mint),
      getTokenBalanceHuman(sol.address, outputToken.mint),
    ])
    setBalIn(a)
    setBalOut(b)
  }, [sol.address, inputToken.mint, outputToken.mint])

  useEffect(() => {
    void refreshBalances()
  }, [refreshBalances])

  /* ---------- usd fallback prices (quote already carries usd; this fills pre-quote) ---------- */
  useEffect(() => {
    let dead = false
    void fetchPrices([inputToken.mint, outputToken.mint])
      .then((m) => {
        if (!dead) setPriceMap(m)
      })
      .catch(() => {})
    return () => {
      dead = true
    }
  }, [inputToken.mint, outputToken.mint])

  /* ---------- token search (debounced) ---------- */
  useEffect(() => {
    if (tokenDialog == null) return
    const q = tokenQuery.trim()
    if (!q) {
      setTokenResults([])
      setSearchErr(null)
      return
    }
    if (quoteTimer.current) window.clearTimeout(quoteTimer.current)
    quoteTimer.current = window.setTimeout(() => {
      setSearching(true)
      setSearchErr(null)
      void searchTokens(q)
        .then((r) => {
          setTokenResults(r)
          if (r.length === 0) setSearchErr('No tokens found — try a symbol (SOL, JUP) or paste a mint address.')
        })
        .catch((e) => setSearchErr(String((e as Error).message ?? e).slice(0, 160)))
        .finally(() => setSearching(false))
    }, 350)
    return () => {
      if (quoteTimer.current) window.clearTimeout(quoteTimer.current)
    }
  }, [tokenQuery, tokenDialog])

  const pickToken = (t: DexToken) => {
    if (tokenDialog === 'in') {
      if (t.mint === outputToken.mint) {
        setOutputToken(inputToken)
      }
      setInputToken(t)
    } else if (tokenDialog === 'out') {
      if (t.mint === inputToken.mint) {
        setInputToken(outputToken)
      }
      setOutputToken(t)
    }
    setTokenDialog(null)
    setTokenQuery('')
    setTokenResults([])
    setQuote(null)
    setParsed(null)
    setPhase('idle')
    setErr(null)
    setTxSig(null)
    setExecResult(null)
    play('click')
  }

  const flip = () => {
    setInputToken(outputToken)
    setOutputToken(inputToken)
    setQuote(null)
    setParsed(null)
    setPhase('idle')
    setErr(null)
    setTxSig(null)
    setExecResult(null)
    play('open')
  }

  const amountNum = useMemo(() => (isFinite(Number(amount)) ? Number(amount) : 0), [amount])
  const inputErr = validateSwapInput({
    amountHuman: amount,
    inputDecimals: inputToken.decimals,
    balanceHuman: null, // balance checked at quote time for honest RPC states; pre-check would block on slow RPC
    inputMint: inputToken.mint,
    outputMint: outputToken.mint,
    walletConnected: !!sol.address,
  })
  // Show balance hint separately so slow/unknown balances never block quoting.
  const balanceHint =
    balIn != null && amountNum > balIn
      ? `Insufficient balance — wallet has ${balIn.toFixed(4)} ${inputToken.symbol}.`
      : null

  /* ---------- quote ---------- */
  const doQuote = useCallback(async () => {
    if (!sol.address) return
    const v = validateSwapInput({
      amountHuman: amount,
      inputDecimals: inputToken.decimals,
      balanceHuman: balIn,
      inputMint: inputToken.mint,
      outputMint: outputToken.mint,
      walletConnected: true,
    })
    if (v) {
      setErr(v)
      setPhase('error')
      play('error')
      return
    }
    if (busy.current) return
    busy.current = true
    setPhase('quoting')
    setErr(null)
    setTxSig(null)
    setExecResult(null)
    log(`QUOTE ${amount} ${inputToken.symbol} → ${outputToken.symbol}…`)
    try {
      const amountBase = toBaseUnits(amount, inputToken.decimals)
      const order = await fetchOrder({
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        amountBase,
        taker: sol.address,
        slippageBps: slippage === 'auto' ? null : Number(slippage),
      })
      if (!order.transaction) {
        throw new Error(mapOrderError(order))
      }
      const p = parseOrder(order, inputToken.decimals, outputToken.decimals)
      setQuote(order)
      setParsed(p)
      setPhase('ready')
      play('coin')
      log(`BEST ${p.routerLabel} · OUT ≈ ${formatTokenAmount(p.outHuman, outputToken.decimals)} ${outputToken.symbol}`)
      if (p.priceImpactPct != null) log(`IMPACT ${p.priceImpactPct >= 0 ? '+' : ''}${p.priceImpactPct.toFixed(3)}%`)
    } catch (e) {
      const m = String((e as Error).message ?? e)
      setErr(friendlyQuoteError(m))
      setPhase('error')
      play('error')
      log('QUOTE FAILED — ' + m.slice(0, 120))
    } finally {
      busy.current = false
    }
  }, [sol.address, amount, inputToken, outputToken, balIn, slippage, log])

  /* ---------- swap: fresh order → wallet sign → /execute ---------- */
  const doSwap = useCallback(async () => {
    if (!sol.address || !quote || !parsed) return
    if (busy.current) return
    busy.current = true
    setConfirmOpen(false)
    setErr(null)
    try {
      // Stale protection: re-quote immediately before signing so the user
      // always signs a fresh transaction (RFQ quotes are short-lived).
      const stale = isQuoteStale(parsed.fetchedAt, parsed.expireAtMs)
      let liveQuote = quote
      let liveParsed = parsed
      if (stale) {
        log('QUOTE STALE — RE-QUOTING BEFORE SIGN…')
        setPhase('quoting')
        const amountBase = toBaseUnits(amount, inputToken.decimals)
        const fresh = await fetchOrder({
          inputMint: inputToken.mint,
          outputMint: outputToken.mint,
          amountBase,
          taker: sol.address,
          slippageBps: slippage === 'auto' ? null : Number(slippage),
        })
        if (!fresh.transaction) throw new Error(mapOrderError(fresh))
        liveQuote = fresh
        liveParsed = parseOrder(fresh, inputToken.decimals, outputToken.decimals)
        setQuote(fresh)
        setParsed(liveParsed)
        log(`FRESH ${liveParsed.routerLabel} · OUT ≈ ${formatTokenAmount(liveParsed.outHuman, outputToken.decimals)} ${outputToken.symbol}`)
      }

      setPhase('signing')
      log('REQUESTING WALLET SIGNATURE…')
      play('alert')
      const web3 = await import('@solana/web3.js')
      const raw = b64ToBytes(liveQuote.transaction as string)
      let tx: import('@solana/web3.js').VersionedTransaction
      try {
        tx = web3.VersionedTransaction.deserialize(raw)
      } catch {
        throw new Error('Jupiter returned a transaction this wallet cannot read — re-quote and retry.')
      }
      let signed: import('@solana/web3.js').VersionedTransaction
      try {
        signed = (await sol.signTx(tx)) as import('@solana/web3.js').VersionedTransaction
      } catch (e) {
        const m = String((e as Error).message ?? e)
        if (isWalletRejection(m)) throw new Error('You rejected the request in your wallet.', { cause: e })
        throw e
      }
      const signedB64 = bytesToB64(signed.serialize() as Uint8Array)

      setPhase('sending')
      log('SIGNATURE RECEIVED — EXECUTING VIA JUPITER…')
      const res = await executeOrder({ signedTransaction: signedB64, requestId: liveQuote.requestId })
      if (!res.signature) throw new Error(res.error || 'Jupiter returned no signature — check your wallet activity.')
      setTxSig(res.signature)
      setExecResult(res)
      log(`TX ${res.signature.slice(0, 18)}…`)
      log(explorerTxUrl(res.signature))
      if (res.status === 'Success') {
        const outHuman =
          res.totalOutputAmount != null
            ? fromBaseUnits(res.totalOutputAmount, outputToken.decimals)
            : liveParsed.outHuman
        log(`✓ SWAP COMPLETE — ≈ ${formatTokenAmount(outHuman, outputToken.decimals)} ${outputToken.symbol} RECEIVED`)
        setPhase('success')
        setSuccessOpen(true)
        play('win')
        void refreshBalances()
        void sol.refreshBalance()
      } else {
        throw new Error(mapExecuteError(res.code, res.error))
      }
    } catch (e) {
      const m = String((e as Error).message ?? e)
      play('error')
      if (/rejected/i.test(m) && m.length < 80) {
        setErr(m)
      } else {
        setErr(m.slice(0, 420))
      }
      setPhase(liveQuoteSafe() ? 'ready' : 'error')
      log('ERROR — ' + m.slice(0, 140))
    } finally {
      busy.current = false
    }
    function liveQuoteSafe() {
      return true
    }
  }, [sol, quote, parsed, amount, inputToken, outputToken, slippage, log, refreshBalances])

  const resetAll = () => {
    setAmount('')
    setQuote(null)
    setParsed(null)
    setPhase('idle')
    setErr(null)
    setTelemetry([])
    setTxSig(null)
    setExecResult(null)
    setSuccessOpen(false)
    play('click')
  }

  /* ---------- contextual action ---------- */
  const action = useMemo(() => {
    if (!sol.address) {
      return {
        label: '👻 CONNECT WALLET',
        act: () => (sol.available ? sol.connect().catch(() => play('error')) : openWalletHelp('sol')),
        disabled: false,
      }
    }
    if (!amount.trim() || amountNum <= 0) return { label: 'ENTER AMOUNT', act: () => {}, disabled: true }
    if (inputErr) return { label: 'CHECK INPUT', act: () => void doQuote(), disabled: false }
    if (phase === 'quoting') return { label: 'QUOTING…', act: () => {}, disabled: true }
    if (phase === 'signing') return { label: 'SIGNING…', act: () => {}, disabled: true }
    if (phase === 'sending') return { label: 'EXECUTING…', act: () => {}, disabled: true }
    if (!quote || !parsed) return { label: '◎ GET QUOTE', act: () => void doQuote(), disabled: false }
    return {
      label: '▣ SWAP NOW',
      act: () => {
        setConfirmOpen(true)
        play('alert')
      },
      disabled: false,
    }
  }, [sol, amount, amountNum, inputErr, phase, quote, parsed, openWalletHelp, doQuote])

  const statusTone = phase === 'success' ? 'var(--green)' : phase === 'error' ? 'var(--red)' : 'var(--amber)'
  const staleWarn = parsed ? isQuoteStale(parsed.fetchedAt, parsed.expireAtMs) : false
  const usdIn = parsed?.usdIn ?? (priceMap.get(inputToken.mint) != null && amountNum > 0 ? priceMap.get(inputToken.mint)! * amountNum : null)
  const usdOut = parsed?.usdOut ?? (parsed ? null : priceMap.get(outputToken.mint) != null && parsed ? null : null)

  const setMax = () => {
    if (balIn == null || !isFinite(balIn) || balIn <= 0) return
    const reserve = inputToken.mint === MINT_SOL ? SOL_FEE_RESERVE : 0
    const send = Math.max(0, balIn - reserve)
    const decimals = Math.min(6, inputToken.decimals)
    setAmount(String(Math.floor(send * 10 ** decimals) / 10 ** decimals))
    play('click')
  }

  const popularPlusResults = useMemo(() => {
    const seen = new Set<string>()
    const list: DexToken[] = []
    for (const p of POPULAR_TOKENS) {
      const key = p.mint.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      list.push({ mint: p.mint, symbol: p.symbol, name: p.name, decimals: p.decimals })
    }
    for (const t of tokenResults) {
      const key = t.mint.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      list.push(t)
    }
    return list
  }, [tokenResults])

  return (
    <div className="page" style={{ alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: '70vh' }}>
      <div style={{ maxWidth: 720, width: '100%' }}>
        <Panel title="JUP.EXE — SOLANA SWAP" end={<span className="pt-end">JUPITER</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
            {/* SELL */}
            <div style={{ border: '2px solid var(--line)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="t9 dim">SELL</span>
                <button
                  className="bevel-btn b-sm"
                  title={sol.address ? sol.address : 'connect wallet'}
                  onClick={() => (sol.address ? void sol.disconnect() : sol.available ? sol.connect().catch(() => play('error')) : openWalletHelp('sol'))}
                >
                  {sol.address ? `👻 ${shortAddr(sol.address, 4)}` : sol.available ? 'CONNECT PHANTOM' : 'INSTALL PHANTOM'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value.replace(/[^0-9.]/g, ''))
                    setQuote(null)
                    setParsed(null)
                    if (phase === 'ready' || phase === 'error') setPhase('idle')
                    setErr(null)
                  }}
                  style={{ flex: 1, minWidth: 0, fontSize: 'clamp(32px, 6vw, 44px)', border: 'none', background: 'transparent', padding: '2px 0', color: 'var(--amber)', textShadow: 'var(--glow-amber)' }}
                />
                <button className="bevel-btn b-sm" onClick={() => setTokenDialog('in')} title="pick input token" style={{ fontSize: 15, padding: '10px 12px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <TokenIcon token={inputToken} size={30} />
                    {inputToken.symbol} ▾
                  </span>
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <span className="faint" style={{ fontSize: 15 }}>
                  {usdIn != null && amountNum > 0 ? '$' + usdIn.toFixed(2) : '$—'}
                </span>
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 15 }}>
                  <span className="faint">Balance: {balIn != null ? balIn.toFixed(4) : '–'}</span>
                  <button className="chip-toggle" style={{ fontSize: 7, padding: '4px 6px' }} onClick={setMax}>MAX</button>
                </span>
              </div>
            </div>

            {/* flip */}
            <div style={{ display: 'grid', placeItems: 'center', margin: '-16px 0', zIndex: 3 }}>
              <button className="bevel-btn b-sm" style={{ fontSize: 14, padding: '6px 12px', background: 'var(--panel-3)' }} onClick={flip} title="flip tokens">
                ⇅
              </button>
            </div>

            {/* BUY */}
            <div style={{ border: '2px solid var(--line)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="t9 dim">BUY</span>
                <span className="faint" style={{ fontSize: 14 }}>
                  Balance: {balOut != null ? balOut.toFixed(4) : '–'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  readOnly
                  placeholder="0"
                  value={parsed ? formatTokenAmount(parsed.outHuman, outputToken.decimals) : '0'}
                  style={{ flex: 1, minWidth: 0, fontSize: 'clamp(32px, 6vw, 44px)', border: 'none', background: 'transparent', padding: '2px 0', color: 'var(--green)', textShadow: 'var(--glow-green)' }}
                />
                <button className="bevel-btn b-sm" onClick={() => setTokenDialog('out')} title="pick output token" style={{ fontSize: 15, padding: '10px 12px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <TokenIcon token={outputToken} size={30} />
                    {outputToken.symbol} ▾
                  </span>
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <span className="faint" style={{ fontSize: 15 }}>
                  {usdOut != null ? '$' + usdOut.toFixed(2) : parsed?.usdOut != null ? '$' + parsed.usdOut.toFixed(2) : '$—'}
                </span>
                <label className="faint" style={{ fontSize: 14, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  SLIP
                  <select value={slippage} onChange={(e) => { setSlippage(e.target.value as typeof slippage); setQuote(null); setParsed(null); setPhase('idle') }} style={{ fontSize: 14, padding: '4px 6px' }}>
                    <option value="auto">AUTO</option>
                    <option value="50">0.5%</option>
                    <option value="100">1.0%</option>
                    <option value="300">3.0%</option>
                  </select>
                </label>
              </div>
            </div>

            {/* quote details — only real Jupiter fields, never fabricated */}
            {parsed && quote && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div className="stat-row"><span className="sk">RATE</span><span className="sv">1 {inputToken.symbol} ≈ {parsed.rate ? formatTokenAmount(parsed.rate, 6) : '—'} {outputToken.symbol}</span></div>
                <div className="stat-row"><span className="sk">EST OUTPUT</span><span className="sv up">≈ {formatTokenAmount(parsed.outHuman, outputToken.decimals)} {outputToken.symbol}</span></div>
                <div className="stat-row">
                  <span className="sk">PRICE IMPACT</span>
                  <span className="sv" style={{ color: parsed.priceImpactPct != null && Math.abs(parsed.priceImpactPct) > 1 ? 'var(--red)' : undefined }}>
                    {parsed.priceImpactPct != null ? `${parsed.priceImpactPct >= 0 ? '+' : ''}${parsed.priceImpactPct.toFixed(3)}%` : '—'}
                  </span>
                </div>
                <div className="stat-row"><span className="sk">ROUTER</span><span className="sv">{parsed.routerLabel}{parsed.mode ? ` · ${parsed.mode.toUpperCase()}` : ''}{parsed.gasless ? ' · GASLESS' : ''}</span></div>
                {parsed.routeLabels.length > 0 && (
                  <div className="stat-row"><span className="sk">ROUTE</span><span className="sv">{parsed.routeLabels.join(' → ').slice(0, 80)}</span></div>
                )}
                <div className="stat-row"><span className="sk">FEE</span><span className="sv">{parsed.feeBps != null ? `${(parsed.feeBps / 100).toFixed(2)}%` : '—'}{parsed.feeMint ? ` · ${shortAddr(parsed.feeMint, 4)}` : ''}</span></div>
                {parsed.minOutHuman != null && (
                  <div className="stat-row"><span className="sk">MIN RECEIVE</span><span className="sv">≈ {formatTokenAmount(parsed.minOutHuman, outputToken.decimals)} {outputToken.symbol}</span></div>
                )}
                <div className="stat-row"><span className="sk">STATUS</span><span className="sv" style={{ color: staleWarn ? 'var(--red)' : 'var(--green)' }}>{staleWarn ? 'STALE — RE-QUOTE BEFORE SIGN' : 'FRESH — READY TO SIGN'}</span></div>
              </div>
            )}

            {(inputErr && amount.trim() && sol.address) || balanceHint ? (
              <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                ⚠ {balanceHint ?? inputErr}
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
            {(phase === 'quoting' || phase === 'sending') && (
              <div className="blocks" style={{ textAlign: 'center' }}>
                {blocks((Date.now() / 3000) % 1, 22)}
              </div>
            )}
            {txSig && (
              <div className="stat-row">
                <span className="sk">LAST TX</span>
                <span className="sv"><a href={explorerTxUrl(txSig)} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>{shortAddr(txSig, 8)} ↗</a></span>
              </div>
            )}

            <button
              className="bevel-btn b-lg"
              style={{ width: '100%', fontSize: 15, padding: '14px 18px', ...(action.label.includes('CONNECT') ? { background: 'linear-gradient(180deg,#4cf0fa,#05d9e8)', color: '#001416', borderColor: '#b3f7fb' } : action.label.includes('SWAP NOW') ? { background: 'linear-gradient(180deg,#ff5b8d,#ff2a6d)', color: '#fff' } : {}) }}
              disabled={action.disabled}
              onClick={action.act}
            >
              {action.label}
            </button>

            {quote && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="bevel-btn b-sm" onClick={() => void doQuote()}>↻ RE-QUOTE</button>
                <button className="bevel-btn b-sm" onClick={resetAll}>✕ RESET</button>
              </div>
            )}

            <div className="faint" style={{ fontSize: 14 }}>
              Powered by Jupiter · wallet signs once · /execute lands the tx ·
              AUTO slip = Jupiter RTSE (ultra mode). SWAP NOW always opens your wallet popup first.
            </div>
          </div>
        </Panel>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <button className="bevel-btn b-lg b-cyan" onClick={() => nav('/')}>◀ BACK TO DESKTOP</button>
        </div>
      </div>

      {/* token picker */}
      {tokenDialog && (
        <SystemDialog
          title={`SELECT TOKEN — ${tokenDialog === 'in' ? 'SELL' : 'BUY'}`}
          onClose={() => { setTokenDialog(null); setTokenQuery(''); setTokenResults([]) }}
          actions={
            <button className="bevel-btn" onClick={() => { setTokenDialog(null); setTokenQuery(''); setTokenResults([]) }}>✕ CLOSE</button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 'min(420px, 80vw)' }}>
            <input
              autoFocus
              placeholder="SEARCH SYMBOL, NAME OR MINT…"
              value={tokenQuery}
              onChange={(e) => setTokenQuery(e.target.value)}
              style={{ width: '100%' }}
            />
            {searching && <div className="faint" style={{ fontSize: 14 }}>SEARCHING JUPITER…</div>}
            {searchErr && tokenResults.length === 0 && <div className="faint" style={{ fontSize: 14 }}>{searchErr}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
              {popularPlusResults.map((t) => (
                <button key={t.mint} className="bevel-btn b-sm" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => pickToken(t)}>
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', width: '100%' }}>
                    <TokenIcon token={t} size={22} />
                    <span style={{ fontWeight: 'bold' }}>{t.symbol}</span>
                    <span className="faint" style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                    {t.isVerified ? <span className="badge new" style={{ fontSize: 7 }}>✓ VERIFIED</span> : null}
                    {t.organicScore != null ? <span className="faint" style={{ fontSize: 12 }}>ORG {t.organicScore.toFixed(0)}</span> : null}
                  </span>
                </button>
              ))}
            </div>
            <div className="faint" style={{ fontSize: 13 }}>
              Metadata: Jupiter Tokens API · banned tokens are never listed here.
            </div>
          </div>
        </SystemDialog>
      )}

      {/* confirm */}
      {confirmOpen && quote && parsed && (
        <SystemDialog
          title="CONFIRM SWAP — USER APPROVAL REQUIRED"
          onClose={() => setConfirmOpen(false)}
          actions={
            <>
              <button className="bevel-btn" onClick={() => setConfirmOpen(false)}>✕ CANCEL</button>
              <button className="bevel-btn b-danger" onClick={() => void doSwap()}>✓ CONFIRM &amp; SIGN IN WALLET</button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="stat-row"><span className="sk">YOU SEND</span><span className="sv">{amount} {inputToken.symbol}</span></div>
            <div className="stat-row"><span className="sk">YOU RECEIVE</span><span className="sv">≈ {formatTokenAmount(parsed.outHuman, outputToken.decimals)} {outputToken.symbol}</span></div>
            <div className="stat-row"><span className="sk">RATE</span><span className="sv">1 {inputToken.symbol} ≈ {formatTokenAmount(parsed.rate, 6)} {outputToken.symbol}</span></div>
            <div className="stat-row"><span className="sk">IMPACT</span><span className="sv">{parsed.priceImpactPct != null ? `${parsed.priceImpactPct.toFixed(3)}%` : '—'}</span></div>
            <div className="stat-row"><span className="sk">ROUTER</span><span className="sv">{parsed.routerLabel}</span></div>
            <div className="stat-row"><span className="sk">WALLET</span><span className="sv">{sol.address ? shortAddr(sol.address, 6) : '—'}</span></div>
            {staleWarn && <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>Quote is stale — a fresh quote will be fetched automatically before signing.</div>}
            <div className="faint" style={{ fontSize: 14 }}>After CONFIRM, your wallet opens — approve there. Jupiter lands the transaction. Nothing is submitted until you sign.</div>
          </div>
        </SystemDialog>
      )}

      {/* success */}
      {successOpen && txSig && execResult && (
        <SystemDialog
          title="SWAP COMPLETE"
          onClose={() => setSuccessOpen(false)}
          actions={
            <>
              <a className="bevel-btn b-sm" href={explorerTxUrl(txSig)} target="_blank" rel="noreferrer">VIEW ON SOLSCAN ↗</a>
              <button className="bevel-btn b-cyan" onClick={() => { setSuccessOpen(false); resetAll() }}>✓ NICE — NEW SWAP</button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="stat-row"><span className="sk">STATUS</span><span className="sv up">CONGRATULATIONS — SWAP LANDED</span></div>
            <div className="stat-row"><span className="sk">ROUTE</span><span className="sv">{inputToken.symbol} → {outputToken.symbol} · {parsed?.routerLabel ?? 'JUPITER'}</span></div>
            <div className="stat-row"><span className="sk">YOU SENT</span><span className="sv">{amount} {inputToken.symbol}</span></div>
            <div className="stat-row">
              <span className="sk">YOU RECEIVED</span>
              <span className="sv">
                {execResult.totalOutputAmount != null
                  ? `≈ ${formatTokenAmount(fromBaseUnits(execResult.totalOutputAmount, outputToken.decimals), outputToken.decimals)} ${outputToken.symbol}`
                  : parsed ? `≈ ${formatTokenAmount(parsed.outHuman, outputToken.decimals)} ${outputToken.symbol}` : '—'}
              </span>
            </div>
            <div className="stat-row"><span className="sk">TX</span><span className="sv mono-addr">{shortAddr(txSig, 8)}</span></div>
            <div className="faint" style={{ fontSize: 14 }}>Tokens are in your wallet. Balances refreshed above — verify on Solscan any time.</div>
          </div>
        </SystemDialog>
      )}
    </div>
  )
}
