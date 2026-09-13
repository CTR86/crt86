import { useNavigate } from 'react-router-dom'
import { Markets } from '../pages/Markets'
import { play } from '../sound/sfx'

/* TERMINAL.EXE — the market wire. Glaze the movers: popped, graduated, new. */
export function TerminalWindow() {
  const nav = useNavigate()
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
          📟 TERMINAL.EXE — MARKET WIRE <span className="blink" style={{ color: 'var(--green)' }}>● LIVE</span>
        </span>
        <span className="faint" style={{ fontSize: 14 }}>
          glaze the wire — which token popped, which one is graduating
        </span>
        <button className="bevel-btn b-sm b-cyan" onClick={() => { nav('/'); play('open') }}>
          ◀ DESKTOP
        </button>
      </div>

      <Markets />
    </div>
  )
}
