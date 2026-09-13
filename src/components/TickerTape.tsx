import { useTokens } from '../hooks/stonk'
import { fmtPrice, fmtUsd } from '../lib/format'
import { RH_ENABLED } from '../config'

/* Marquee tape of live Solana launchpad tokens */
export function TickerTape() {
  const { data } = useTokens({ sort: 'volume', pageSize: 14 })
  const tokens = data?.tokens ?? []
  if (!tokens.length) {
    return (
      <div className="marquee" style={{ borderBottom: '2px solid var(--line)', padding: '6px 0' }}>
        <div className="marquee-inner aberrate" style={{ color: 'var(--cyan)' }}>
          ◆ MOUNTING MARKET DATA ◆ STANDBY ◆ CRT86 WIRE SERVICE ◆ MOUNTING MARKET DATA ◆ STANDBY ◆
        </div>
      </div>
    )
  }
  return (
    <div className="marquee" style={{ borderBottom: '2px solid var(--line)', padding: '6px 0', background: 'rgba(5,1,12,0.7)' }}>
      <div className="marquee-inner">
        <span className="t9 aberrate" style={{ color: 'var(--pink)' }}>◆ LIVE WIRE ◆</span>
        {tokens.map((t) => (
          <span className="tape-item" key={t.mint}>
            <b style={{ color: 'var(--amber)' }}>{t.symbol}</b>
            <span className="faint">${fmtPrice(t.market.priceUsd)}</span>
            <span className="dim">MC {fmtUsd(t.market.marketCapUsd)}</span>
          </span>
        ))}
        {RH_ENABLED && <span className="t9 aberrate" style={{ color: 'var(--cyan)' }}>◆ RH-CHAIN FEED ON TRADE TERMINAL ◆</span>}
      </div>
    </div>
  )
}
