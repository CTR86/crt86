import { useNavigate } from 'react-router-dom'
import { CopyBtn, Panel } from '../design/ui'
import { OFFICIAL_CA } from '../config'
import { shortAddr } from '../lib/format'
import { play } from '../sound/sfx'

export function MoneyWindow() {
  const nav = useNavigate()
  const live = OFFICIAL_CA.trim().length > 0
  return (
    <div className="page" style={{ alignItems: 'center' }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <Panel title="MONEY.EXE — OFFICIAL COIN" end={<span className="pt-end">COIN.SYS</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="stat-row"><span className="sk">NETWORK</span><span className="sv">SOLANA</span></div>
            <div className="stat-row"><span className="sk">OFFICIAL CA</span><span className="sv mono-addr">{live ? shortAddr(OFFICIAL_CA, 8) : '——  DROPPING AT LAUNCH'}</span></div>
            <div className="faint" style={{ fontSize: 15 }}>
              {live
                ? 'Only trust the address shown here. Copy it, verify it on Solscan before you ape.'
                : 'CA is blank on purpose — the official contract address drops here the moment the coin launches.'}
            </div>
            {live ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a
                  className="bevel-btn b-lg b-amber"
                  href={`https://pump.fun/coin/${OFFICIAL_CA}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => play('click')}
                >
                  BUY NOW ↗
                </a>
                <CopyBtn text={OFFICIAL_CA} label="COPY CA" />
                <a
                  className="bevel-btn b-lg"
                  href={`https://solscan.io/token/${OFFICIAL_CA}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => play('click')}
                >
                  VIEW ON SOLSCAN ↗
                </a>
              </div>
            ) : (
              <button className="bevel-btn b-lg" disabled>
                OFFICIAL CA — TBA
              </button>
            )}
          </div>
        </Panel>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <button className="bevel-btn b-lg b-cyan" onClick={() => nav('/')}>◀ BACK TO DESKTOP</button>
        </div>
      </div>
    </div>
  )
}
