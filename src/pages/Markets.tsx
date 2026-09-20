import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMemePage, useStockPage } from '../hooks/prm'
import { useTokenDetail, useTokens } from '../hooks/stonk'
import { Blocks, CopyBtn, Panel, PhaseBadge, Scope, StatusBadge, TokenLogo } from '../design/ui'
import { fmtPrice, fmtUsd, shortAddr, timeAgo, cn } from '../lib/format'
import { sfAssetUrl, type SfToken } from '../lib/stonkfun'
import { listingAge } from '../lib/prm/discovery'
import { useTerminal } from '../store/terminal'
import { useRollingSeries } from '../hooks/prm'
import { play } from '../sound/sfx'
import { RH_ENABLED } from '../config'

/* ---------------- SOL grid ---------------- */

function SolCard({ token, onOpen }: { token: SfToken; onOpen: (t: SfToken) => void }) {
  return (
    <button className="token-card" onClick={() => { play('click'); onOpen(token) }}>
      <div className="tc-head">
        <TokenLogo src={sfAssetUrl(token.imageUrl)} symbol={token.symbol} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="tc-sym">{token.symbol}</div>
          <div className="tc-name">{token.name}</div>
        </div>
        <StatusBadge status={token.status} />
      </div>
      <div className="tc-stats">
        <span className="k">PRICE</span>
        <span>${fmtPrice(token.market.priceUsd)}</span>
        <span className="k">MCAP</span>
        <span>{fmtUsd(token.market.marketCapUsd)}</span>
        <span className="k">VOL 24H</span>
        <span>{fmtUsd(token.market.volume24hUsd)}</span>
        <span className="k">LIQ</span>
        <span>{fmtUsd(token.market.liquidityUsd)}</span>
      </div>
      <div className="tc-foot">
        <Blocks frac={token.graduationProgress} width={10} />
        <span className="faint" style={{ fontSize: 14 }}>{timeAgo(token.createdAt)}</span>
      </div>
    </button>
  )
}

function SolDetailDrawer({ mint, onClose }: { mint: string; onClose: () => void }) {
  const { data: t } = useTokenDetail(mint)
  const priceSeries = useRollingSeries(t?.market?.priceUsd ?? null)
  const price = t?.market?.priceUsd ?? null
  const firstPrice = priceSeries[0] ?? price
  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" style={{ width: 'min(760px, 96vw)' }}>
        <div className="dialog-title">
          <span>▚ COIN FILE — {t?.symbol ?? mint.slice(0, 6)}</span>
          <button className="bevel-btn b-sm" onClick={onClose}>✕</button>
        </div>
        <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {t && price != null ? (
            <>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <TokenLogo src={sfAssetUrl(t.imageUrl)} symbol={t.symbol} size={56} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div className="t12">{t.name}</div>
                  <div className="faint mono-addr" style={{ fontSize: 16 }}>{shortAddr(t.mint, 8)} <CopyBtn text={t.mint} /></div>
                </div>
                <StatusBadge status={t.status} />
                <StatusBadge status={t.mode} />
              </div>
              <Scope series={priceSeries} height={130} color={price >= (firstPrice ?? price) ? '#39ff14' : '#ff3131'} />
              <div className="grid-2">
                <div className="stat-row"><span className="sk">PRICE</span><span className="sv">${fmtPrice(price)}</span></div>
                <div className="stat-row"><span className="sk">MARKET CAP</span><span className="sv">{fmtUsd(t.market.marketCapUsd)}</span></div>
                <div className="stat-row"><span className="sk">FDV</span><span className="sv">{fmtUsd(t.market.fdvUsd)}</span></div>
                <div className="stat-row"><span className="sk">VOL 24H</span><span className="sv">{fmtUsd(t.market.volume24hUsd)}</span></div>
                <div className="stat-row"><span className="sk">LIQUIDITY</span><span className="sv">{fmtUsd(t.market.liquidityUsd)}</span></div>
                <div className="stat-row"><span className="sk">PEAK MCAP</span><span className="sv">{fmtUsd(t.market.peakMarketCapUsd)}</span></div>
              </div>
              <div>
                <div className="t8 dim" style={{ marginBottom: 4 }}>GRADUATION PROGRESS</div>
                <Blocks frac={t.graduationProgress} width={26} suffix={`${(t.graduationProgress * 100).toFixed(1)}%`} />
              </div>
              {t.quote && (
                <div className="stat-row"><span className="sk">QUOTE PAIR</span><span className="sv">{t.quote.name} ({t.quote.symbol})</span></div>
              )}
              {t.launch?.creator && (
                <div className="stat-row"><span className="sk">CREATOR</span><span className="sv mono-addr" style={{ fontSize: 16 }}>{shortAddr(String(t.launch.creator), 8)} <CopyBtn text={String(t.launch.creator)} /></span></div>
              )}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <a className="bevel-btn b-cyan" href={`https://www.stonkfun.xyz/token/${t.mint}`} target="_blank" rel="noreferrer">TRADE ON STONKFUN ↗</a>
                <a className="bevel-btn" href={`https://solscan.io/token/${t.mint}`} target="_blank" rel="noreferrer">SOLSCAN ↗</a>
                {t.links?.website && <a className="bevel-btn" href={t.links.website} target="_blank" rel="noreferrer">WEBSITE ↗</a>}
                {t.links?.twitter && <a className="bevel-btn" href={t.links.twitter} target="_blank" rel="noreferrer">TWITTER ↗</a>}
              </div>
              <div className="faint" style={{ fontSize: 15 }}>
                Launch data streams every 5s from the StonkFun wire. Trading happens on the graduated Raydium pool — this
                terminal links out rather than pretending to be a Solana DEX.
              </div>
            </>
          ) : (
            <div className="state-note"><span className="big">DECRYPTING…</span>{t ? 'no market signal for this coin yet' : 'fetching coin file from the wire'}</div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------- RH chain ---------------- */

function RhMemeCard({ meme }: { meme: import('../lib/prm/discovery').MemeListing }) {
  const navigate = useNavigate()
  const load = useTerminal((s) => s.load)
  return (
    <div className="token-card">
      <div className="tc-head">
        <TokenLogo symbol={meme.symbol} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="tc-sym">{meme.symbol}</div>
          <div className="tc-name">{meme.name}</div>
        </div>
        <PhaseBadge phase={meme.phase} />
      </div>
      <div className="tc-stats">
        <span className="k">PRICE≈</span>
        <span>{meme.priceEth != null ? `Ξ ${fmtPrice(meme.priceEth)}` : '—'}</span>
        <span className="k">AGE</span>
        <span>{listingAge(meme.createdAt)}</span>
      </div>
      <div className="tc-foot">
        <button
          className="bevel-btn b-sm b-pink"
          onClick={() => {
            play('coin')
            load({ kind: 'meme', token: meme.token, symbol: meme.symbol })
            navigate('/launchpad/trade')
          }}
        >
          LOAD TO TERMINAL
        </button>
        <button className="bevel-btn b-sm" onClick={() => void navigator.clipboard?.writeText(meme.token)}>COPY</button>
      </div>
    </div>
  )
}

function RhStockCard({ stock }: { stock: import('../lib/prm/discovery').StockListing }) {
  const navigate = useNavigate()
  const load = useTerminal((s) => s.load)
  return (
    <div className="token-card">
      <div className="tc-head">
        <TokenLogo symbol={stock.symbol} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="tc-sym">{stock.symbol}</div>
          <div className="tc-name">{stock.name}</div>
        </div>
        <span className="badge grad">pSTOCK</span>
      </div>
      <div className="tc-stats">
        <span className="k">PRICE≈</span>
        <span>{stock.priceEth != null ? `Ξ ${fmtPrice(stock.priceEth)}` : '—'}</span>
        <span className="k">OPENED</span>
        <span>{listingAge(stock.openedAt)}</span>
      </div>
      <div className="tc-foot">
        <button
          className="bevel-btn b-sm b-cyan"
          onClick={() => {
            play('coin')
            load({ kind: 'stock', token: stock.deskToken, subjectId: stock.subjectId, symbol: stock.symbol })
            navigate('/launchpad/trade')
          }}
        >
          LOAD TO TERMINAL
        </button>
        <button className="bevel-btn b-sm" onClick={() => void navigator.clipboard?.writeText(stock.subjectId)}>COPY ID</button>
      </div>
    </div>
  )
}

/* ---------------- page ---------------- */

export function Markets() {
  const [tab, setTab] = useState<'sol' | 'rh'>('sol')
  const [rhTab, setRhTab] = useState<'memes' | 'stocks'>('memes')

  // SOL grid state — default to newest so fresh launches surface first
  const [sort, setSort] = useState<'newest' | 'marketCap' | 'volume'>('newest')
  const [status, setStatus] = useState<'' | 'new' | 'aboutToGraduate' | 'graduated'>('')
  const [mode, setMode] = useState<'' | 'standard' | 'reward'>('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [openMint, setOpenMint] = useState<string | null>(null)

  const sol = useTokens({ sort, status: status || undefined, mode: mode || undefined, q: q || undefined, page, pageSize: 12 })

  // RH state
  const [rhPage, setRhPage] = useState(1)
  const [rhQ, setRhQ] = useState('')
  const memes = useMemePage(rhPage, 12, RH_ENABLED)
  const stocks = useStockPage(rhPage, 12, RH_ENABLED)

  // handoff from HUB: a coin card was clicked — open its drawer
  const consumeOpenMint = useTerminal((s) => s.consumeOpenMint)
  useEffect(() => {
    const m = consumeOpenMint()
    if (m) setOpenMint(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => setPage(1), [sort, status, mode, q])

  const rhList = rhTab === 'memes' ? memes : stocks
  const rhFiltered = (rhList.data ?? []).filter((x) => {
    const s = rhQ.trim().toLowerCase()
    if (!s) return true
    return ('name' in x && x.name.toLowerCase().includes(s)) || ('symbol' in x && x.symbol.toLowerCase().includes(s))
  })

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">◤ MARKET SCANNER</h1>
        <span className="page-sub">{RH_ENABLED ? 'ALL FREQUENCIES, DECODED LIVE' : 'SOLANA LAUNCHPAD · DECODED LIVE'}</span>
      </div>

      {RH_ENABLED && (
        <div className="tab-row">
          <button className={cn('tab', tab === 'sol' && 'active')} onClick={() => setTab('sol')}>SOL GRID</button>
          <button className={cn('tab', tab === 'rh' && 'active')} onClick={() => setTab('rh')}>RH CHAIN</button>
        </div>
      )}

      {tab === 'sol' ? (
        <Panel
          title="SOL GRID · STONKFUN WIRE ● LIVE"
          end={
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <span>{sol.data ? `PAGE ${sol.data.pagination.page}/${sol.data.pagination.totalPages}` : '···'}</span>
              <span className="t8" style={{ color: sol.isFetching ? 'var(--amber)' : 'var(--green)' }}>
                {sol.isFetching ? 'SYNCING…' : '● LIVE'}
              </span>
              <button className="bevel-btn b-sm" onClick={() => void sol.refetch()} disabled={sol.isFetching}>
                ↻ REFRESH
              </button>
            </span>
          }
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <input placeholder="SEARCH COINS…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 180 }} />
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="newest">SORT: NEWEST</option>
              <option value="marketCap">SORT: MCAP</option>
              <option value="volume">SORT: VOLUME</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="">STATUS: ALL</option>
              <option value="new">NEW</option>
              <option value="aboutToGraduate">NEAR GRAD</option>
              <option value="graduated">GRADUATED</option>
            </select>
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="">MODE: ALL</option>
              <option value="standard">STANDARD</option>
              <option value="reward">REWARD</option>
            </select>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="bevel-btn b-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>◀ PREV</button>
              <button className="bevel-btn b-sm" disabled={!sol.data || page >= sol.data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>NEXT ▶</button>
            </div>
          </div>
          <div className="cards-grid">
            {(sol.data?.tokens ?? []).map((t) => (
              <SolCard key={t.mint} token={t} onOpen={(tk) => setOpenMint(tk.mint)} />
            ))}
          </div>
          {sol.isLoading && <div className="state-note"><span className="big">SCANNING SOL…</span></div>}
          {sol.data?.tokens.length === 0 && <div className="state-note"><span className="big">NO SIGNAL</span>no coins match these filters</div>}
        </Panel>
      ) : (
        <Panel
          title={rhTab === 'memes' ? 'RH CHAIN · MEME DIRECTORY' : 'RH CHAIN · TOKENIZED STOCKS'}
          end={rhList.total ? `${rhList.total.toLocaleString()} ON FILE` : '···'}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <div className="tab-row">
              <button className={cn('tab', rhTab === 'memes' && 'active')} onClick={() => { setRhTab('memes'); setRhPage(1) }}>MEMES</button>
              <button className={cn('tab', rhTab === 'stocks' && 'active')} onClick={() => { setRhTab('stocks'); setRhPage(1) }}>STOCKS</button>
            </div>
            <input placeholder="SEARCH…" value={rhQ} onChange={(e) => setRhQ(e.target.value)} style={{ minWidth: 160 }} />
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="bevel-btn b-sm" disabled={rhPage <= 1} onClick={() => setRhPage((p) => p - 1)}>◀ PREV</button>
              <button className="bevel-btn b-sm" disabled={(rhPage - 1) * 12 + 12 >= rhList.total} onClick={() => setRhPage((p) => p + 1)}>NEXT ▶</button>
            </div>
          </div>
          <div className="cards-grid">
            {rhTab === 'memes'
              ? rhFiltered.map((m) => <RhMemeCard key={(m as import('../lib/prm/discovery').MemeListing).token} meme={m as import('../lib/prm/discovery').MemeListing} />)
              : rhFiltered.map((s) => <RhStockCard key={(s as import('../lib/prm/discovery').StockListing).subjectId} stock={s as import('../lib/prm/discovery').StockListing} />)}
          </div>
          {rhList.loading && <div className="state-note"><span className="big">READING RH-CHAIN DIRECTORY…</span></div>}
          {rhList.error && <div className="state-note"><span className="big">SIGNAL LOST</span>{rhList.error}</div>}
        </Panel>
      )}

      {openMint && <SolDetailDrawer mint={openMint} onClose={() => setOpenMint(null)} />}
    </div>
  )
}
