import { Link, useNavigate } from 'react-router-dom'
import { useMemePage } from '../hooks/prm'
import { useStats, useTokens } from '../hooks/stonk'
import { Blocks, LedDot, Panel, StatusBadge, TokenLogo } from '../design/ui'
import { fmtPrice, fmtUsd, timeAgo } from '../lib/format'
import { sfAssetUrl } from '../lib/stonkfun'
import { listingAge } from '../lib/prm/discovery'
import { play } from '../sound/sfx'
import { RH_ENABLED } from '../config'
import { useTerminal } from '../store/terminal'

function NewCoinCard({ token }: { token: import('../lib/stonkfun').SfToken }) {
  const navigate = useNavigate()
  const openCoin = useTerminal((s) => s.openCoin)
  return (
    <button
      className="token-card"
      onClick={() => {
        play('click')
        openCoin(token.mint)
        navigate('/markets')
      }}
    >
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
      </div>
      <div className="tc-foot">
        <Blocks frac={token.graduationProgress} width={10} />
        <span className="faint" style={{ fontSize: 14 }}>{timeAgo(token.createdAt)}</span>
      </div>
    </button>
  )
}

export function Hub() {
  const { data: stats } = useStats()
  const { data: newest } = useTokens({ sort: 'newest', pageSize: 9 })
  const memePage = useMemePage(1, 6, RH_ENABLED)

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">◤ MISSION HUB</h1>
        <span className="page-sub">{RH_ENABLED ? 'TWO FREQUENCIES. ONE TERMINAL.' : 'SOLANA FREQUENCY · SOLO MISSION'}</span>
      </div>

      <div className={RH_ENABLED ? 'grid-3' : 'grid-3 solo'}>
        <Panel title="MISSION STATS" end={<LedDot color="cyan" />}>
          <div className="stat-row"><span className="sk">SOL TOKENS</span><span className="sv">{stats ? stats.tokens.total.toLocaleString() : '····'}</span></div>
          <div className="stat-row"><span className="sk">GRADUATED</span><span className="sv up">{stats ? stats.tokens.graduated.toLocaleString() : '····'}</span></div>
          <div className="stat-row"><span className="sk">REWARD LAUNCHES</span><span className="sv" style={{ color: '#ff7ae0' }}>{stats ? stats.tokens.rewardLaunches.toLocaleString() : '····'}</span></div>
          <div className="stat-row"><span className="sk">TOTAL MCAP</span><span className="sv">{stats ? fmtUsd(stats.tokens.totalMarketCapUsd) : '····'}</span></div>
          <div className="stat-row"><span className="sk">VOLUME 24H</span><span className="sv">{stats ? fmtUsd(stats.tokens.totalVolume24hUsd) : '····'}</span></div>
          <div className="stat-row"><span className="sk">REVENUE</span><span className="sv">{stats ? fmtUsd(stats.revenue.totalRevenueUsd) : '····'}</span></div>
          <div className="stat-row"><span className="sk">BUYBACKS</span><span className="sv up">{stats ? fmtUsd(stats.revenue.totalBuybackUsd) : '····'}</span></div>
          <div className="stat-row"><span className="sk">BURNED</span><span className="sv down">{stats ? fmtUsd(stats.burns.totalValueUsdAtBurn) : '····'}</span></div>
          <div style={{ marginTop: 12 }}>
            <div className="t8 dim" style={{ marginBottom: 6 }}>◈ SYSTEM FLAGS</div>
            {stats &&
              Object.entries(stats.config)
                .filter(([, v]) => typeof v === 'boolean')
                .map(([k, v]) => (
                  <div key={k} className="stat-row" style={{ padding: '2px 0' }}>
                    <span className="sk" style={{ fontSize: 7 }}>{k.replace(/([A-Z])/g, ' $1')}</span>
                    <LedDot color={v ? 'green' : 'red'} solid />
                  </div>
                ))}
          </div>
        </Panel>

        <Panel title="NEW TRANSMISSIONS · SOL" end={<Link to="/terminal" className="t8" style={{ color: 'var(--pink)' }}>VIEW ALL →</Link>}>
          <div className="cards-grid">
            {(newest?.tokens ?? []).slice(0, 9).map((t) => (
              <NewCoinCard key={t.mint} token={t} />
            ))}
            {!newest && <div className="state-note"><span className="big">TUNING…</span>fetching launch telemetry</div>}
          </div>
        </Panel>

        {RH_ENABLED && (
          <Panel title="RH-CHAIN HEADLINES" end={<LedDot color="pink" />}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(memePage.data ?? []).map((m) => (
                <Link key={m.token} to="/launchpad/trade" className="stat-row" style={{ textDecoration: 'none', color: 'inherit' }} onClick={() => play('click')}>
                  <span className="sk" style={{ color: 'var(--amber)' }}>{m.symbol}</span>
                  <span className="faint" style={{ fontSize: 15 }}>{m.name}</span>
                  <span className="sv dim" style={{ fontSize: 15 }}>{listingAge(m.createdAt)}</span>
                </Link>
              ))}
              {memePage.loading && <div className="state-note"><span className="big">SCANNING…</span>reading RH-CHAIN directory</div>}
              {memePage.error && <div className="state-note">RH-CHAIN UNREACHABLE — check console</div>}
              <Link to="/terminal" className="t8" style={{ color: 'var(--pink)', textAlign: 'right' }}>
                {memePage.total > 0 ? `${memePage.total.toLocaleString()} MEMES ON FILE →` : 'OPEN DIRECTORY →'}
              </Link>
            </div>
          </Panel>
        )}
      </div>

      <div className="warn-strip">
        <span>◈</span>
        <span>
          {RH_ENABLED ? (
            <>
              THIS TERMINAL OPERATES TWO FREQUENCIES — <b>SOLANA LAUNCH DECK</b>: create &amp; launch coins via the StonkFun
              API (you sign, the platform broadcasts atomically). <b>RH-CHAIN TRADE TERMINAL</b>: swap tokenized stocks &amp;
              memes via the PRM router on Robinhood Chain. Real money. Quotes are not reservations.
            </>
          ) : (
            <>
              <b>SOLANA LAUNCH DECK</b> — create &amp; launch coins on StonkFun or Ember from one retro deck. Non-custodial:
              you sign, the engine broadcasts atomically. Creator fees are claimable in the FEE VAULT.
            </>
          )}
        </span>
      </div>
    </div>
  )
}
