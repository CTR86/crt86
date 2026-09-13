import { useNavigate } from 'react-router-dom'
import { Panel } from '../design/ui'

const X_URL = 'https://x.com/crt86vibe'
const X_HANDLE = '@crt86vibe'

export function XWindow() {
  const nav = useNavigate()
  const live = X_URL.trim().length > 0
  return (
    <div className="page" style={{ alignItems: 'center' }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <Panel title="X.EXE — CRT86 ON X" end={<span className="pt-end">SOCIAL.SYS</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="stat-row"><span className="sk">NETWORK</span><span className="sv">X (TWITTER)</span></div>
            <div className="stat-row"><span className="sk">HANDLE</span><span className="sv">{live ? X_HANDLE : '——  DROPPING SOON'}</span></div>
            <div className="faint" style={{ fontSize: 15 }}>
              {live ? 'Follow CRT86 on X. Opens in a new tab.' : 'Link is blank on purpose — we will drop the X handle here as soon as it is live.'}
            </div>
            <button
              className="bevel-btn b-lg"
              disabled={!live}
              onClick={() => {
                if (live) window.open(X_URL, '_blank', 'noopener,noreferrer')
              }}
            >
              {live ? 'OPEN @CRT86VIBE' : 'X LINK — TBA'}
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
