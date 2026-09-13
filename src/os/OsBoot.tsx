import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { RH_ENABLED } from '../config'

const LINES: string[] = [
  'CRT-DOS 6.86 — CRT86 SYSTEMS INC.',
  'COPYRIGHT 1986-2026. ALL RIGHTS RESERVED.',
  '',
  'CRTBIOS v8.6 .................. OK',
  'CPU ........ Z80-X TURBO @ 6.86 MHz  OK',
  'MEM CHECK .. 640K NEOFLOPPIES  OK',
  'DRIVE C: CRT-DOS.SYS ........... OK',
  'DRIVE A: SEEKING ............... ┐┌┐┌ OK',
  '',
  'DETECTING SOLANA MAINNET-BETA .. OK',
  ...(RH_ENABLED ? ['DETECTING RH-CHAIN (4663) ...... OK'] : []),
  '',
  'LOADING CRT-DOS.KERN ........... OK',
  'MOUNTING LAUNCHPAD.EXE ......... OK',
  'DEX.EXE ........................ QUEUED',
  'BRIDGE.EXE ..................... QUEUED',
  'TERMINAL.EXE ................... QUEUED',
  'STOCK.EXE ...................... OK',
  'CALIBRATING PHOSPHOR ........... OK',
  '',
  "C:\\CRT-DOS\\> START DESKTOP.EXE",
]

/* CRT-DOS boot — full BIOS POST on fresh sessions, skippable anytime */
export function OsBoot({ onComplete }: { onComplete: () => void }) {
  const [shown, setShown] = useState(0)
  const [ready, setReady] = useState(false)
  const [fit, setFit] = useState({ scale: 1, w: 0, h: 0 })
  const finished = useRef(false)
  const armedAt = useRef(Date.now() + 900) // small grace so a stray click doesn't skip instantly
  const bootRef = useRef<HTMLDivElement>(null)
  const colRef = useRef<HTMLDivElement>(null)

  const finish = () => {
    if (finished.current) return
    if (Date.now() < armedAt.current) return
    finished.current = true
    onComplete()
  }

  useEffect(() => {
    const iv = setInterval(() => {
      setShown((s) => {
        if (s >= LINES.length) {
          clearInterval(iv)
          setReady(true)
          return s
        }
        return s + 1
      })
    }, 110)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    const h = () => finish()
    window.addEventListener('keydown', h)
    window.addEventListener('pointerdown', h)
    return () => {
      window.removeEventListener('keydown', h)
      window.removeEventListener('pointerdown', h)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Scale the POST block to fill the CRT — centered, no huge side gutters, no clip. */
  useLayoutEffect(() => {
    const boot = bootRef.current
    const col = colRef.current
    if (!boot || !col) return

    const measure = () => {
      const cw = col.offsetWidth
      const ch = col.offsetHeight
      if (cw < 8 || ch < 8) return
      const sx = (boot.clientWidth - 32) / cw
      const sy = (boot.clientHeight - 24) / ch
      const next = Math.min(sx, sy, 3.4)
      if (!Number.isFinite(next) || next <= 0) return
      setFit((prev) =>
        prev.w === cw && prev.h === ch && Math.abs(prev.scale - next) < 0.01
          ? prev
          : { scale: next, w: cw, h: ch },
      )
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(boot)
    ro.observe(col)
    return () => ro.disconnect()
  }, [shown, ready])

  return (
    <div ref={bootRef} className="os-boot" onClick={finish} style={{ cursor: ready ? 'pointer' : 'progress' }}>
      <div
        className="os-boot-fit"
        style={fit.w && fit.h ? { width: fit.w * fit.scale, height: fit.h * fit.scale } : undefined}
      >
        <div ref={colRef} className="os-boot-col" style={{ transform: `scale(${fit.scale})` }}>
          {LINES.slice(0, shown).map((l, i) => (
            <div key={i} className="os-boot-line">
              {l.includes('CRT-DOS 6.86') || l.includes('START DESKTOP') ? (
                <span style={{ color: 'var(--cyan)', textShadow: 'var(--glow-cyan)' }}>{l}</span>
              ) : (
                l || '\u00A0'
              )}
            </div>
          ))}
          {ready ? (
            <div className="os-boot-prompt blink">► PRESS ANY KEY TO ENTER CRT-DOS ◄</div>
          ) : (
            <span className="blink">▮</span>
          )}
        </div>
      </div>
    </div>
  )
}
