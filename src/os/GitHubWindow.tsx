import { useNavigate } from 'react-router-dom'
import { Panel } from '../design/ui'

const GH_URL = 'https://github.com/CTR86/crt86'
const GH_REPO = 'CTR86/crt86'

export function GitHubWindow() {
  const nav = useNavigate()
  return (
    <div className="page" style={{ alignItems: 'center' }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <Panel title="GITHUB.EXE — CRT86 SOURCE" end={<span className="pt-end">REPO.SYS</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="stat-row"><span className="sk">NETWORK</span><span className="sv">GITHUB</span></div>
            <div className="stat-row"><span className="sk">REPO</span><span className="sv">{GH_REPO}</span></div>
            <div className="faint" style={{ fontSize: 15 }}>
              Public source for CRT-DOS 6.86. Opens in a new tab. MIT-licensed — no keys, no wallets, no .env.
            </div>
            <button
              className="bevel-btn b-lg"
              onClick={() => window.open(GH_URL, '_blank', 'noopener,noreferrer')}
            >
              OPEN {GH_REPO}
            </button>
          </div>
        </Panel>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <button className="bevel-btn b-lg b-cyan" onClick={() => nav('/')}>◀ BACK TO DESKTOP</button>
        </div>
      </div>
    </div>
  )
}
