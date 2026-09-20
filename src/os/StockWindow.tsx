import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Panel } from '../design/ui'
import { useBpBalances, useBpRfqs, useBpStatus, useStockHolidays, useStockMarkets, useStockTickers, useStockUniverse } from '../hooks/stock'
import { num, rfqSymbol, tickerForAsset, type Security } from '../lib/backpack/api'
import { acceptBpQuote, bestQuote, cancelBpRfq, clearBpOperatorToken, loadBpOperatorToken, rfqIdOf, saveBpOperatorToken, submitBpRfq } from '../lib/backpack/trade'
import { currentSession, sessionForSecurity, sessionLabel, type SessionId } from '../lib/backpack/session'
import { cn, fmtPrice } from '../lib/format'
import { play } from '../sound/sfx'

const PAGE = 60

function pct(n: number | null): string {
  if (n == null || !isFinite(n)) return '—'
  const p = n * 100
  const sign = p > 0 ? '+' : ''
  return `${sign}${p.toFixed(2)}%`
}

function tapeTicker(asset: string) {
  return asset.replace(/\.US$/i, '')
}

export function StockWindow() {
  const nav = useNavigate()
  const secQ = useStockUniverse()
  const holQ = useStockHolidays()
  const mktQ = useStockMarkets()
  const tickQ = useStockTickers()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [now, setNow] = useState(() => Date.now())
  const [qty, setQty] = useState('1')
  const [side, setSide] = useState<'Bid' | 'Ask'>('Bid')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const statusQ = useBpStatus()
  const keyed = !!statusQ.data?.configured
  const gated = !!statusQ.data?.gated
  const [opTok, setOpTok] = useState(() => loadBpOperatorToken() ?? '')
  const [opSaved, setOpSaved] = useState(() => !!loadBpOperatorToken())
  const opOk = !gated || opSaved
  const balQ = useBpBalances(keyed && opOk)
  const rfqQ = useBpRfqs(keyed && opOk)

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(iv)
  }, [])

  const session: SessionId = useMemo(
    () => currentSession(new Date(now), holQ.data ?? []),
    [now, holQ.data],
  )
  const open = session !== 'CLOSED'

  const tickers = tickQ.data ?? []
  const securities = secQ.data ?? []
  const spotBooks = useMemo(() => {
    const set = new Set<string>()
    for (const m of mktQ.data ?? []) {
      if (m.rwaMarketType === 'STOCK' && m.marketType === 'SPOT' && m.visible) set.add(m.baseSymbol)
    }
    return set
  }, [mktQ.data])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = securities
      .map((s) => {
        const tape = tickerForAsset(tickers, s.asset)
        const last = tape ? num(tape.ticker.lastPrice) : null
        const chg = tape ? num(tape.ticker.priceChangePercent) : null
        const vol = tape ? num(tape.ticker.quoteVolume) : null
        return { sec: s, tape, last, chg, vol }
      })
      .filter((r) => {
        if (!needle) return r.tape != null
        const hay = `${r.sec.asset} ${r.sec.name} ${tapeTicker(r.sec.asset)}`.toLowerCase()
        return hay.includes(needle)
      })
    list.sort((a, b) => (b.vol ?? -1) - (a.vol ?? -1))
    return list
  }, [securities, tickers, q])

  const visible = rows.slice(0, shown)
  const selected: Security | undefined = securities.find((s) => s.asset === sel) ?? visible[0]?.sec
  const selectedTape = selected ? tickerForAsset(tickers, selected.asset) : null
  const selectedSess = selected ? sessionForSecurity(selected, session) : null

  const loading = secQ.isLoading || tickQ.isLoading
  const err = secQ.error || tickQ.error

  return (
    <div className="page">
      <div
        className="panel"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '10px 14px',
          flexWrap: 'wrap',
        }}
      >
        <span className="t10" style={{ color: 'var(--cyan)', textShadow: 'var(--glow-cyan)' }}>
          📊 STOCK.EXE — BACKPACK TAPE{' '}
          <span className="blink" style={{ color: open ? 'var(--green)' : 'var(--amber)' }}>
            ● {sessionLabel(session)}
          </span>
        </span>
        <span className="faint" style={{ fontSize: 14 }}>
          {keyed ? `ACCOUNT ${statusQ.data?.name ?? 'crt2'}` : 'ACCOUNT — KEY NOT LOADED'}
          {' · '}
          tokenized US equities · RFQ in session
        </span>
        <button
          className="bevel-btn b-sm b-cyan"
          onClick={() => {
            nav('/')
            play('open')
          }}
        >
          ◀ DESKTOP
        </button>
      </div>

      {err ? (
        <div className="warn-strip">
          <span>⚠</span>
          <span>TAPE DOWN — {(err as Error).message || 'Backpack unreachable'}</span>
        </div>
      ) : null}

      <div className="stock-layout">
        <Panel
          title="UNIVERSE"
          end={
            <span className="pt-end">
              {loading ? 'SEEKING…' : `${rows.length} FILES`}
            </span>
          }
        >
          <input
            placeholder="SEARCH TICKER OR NAME…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setShown(PAGE)
            }}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <div className="stock-head">
            <span>TICKER</span>
            <span>LAST</span>
            <span>CHG</span>
            <span>VENUE</span>
          </div>
          <div className="stock-list">
            {loading && visible.length === 0 ? (
              <div className="faint" style={{ padding: '12px 0' }}>MOUNTING SECURITIES.SYS…</div>
            ) : visible.length === 0 ? (
              <div className="faint" style={{ padding: '12px 0' }}>NO MATCH — TRY AAPL / NVDA / MU</div>
            ) : (
              visible.map((r) => {
                const active = selected?.asset === r.sec.asset
                const up = (r.chg ?? 0) >= 0
                return (
                  <button
                    key={r.sec.asset}
                    className={cn('stock-row', active && 'sel')}
                    onClick={() => {
                      play('click')
                      setSel(r.sec.asset)
                    }}
                  >
                    <span className="stock-sym">
                      {tapeTicker(r.sec.asset)}
                      <span className="stock-name">{r.sec.name}</span>
                    </span>
                    <span className="sv">{r.last == null ? '—' : fmtPrice(r.last)}</span>
                    <span className={up ? 'stock-up' : 'stock-dn'}>{pct(r.chg)}</span>
                    <span className="faint" style={{ fontSize: 13 }}>
                      {r.tape?.venue ?? (spotBooks.has(r.sec.asset) ? 'SPOT' : 'RFQ')}
                    </span>
                  </button>
                )
              })
            )}
          </div>
          {rows.length > shown ? (
            <button className="bevel-btn b-sm" style={{ marginTop: 8 }} onClick={() => setShown((n) => n + PAGE)}>
              MORE ▾ {rows.length - shown} LEFT
            </button>
          ) : null}
        </Panel>

        <Panel title={selected ? `FILE — ${tapeTicker(selected.asset)}` : 'FILE'} end={<span className="pt-end">RFQ.SYS</span>}>
          {selected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="t12" style={{ color: 'var(--cyan)', textShadow: 'var(--glow-cyan)' }}>
                {selected.name}
              </div>
              <div className="stat-row"><span className="sk">ASSET</span><span className="sv">{selected.asset}</span></div>
              <div className="stat-row"><span className="sk">CUSIP</span><span className="sv">{selected.cusip || '—'}</span></div>
              <div className="stat-row"><span className="sk">SESSION</span><span className="sv">{sessionLabel(session)}</span></div>
              <div className="stat-row">
                <span className="sk">LAST</span>
                <span className="sv">
                  {selectedTape ? `${fmtPrice(num(selectedTape.ticker.lastPrice))} USDC` : '— NO TAPE'}
                  {selectedTape ? ` · ${selectedTape.venue}` : ''}
                </span>
              </div>
              <div className="stat-row">
                <span className="sk">CHG 24H</span>
                <span className={cn('sv', (num(selectedTape?.ticker.priceChangePercent) ?? 0) >= 0 ? 'stock-up' : 'stock-dn')}>
                  {pct(num(selectedTape?.ticker.priceChangePercent))}
                </span>
              </div>
              <div className="stat-row"><span className="sk">RFQ MKT</span><span className="sv">{rfqSymbol(selected.asset)}</span></div>
              {selectedSess ? (
                <div className="stat-row">
                  <span className="sk">SIZE</span>
                  <span className="sv">
                    {selectedSess.minQuantity}–{selectedSess.maxQuantity} · STEP {selectedSess.stepSize}
                  </span>
                </div>
              ) : (
                <div className="faint" style={{ fontSize: 15 }}>
                  {open ? 'No size band for this session.' : 'Market closed — RFQ sleeps. Listed names can still print on the spot book after hours.'}
                </div>
              )}
              {keyed ? (
                <>
                  <div className="stat-row">
                    <span className="sk">USDC</span>
                    <span className="sv">{balQ.data?.USDC?.available ?? '—'}</span>
                  </div>
                  <div className="stat-row">
                    <span className="sk">{tapeTicker(selected.asset)}</span>
                    <span className="sv">{balQ.data?.[selected.asset]?.available ?? '0'}</span>
                  </div>
                  {gated ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <input
                        type="password"
                        placeholder="OPERATOR TOKEN…"
                        value={opTok}
                        onChange={(e) => setOpTok(e.target.value.trim())}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      {opSaved ? (
                        <button
                          className="bevel-btn b-sm"
                          style={{ color: 'var(--red)' }}
                          onClick={() => {
                            clearBpOperatorToken()
                            setOpSaved(false)
                            setOpTok('')
                            play('click')
                          }}
                        >
                          ⏏
                        </button>
                      ) : (
                        <button
                          className="bevel-btn b-sm b-cyan"
                          disabled={!opTok}
                          onClick={() => {
                            saveBpOperatorToken(opTok)
                            setOpSaved(true)
                            play('coin')
                            void statusQ.refetch()
                            void balQ.refetch()
                            void rfqQ.refetch()
                          }}
                        >
                          ✓
                        </button>
                      )}
                    </div>
                  ) : null}
                </>
              ) : null}

              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button className={cn('bevel-btn b-sm', side === 'Bid' && 'b-cyan')} onClick={() => setSide('Bid')}>
                  BUY
                </button>
                <button className={cn('bevel-btn b-sm', side === 'Ask' && 'b-amber')} onClick={() => setSide('Ask')}>
                  SELL
                </button>
              </div>
              <input
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="SHARES"
              />
              <button
                className="bevel-btn b-lg"
                disabled={!keyed || !opOk || busy || !qty}
                onClick={() => {
                  if (!selected || !keyed || !opOk) return
                  setBusy(true)
                  setNote(null)
                  play('launch')
                  void submitBpRfq({ symbol: rfqSymbol(selected.asset), side, quantity: qty })
                    .then(() => {
                      setNote('RFQ LIVE — waiting on broker quote')
                      play('coin')
                      void rfqQ.refetch()
                      void balQ.refetch()
                    })
                    .catch((e: Error) => {
                      setNote(e.message)
                      play('error')
                    })
                    .finally(() => setBusy(false))
                }}
              >
                {busy ? 'SIGNING…' : !keyed ? 'REQUEST QUOTE — KEY NOT LOADED' : !opOk ? 'REQUEST QUOTE — OPERATOR TOKEN NEEDED' : `REQUEST QUOTE — ${side === 'Bid' ? 'BUY' : 'SELL'}`}
              </button>
              {note ? <div className="faint" style={{ fontSize: 15, color: 'var(--amber)' }}>{note}</div> : null}
              {(rfqQ.data ?? []).length > 0 ? (
                <div style={{ marginTop: 6 }}>
                  <div className="t8 dim" style={{ marginBottom: 4 }}>OPEN RFQs</div>
                  {(rfqQ.data ?? []).map((row) => {
                    const id = rfqIdOf(row)
                    const qte = bestQuote(row)
                    const px = side === 'Ask' ? qte?.bidPrice : qte?.askPrice
                    return (
                      <div key={id || JSON.stringify(row.rfq)} className="stat-row" style={{ alignItems: 'center' }}>
                        <span className="sk">{String(row.rfq.symbol ?? id).replace('_USDC_RFQ', '')}</span>
                        <span className="sv" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                          {qte ? `Q ${px ?? '—'}` : (row.rfq.status ?? 'OPEN')}
                          {qte?.quoteId && id ? (
                            <button
                              className="bevel-btn b-sm b-cyan"
                              disabled={busy}
                              onClick={() => {
                                setBusy(true)
                                setNote(null)
                                void acceptBpQuote({ rfqId: id, quoteId: String(qte.quoteId) })
                                  .then(() => {
                                    setNote('QUOTE ACCEPTED — settlement pending')
                                    play('win')
                                    void rfqQ.refetch()
                                    void balQ.refetch()
                                  })
                                  .catch((e: Error) => {
                                    setNote(e.message)
                                    play('error')
                                  })
                                  .finally(() => setBusy(false))
                              }}
                            >
                              ACCEPT
                            </button>
                          ) : id ? (
                            <button
                              className="bevel-btn b-sm"
                              disabled={busy}
                              onClick={() => {
                                setBusy(true)
                                void cancelBpRfq(id)
                                  .then(() => {
                                    setNote('RFQ CANCELLED')
                                    void rfqQ.refetch()
                                  })
                                  .catch((e: Error) => setNote(e.message))
                                  .finally(() => setBusy(false))
                              }}
                            >
                              CANCEL
                            </button>
                          ) : null}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : null}
              <div className="faint" style={{ fontSize: 14 }}>
                Key `{statusQ.data?.name ?? 'crt2'}` signs on the server. RFQ qty is shares, not USDC. No fake fills.
              </div>
            </div>
          ) : (
            <div className="faint">SELECT A FILE FROM THE TAPE.</div>
          )}
        </Panel>
      </div>
    </div>
  )
}
