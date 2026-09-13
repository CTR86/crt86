import { useEffect, useRef, useState, type ReactNode } from 'react'
import { blocks, cn, sfAssetUrlSafe } from './ui-helpers'
import { sfAssetUrl } from '../lib/stonkfun'

/* ---------- Panel ---------- */
export function Panel({
  title,
  end,
  children,
  className,
  bodyClass,
  flush,
}: {
  title?: ReactNode
  end?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
  flush?: boolean
}) {
  return (
    <section className={cn('panel', className)}>
      {title != null && (
        <div className="panel-title">
          <span>◤ {title}</span>
          {end != null && <span className="pt-end">{end}</span>}
        </div>
      )}
      <div className={cn('panel-body', flush && 'flush', bodyClass)}>{children}</div>
    </section>
  )
}

/* ---------- LED ---------- */
export function LedDot({ color = 'green', off, solid, title }: { color?: 'green' | 'pink' | 'cyan' | 'amber' | 'red'; off?: boolean; solid?: boolean; title?: string }) {
  return <span className={cn('led', color, off && 'off', solid && 'solid')} title={title} />
}

/* ---------- block progress ---------- */
export function Blocks({ frac, width = 14, suffix }: { frac: number; width?: number; suffix?: string }) {
  return (
    <span className="blocks">
      {blocks(frac, width)}
      {suffix != null ? ` ${suffix}` : ''}
    </span>
  )
}

/* ---------- token avatar ---------- */
export function TokenLogo({ src, symbol, size }: { src?: string | null; symbol: string; size?: number }) {
  const [err, setErr] = useState(false)
  const url = src ? sfAssetUrlSafe(src) : undefined
  const showImg = url != null && !err
  return (
    <span className="token-logo" style={size ? { width: size, height: size } : undefined}>
      {showImg ? (
        <img src={url} alt={symbol} loading="lazy" onError={() => setErr(true)} />
      ) : (
        symbol.slice(0, 3)
      )}
    </span>
  )
}

export { sfAssetUrl }

/* ---------- status badge ---------- */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    new: { cls: 'new', label: 'NEW' },
    aboutToGraduate: { cls: 'near', label: 'NEAR GRAD' },
    graduated: { cls: 'grad', label: 'GRADUATED' },
    standard: { cls: 'dim', label: 'STANDARD' },
    reward: { cls: 'reward', label: 'REWARD' },
  }
  const m = map[status] ?? { cls: 'dim', label: status.toUpperCase() }
  return <span className={cn('badge', m.cls)}>{m.label}</span>
}

export function PhaseBadge({ phase }: { phase: number }) {
  const cls = phase === 0 ? 'new' : phase === 1 ? 'grad' : 'paused'
  const label = phase === 0 ? 'TRADING' : phase === 1 ? 'GRADUATED' : 'PAUSED'
  return <span className={cn('badge', cls)}>{label}</span>
}

/* ---------- LED readout ---------- */
export function Readout({
  label,
  value,
  sub,
  tone = 'green',
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: 'green' | 'cyan' | 'pink' | 'amber'
}) {
  return (
    <div className={cn('readout', tone !== 'green' && `ro-${tone}`)}>
      <div className="ro-label">{label}</div>
      <div className="ro-value">{value}</div>
      {sub != null && <div className="ro-sub">{sub}</div>}
    </div>
  )
}

/* ---------- form field ---------- */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint != null && <span className="field-hint">{hint}</span>}
    </label>
  )
}

/* ---------- checkbox switch ---------- */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <span
      className="switch"
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => e.key === 'Enter' && onChange(!checked)}
    >
      <span className="switch-box">{checked ? '☑' : '☐'}</span>
      <span>{label}</span>
    </span>
  )
}

/* ---------- canvas oscilloscope ---------- */
export function Scope({
  series,
  color = '#39ff14',
  height = 120,
  grid = true,
}: {
  series: number[]
  color?: string
  height?: number
  grid?: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const parent = canvas.parentElement
    const w = parent?.clientWidth ?? 300
    const dpr = window.devicePixelRatio || 1
    canvas.width = w * dpr
    canvas.height = height * dpr
    canvas.style.width = '100%'
    canvas.style.height = `${height}px`
    const g = canvas.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    g.clearRect(0, 0, w, height)

    if (grid) {
      g.strokeStyle = 'rgba(106,63,181,0.35)'
      g.lineWidth = 1
      for (let x = 0; x < w; x += 24) {
        g.beginPath()
        g.moveTo(x + 0.5, 0)
        g.lineTo(x + 0.5, height)
        g.stroke()
      }
      for (let y = 0; y < height; y += 20) {
        g.beginPath()
        g.moveTo(0, y + 0.5)
        g.lineTo(w, y + 0.5)
        g.stroke()
      }
    }

    if (series.length >= 2) {
      const min = Math.min(...series)
      const max = Math.max(...series)
      const span = max - min || max * 0.01 || 1
      g.strokeStyle = color
      g.lineWidth = 2
      g.shadowColor = color
      g.shadowBlur = 6
      g.beginPath()
      series.forEach((v, i) => {
        const x = (i / (series.length - 1)) * (w - 8) + 4
        const y = height - 8 - ((v - min) / span) * (height - 20)
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      })
      g.stroke()
      g.shadowBlur = 0
      // last point marker
      const lv = series[series.length - 1]
      const lx = w - 4
      const ly = height - 8 - ((lv - min) / span) * (height - 20)
      g.fillStyle = color
      g.fillRect(lx - 3, ly - 3, 6, 6)
    } else {
      g.fillStyle = 'rgba(157,127,212,0.6)'
      g.font = '15px VT323, monospace'
      g.fillText('AWAITING SIGNAL — SAMPLING…', 10, height / 2)
    }
  }, [series, color, height, grid])
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <canvas ref={ref} className="scope" />
    </div>
  )
}

/* ---------- coin rain (success flourish) ---------- */
export function CoinRain({ count = 26 }: { count?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const glyphs = ['◉', '$', '¢', '◆']
    el.innerHTML = ''
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span')
      s.textContent = glyphs[Math.floor(Math.random() * glyphs.length)]
      s.style.left = `${Math.random() * 100}%`
      s.style.animationDuration = `${1.1 + Math.random() * 1.6}s`
      s.style.animationDelay = `${Math.random() * 0.7}s`
      el.appendChild(s)
    }
  }, [count])
  return <div ref={ref} className="coin-rain" />
}

/* ---------- copy button ---------- */
export function CopyBtn({ text, label = 'COPY' }: { text: string; label?: string }) {
  return (
    <button
      className="bevel-btn b-sm"
      onClick={(e) => {
        e.stopPropagation()
        void navigator.clipboard?.writeText(text)
      }}
      title={text}
    >
      {label}
    </button>
  )
}
