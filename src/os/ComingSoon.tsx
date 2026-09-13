import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { blocks } from '../lib/format'

/* Modules not built yet: loader first, then a retro UNDER CONSTRUCTION window */
export function ComingSoon({ exe, icon, title, desc }: { exe: string; icon: string; title: string; desc: string }) {
  const [phase, setPhase] = useState<'load' | 'soon'>('load')
  const [pct, setPct] = useState(0)
  const nav = useNavigate()

  useEffect(() => {
    const iv = setInterval(() => setPct((p) => Math.min(99, p + Math.floor(Math.random() * 11) + 4)), 130)
    const t = setTimeout(() => {
      clearInterval(iv)
      setPhase('soon')
    }, 2400)
    return () => {
      clearInterval(iv)
      clearTimeout(t)
    }
  }, [])

  if (phase === 'load') {
    return (
      <div className="page" style={{ alignItems: 'center', justifyContent: 'center', minHeight: '55vh' }}>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
          <div style={{ fontSize: 46 }} className="blink">💾</div>
          <div className="t10" style={{ color: 'var(--cyan)', textShadow: 'var(--glow-cyan)' }}>
            LOADING {exe}
          </div>
          <div className="blocks" style={{ fontSize: 20 }}>
            {blocks(pct / 100, 26)} {pct}%
          </div>
          <div className="faint" style={{ fontSize: 15 }}>CRT-DOS 6.86 · DO NOT POWER OFF THE CRT</div>
        </div>
      </div>
    )
  }

  return (
    <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="panel" style={{ maxWidth: 640, width: '100%' }}>
        <div className="dialog-title" style={{ margin: '-2px -2px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px' }}>
          <span>▚ {exe} — CRT-DOS TASK MANAGER</span>
          <span>▸▮</span>
        </div>
        <div className="panel-body" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
          <div style={{ fontSize: 52 }}>{icon}</div>
          <div className="t12" style={{ color: 'var(--amber)', textShadow: 'var(--glow-amber)' }}>
            🚧 {title} — UNDER CONSTRUCTION
          </div>
          <div className="dim" style={{ fontSize: 18, maxWidth: 460 }}>{desc}</div>
          <div style={{ width: '100%' }}>
            <div className="blocks" style={{ fontSize: 18 }}>
              {blocks(0.99, 30)} 99%
            </div>
            <div className="faint" style={{ fontSize: 14, marginTop: 4 }}>
              build progress: soldering the last transistors… stuck at 99% since 1986.
            </div>
          </div>
          <div className="t8 dim">ETA: SOON™ · SOLANA FIRST, MULTICHAIN LATER</div>
          <button className="bevel-btn b-lg b-cyan" onClick={() => nav('/')}>
            ◀ BACK TO DESKTOP
          </button>
        </div>
      </div>
    </div>
  )
}
