import { useEffect, useState } from 'react'
import { blocks } from '../lib/format'

/* Fullscreen retro module loader — "LOADING X.EXE" with a block progress bar */
export function ModuleLoader({ label }: { label: string }) {
  const [pct, setPct] = useState(0)

  useEffect(() => {
    const iv = setInterval(() => {
      setPct((p) => Math.min(100, p + Math.floor(Math.random() * 16) + 5))
    }, 150)
    return () => clearInterval(iv)
  }, [])

  return (
    <div className="page" style={{ alignItems: 'center', justifyContent: 'center', minHeight: '55vh' }}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
        <div style={{ fontSize: 46 }} className="blink">💾</div>
        <div className="t10" style={{ color: 'var(--cyan)', textShadow: 'var(--glow-cyan)' }}>
          LOADING {label}
        </div>
        <div className="blocks" style={{ fontSize: 20 }}>
          {blocks(pct / 100, 26)} {pct}%
        </div>
        <div className="faint" style={{ fontSize: 15 }}>
          CRT-DOS 6.86 · DO NOT POWER OFF THE CRT
        </div>
      </div>
    </div>
  )
}
