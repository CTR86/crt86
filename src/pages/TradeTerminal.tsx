import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatUnits, parseUnits, type Address } from 'viem'
import { readContract } from 'viem/actions'
import { useEvmWallet, activeWalletClient } from '../wallets/EvmWallet'
import { useMemePage, useStockPage, useLiveFeed, type FeedRow } from '../hooks/prm'
import { getQuote, type QuoteResult, type TradeMode } from '../lib/prm/quotes'
import { allowanceOf, approveRouter, awaitReceipt, executeSwap, friendlySwapError, inputTokenFor } from '../lib/prm/swaps'
import { publicClient, PHASE } from '../lib/prm/chain'
import { ERC20_ABI } from '../lib/prm/abis'
import { Panel, Readout, PhaseBadge, LedDot, TokenLogo, CopyBtn } from '../design/ui'
import { SystemDialog } from '../design/SystemDialog'
import { cn, fmtEth, fmtPrice, shortAddr } from '../lib/format'
import { useTerminal } from '../store/terminal'
import { play } from '../sound/sfx'

type Selected =
  | { kind: 'meme'; token: string; symbol: string; name: string; decimals: number; phase: number }
  | { kind: 'stock'; token: string; subjectId: string; symbol: string; name: string; decimals: number }
  | null

interface ExecState {
  phase: 'idle' | 'approving' | 'executing' | 'confirming' | 'done' | 'error'
  message?: string
  txHash?: string
}

function AssetRow({
  symbol,
  name,
  right,
  badge,
  active,
  onClick,
}: {
  symbol: string
  name: string
  right?: string
  badge?: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      className="tape-table"
      onClick={() => { play('click'); onClick() }}
      style={{
        display: 'flex', width: '100%', gap: 8, alignItems: 'center', background: active ? 'rgba(255,42,109,0.12)' : 'transparent',
        border: `1px solid ${active ? 'var(--pink)' : 'var(--line-soft)'}`, padding: '7px 9px', cursor: 'pointer', textAlign: 'left', color: 'inherit',
      }}
    >
      <TokenLogo symbol={symbol} size={24} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t9">{symbol}</div>
        <div className="faint" style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
      </div>
      {badge}
      {right && <span className="dim" style={{ fontSize: 16 }}>{right}</span>}
    </button>
  )
}

function Feed({ rows }: { rows: FeedRow[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.length === 0 && <div className="state-note"><span className="big">MONITORING…</span>listening to RH-CHAIN wire</div>}
      {rows.map((r) => (
        <div key={r.id} className={cn('feed-row', r.kind)}>
          <span className="t8" style={{ color: r.kind === 'buy' ? 'var(--green)' : r.kind === 'sell' ? 'var(--red)' : 'var(--cyan)' }}>{r.label}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.detail}</span>
          <span className="faint" style={{ fontSize: 14 }}>{new Date(r.ts * 1000).toLocaleTimeString()}</span>
        </div>
      ))}
    </div>
  )
}

export function TradeTerminal() {
  const { address, chainId, available, connect, ensureChain } = useEvmWallet()
  const consumeLoaded = useTerminal((s) => s.consume)

  const [sel, setSel] = useState<Selected>(null)
  const [buy, setBuy] = useState(true)
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(2)
  const [quote, setQuote] = useState<QuoteResult | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [quoteErr, setQuoteErr] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [ethBalance, setEthBalance] = useState<bigint | null>(null)
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [exec, setExec] = useState<ExecState>({ phase: 'idle' })

  const [bayTab, setBayTab] = useState<'memes' | 'stocks'>('memes')
  const [bayQ, setBayQ] = useState('')
  const [page, setPage] = useState(1)
  const memes = useMemePage(page, 8)
  const stocks = useStockPage(page, 8)
  const feed = useLiveFeed(sel?.kind === 'meme' ? sel.token : null, sel?.symbol ?? '')

  const debouncedAmount = useDebounced(amount, 450)
  const mode: TradeMode | null = useMemo(() => {
    if (!sel) return null
    if (sel.kind === 'meme') return buy ? 'eth-meme' : 'meme-eth'
    return buy ? 'eth-stock' : 'stock-eth'
  }, [sel, buy])

  /* consume "load to terminal" handoff */
  useEffect(() => {
    const l = consumeLoaded()
    if (!l) return
    if (l.kind === 'stock' && !l.subjectId) return
    void (async () => {
      try {
        const dec = await readContract(publicClient(), { address: l.token as Address, abi: ERC20_ABI, functionName: 'decimals' })
        setSel(
          l.kind === 'meme'
            ? { kind: 'meme', token: l.token, symbol: l.symbol, name: l.symbol, decimals: Number(dec), phase: PHASE.TRADING }
            : { kind: 'stock', token: l.token, subjectId: l.subjectId!, symbol: l.symbol, name: l.symbol, decimals: Number(dec) },
        )
        setBuy(true)
      } catch {
        /* ignore */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* balances */
  useEffect(() => {
    if (!address) return setEthBalance(null)
    void publicClient()
      .getBalance({ address })
      .then(setEthBalance)
      .catch(() => setEthBalance(null))
  }, [address, exec.phase])

  useEffect(() => {
    if (!address || !sel) return setTokenBalance(null)
    void readContract(publicClient(), { address: sel.token as Address, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] })
      .then((b) => setTokenBalance(b as bigint))
      .catch(() => setTokenBalance(null))
  }, [address, sel, exec.phase])

  /* quote cycle — everything keyed off the debounced amount so the
     clear-effect can never race-and-wipe a freshly landed quote */
  const amountIn: bigint | null = useMemo(() => {
    if (!mode || !sel) return null
    if (!debouncedAmount || Number(debouncedAmount) <= 0) return null
    try {
      return parseUnits(debouncedAmount, sel.decimals)
    } catch {
      return null
    }
  }, [mode, sel, debouncedAmount])

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    setQuote(null)
    setQuoteErr(null)
  }, [mode, debouncedAmount, slippage, sel])

  const refetchQuote = useCallback(async () => {
    if (!mode || !sel || amountIn == null || amountIn <= 0n) return
    setQuoting(true)
    setQuoteErr(null)
    try {
      const q = await getQuote(
        mode === 'eth-meme' || mode === 'meme-eth'
          ? { mode, meme: sel.token, amountIn }
          : { mode, subjectId: (sel as { subjectId: string }).subjectId, amountIn },
        slippage,
      )
      setQuote(q)
    } catch (e) {
      setQuote(null)
      setQuoteErr(friendlySwapError(e))
    } finally {
      setQuoting(false)
    }
     
  }, [mode, sel, amountIn, slippage])

  useEffect(() => {
    void refetchQuote()
  }, [refetchQuote])

  const expired = quote != null && now > quote.expiresAt
  const quoteAge = quote ? Math.max(0, Math.ceil((quote.expiresAt - now) / 1000)) : 0

  /* execution */
  const doExecute = async () => {
    if (!sel || !quote || !address || mode == null) return
    setConfirmOpen(false)
    try {
      const wallet = activeWalletClient()
      const okChain = await ensureChain()
      if (!okChain) throw new Error('Could not switch chain to 4663')
      const inputToken = inputTokenFor(mode, sel.kind === 'meme' ? sel.token : undefined)
      if (inputToken) {
        const allowance = await allowanceOf(inputToken, address)
        if (allowance < quote.amountIn) {
          setExec({ phase: 'approving', message: 'LOADING MAGNETIC TAPE — approve router…' })
          const ah = await approveRouter(wallet, address, inputToken, quote.amountIn)
          await awaitReceipt(ah)
        }
      }
      setExec({ phase: 'executing', message: 'TRANSMITTING SWAP…' })
      const hash = await executeSwap(wallet, {
        mode,
        quote,
        meme: sel.kind === 'meme' ? sel.token : undefined,
        subjectId: sel.kind === 'stock' ? sel.subjectId : undefined,
        account: address,
      })
      setExec({ phase: 'confirming', message: 'AWAITING CONFIRMATION (2 blocks)…', txHash: hash })
      await awaitReceipt(hash)
      setExec({ phase: 'done', message: 'TRANSMISSION COMPLETE', txHash: hash })
      play('coin')
    } catch (e) {
      setExec({ phase: 'error', message: friendlySwapError(e) })
      play('error')
    }
  }

  const canExecute = !!address && chainId === 4663 && !!quote && !expired && !quote.partialFillRisk && exec.phase !== 'executing' && exec.phase !== 'approving' && exec.phase !== 'confirming'
  const execLabel =
    exec.phase === 'approving' ? 'APPROVING…' :
    exec.phase === 'executing' ? 'TRANSMITTING…' :
    exec.phase === 'confirming' ? 'CONFIRMING…' :
    !available ? 'NO EVM WALLET' :
    !address ? 'PLUG IN WALLET' :
    chainId !== 4663 ? 'LOAD RH-CHAIN FIRST' :
    expired ? 'QUOTE EXPIRED' :
    quote?.partialFillRisk ? 'PARTIAL FILL — BLOCKED' :
    'EXECUTE'

  const list = bayTab === 'memes' ? memes : stocks
  const bayFilter = (x: { symbol: string; name: string }) => {
    const s = bayQ.trim().toLowerCase()
    return !s || x.symbol.toLowerCase().includes(s) || x.name.toLowerCase().includes(s)
  }
  const memeList = (memes.data ?? []).filter(bayFilter)
  const stockList = (stocks.data ?? []).filter(bayFilter)

  const onPickMeme = async (m: { token: string; symbol: string; name: string; phase: number }) => {
    try {
      const dec = await readContract(publicClient(), { address: m.token as Address, abi: ERC20_ABI, functionName: 'decimals' })
      setSel({ kind: 'meme', token: m.token, symbol: m.symbol, name: m.name, decimals: Number(dec), phase: m.phase })
      setExec({ phase: 'idle' })
    } catch { /* ignore */ }
  }
  const onPickStock = async (s: { deskToken: string; subjectId: string; symbol: string; name: string }) => {
    try {
      const dec = await readContract(publicClient(), { address: s.deskToken as Address, abi: ERC20_ABI, functionName: 'decimals' })
      setSel({ kind: 'stock', token: s.deskToken, subjectId: s.subjectId, symbol: s.symbol, name: s.name, decimals: Number(dec) })
      setExec({ phase: 'idle' })
    } catch { /* ignore */ }
  }

  const maxAmount = useMemo(() => {
    if (!sel) return null
    if (buy) return ethBalance != null ? formatUnits(ethBalance, 18) : null
    return tokenBalance != null ? formatUnits(tokenBalance, sel.decimals) : null
  }, [sel, buy, ethBalance, tokenBalance])

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">◤ TRADE TERMINAL</h1>
        <span className="page-sub">RH-CHAIN · SWAP VIA PRM ROUTER</span>
      </div>

      <div className="warn-strip">
        <span>⚠</span>
        <span>
          REAL MONEY MODE — swaps execute with your wallet on Robinhood Chain (4663). A quote is not a reservation.
          Sell quotes that would partially fill are rejected by this terminal by design.
        </span>
      </div>

      <div className="grid-3">
        {/* -------- asset bay -------- */}
        <Panel title="ASSET BAY" end={<LedDot color={chainId === 4663 ? 'pink' : 'red'} solid={chainId === 4663} />}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <button className={cn('tab', bayTab === 'memes' && 'active')} onClick={() => { setBayTab('memes'); setPage(1) }}>MEMES</button>
            <button className={cn('tab', bayTab === 'stocks' && 'active')} onClick={() => { setBayTab('stocks'); setPage(1) }}>STOCKS</button>
          </div>
          <input placeholder="SEARCH…" value={bayQ} onChange={(e) => setBayQ(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {bayTab === 'memes'
              ? memeList.map((m) => (
                  <AssetRow
                    key={m.token}
                    symbol={m.symbol}
                    name={m.name}
                    badge={<PhaseBadge phase={m.phase} />}
                    right={m.priceEth != null ? `Ξ${fmtPrice(m.priceEth)}` : '—'}
                    active={sel?.token === m.token}
                    onClick={() => void onPickMeme(m)}
                  />
                ))
              : stockList.map((s) => (
                  <AssetRow
                    key={s.subjectId}
                    symbol={s.symbol}
                    name={s.name}
                    right={s.priceEth != null ? `Ξ${fmtPrice(s.priceEth)}` : '—'}
                    active={sel?.token === s.deskToken}
                    onClick={() => void onPickStock(s)}
                  />
                ))}
            {list.loading && <div className="state-note"><span className="big">SCANNING…</span></div>}
            {!list.loading && list.error && (
              <div className="state-note">
                <span className="big">SIGNAL LOST</span>
                {list.error}
                <div><button className="bevel-btn b-sm" onClick={() => list.refetch()}>RETRY SCAN</button></div>
              </div>
            )}
            {!list.loading && !list.error && list.data?.length === 0 && (
              <div className="state-note"><span className="big">DIRECTORY EMPTY</span>no assets on file yet</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button className="bevel-btn b-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>◀</button>
            <button className="bevel-btn b-sm" disabled={(page - 1) * 8 + 8 >= list.total} onClick={() => setPage((p) => p + 1)}>▶</button>
            <span className="faint" style={{ marginLeft: 'auto', fontSize: 15 }}>{list.total} total</span>
          </div>
        </Panel>

        {/* -------- swap console -------- */}
        <Panel title="SWAP CONSOLE" end={sel ? `${buy ? 'BUY' : 'SELL'} ${sel.symbol}` : 'NO TARGET'}>
          {!sel ? (
            <div className="state-note">
              <span className="big">NO TARGET LOCKED</span>
              pick an asset from the bay, or press LOAD TO TERMINAL on the MARKETS page
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* target info */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <TokenLogo symbol={sel.symbol} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t10">{sel.symbol} <span className="dim" style={{ fontSize: 16 }}>({sel.name})</span></div>
                  <div className="faint mono-addr" style={{ fontSize: 15 }}>{shortAddr(sel.token, 6)} <CopyBtn text={sel.token} label="⧉" /></div>
                </div>
                {'phase' in sel && <PhaseBadge phase={sel.phase} />}
                {tokenBalance != null && <span className="dim" style={{ fontSize: 16 }}>HOLDING {formatUnits(tokenBalance, sel.decimals)}</span>}
              </div>

              {/* buy/sell flip */}
              <div className="tab-row">
                <button className={cn('tab', buy && 'active')} onClick={() => { setBuy(true); play('click') }}>► BUY {sel.symbol}</button>
                <button className={cn('tab', !buy && 'active')} onClick={() => { setBuy(false); play('click') }} style={buy ? {} : { background: 'var(--red)', borderColor: 'var(--red)' }}>
                  ◄ SELL {sel.symbol}
                </button>
              </div>

              {/* amount */}
              <div>
                <div className="field-label" style={{ marginBottom: 5 }}>
                  {buy ? `AMOUNT · ETH (balance ${ethBalance != null ? fmtEth(ethBalance) : '—'})` : `AMOUNT · ${sel.symbol} (balance ${tokenBalance != null ? formatUnits(tokenBalance, sel.decimals) : '—'})`}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    inputMode="decimal"
                    placeholder="0.0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    style={{ flex: 1, fontSize: 26, color: 'var(--amber)', textShadow: 'var(--glow-amber)' }}
                  />
                  <button className="bevel-btn b-sm" onClick={() => maxAmount && setAmount(maxAmount)}>MAX</button>
                </div>
              </div>

              {/* route diagram */}
              <div className="route-line">
                {buy ? (
                  <>
                    <span className="route-node">ETH</span>
                    <span className="route-arrow">══►</span>
                    <span className="route-node">{sel.symbol}</span>
                  </>
                ) : (
                  <>
                    <span className="route-node">{sel.symbol}</span>
                    <span className="route-arrow">══►</span>
                    <span className="route-node">ETH</span>
                  </>
                )}
                <span className="faint" style={{ fontSize: 15 }}>via PremiumRouter</span>
              </div>

              {/* quote readout */}
              <div className="grid-2" style={{ gap: 10 }}>
                <Readout
                  label={`YOU ${buy ? 'RECEIVE' : 'RECEIVE (ETH)'}`}
                  tone={buy ? 'cyan' : 'green'}
                  value={quote ? fmtEth(quote.output) + (buy ? '' : ' Ξ') : quoting ? '····' : '—'}
                  sub={quote ? `rate 1 ${buy ? 'Ξ' : sel.symbol} ≈ ${fmtEth(buy ? (quote.amountIn > 0n ? (quote.output * 10n ** 18n) / quote.amountIn : 0n) : (quote.output > 0n ? (quote.amountIn * 10n ** 18n) / quote.output : 0n))} ${buy ? sel.symbol : 'Ξ'}` : undefined}
                />
                <div className="readout ro-amber">
                  <div className="ro-label">SLIPPAGE / EXPIRY</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {[1, 2, 5].map((s) => (
                      <button key={s} className={cn('tab', slippage === s && 'active')} style={{ fontSize: 10, padding: '4px 8px' }} onClick={() => setSlippage(s)}>
                        {s}%
                      </button>
                    ))}
                    {quote && <span className="t9" style={{ color: expired ? 'var(--red)' : 'var(--amber)' }}>{expired ? 'EXPIRED' : `T-${quoteAge}s`}</span>}
                  </div>
                  <div className="ro-sub">
                    MIN OUT {quote ? fmtEth(quote.minOut) : '—'}
                    {quote && quote.stockRefund > 0n ? ` · STOCK REFUND ${fmtEth(quote.stockRefund)}` : ''}
                  </div>
                </div>
              </div>

              {quoteErr && <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)', textShadow: 'var(--glow-red)' }}>✕ {quoteErr}</div>}
              {quote?.partialFillRisk && (
                <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)', textShadow: 'var(--glow-red)' }}>
                  ✕ SELL WOULD PARTIALLY FILL ({fmtEth(quote.inputUsed)} of {fmtEth(quote.amountIn)}) — blocked for your protection.
                </div>
              )}

              {/* execute */}
              {chainId !== 4663 && address ? (
                <button className="bevel-btn b-lg b-amber" onClick={() => void ensureChain()}>⚙ LOAD RH-CHAIN (4663) INTO WALLET</button>
              ) : !address ? (
                <button className="bevel-btn b-lg b-cyan" onClick={() => void connect().catch(() => play('error'))}>► PLUG IN EVM WALLET</button>
              ) : (
                <button className="bevel-btn b-lg b-pink" disabled={!canExecute} onClick={() => { setConfirmOpen(true); play('alert') }}>
                  ◎ {execLabel}
                </button>
              )}

              {exec.message && (
                <div className={cn('telemetry')} style={{ color: exec.phase === 'error' ? 'var(--red)' : exec.phase === 'done' ? 'var(--green)' : 'var(--amber)' }}>
                  {exec.message}
                  {exec.txHash && (
                    <div style={{ marginTop: 6 }}>
                      TX {shortAddr(exec.txHash, 10)} <CopyBtn text={exec.txHash} label="⧉" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Panel>

        {/* -------- live feed -------- */}
        <Panel title="LIVE WIRE · RH-CHAIN" end={<LedDot color="cyan" />}>
          <Feed rows={feed} />
        </Panel>
      </div>

      {confirmOpen && quote && sel && (
        <SystemDialog
          title="CONFIRM TRANSMISSION"
          onClose={() => setConfirmOpen(false)}
          actions={
            <>
              <button className="bevel-btn" onClick={() => setConfirmOpen(false)}>N — ABORT</button>
              <button className="bevel-btn b-pink" onClick={() => void doExecute()}>Y — EXECUTE</button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="stat-row"><span className="sk">ROUTE</span><span className="sv">{buy ? `ETH → ${sel.symbol}` : `${sel.symbol} → ETH`}</span></div>
            <div className="stat-row"><span className="sk">YOU PAY</span><span className="sv">{fmtEth(quote.amountIn)} {buy ? 'ETH' : sel.symbol}</span></div>
            <div className="stat-row"><span className="sk">YOU RECEIVE (≥)</span><span className="sv">{fmtEth(quote.minOut)} {buy ? sel.symbol : 'ETH'}</span></div>
            <div className="stat-row"><span className="sk">SLIPPAGE</span><span className="sv">{slippage}%</span></div>
            <div className="faint" style={{ fontSize: 15 }}>Unused input is refunded to your wallet by the router. Native ETH refunds always go to the caller.</div>
          </div>
        </SystemDialog>
      )}
    </div>
  )
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  const t = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    clearTimeout(t.current)
    t.current = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t.current)
  }, [value, ms])
  return v
}
