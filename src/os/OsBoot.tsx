import { useEffect, useRef, useState } from 'react'
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
  'CALIBRATING PHOSPHOR ........... OK',
  '',
  "C:\\CRT-DOS\\> START DESKTOP.EXE",
]

/* CRT-DOS boot — full BIOS POST on fresh sessions, skippable anytime */
export function OsBoot({ onComplete }: { onComplete: () => void }) {
  const [shown, setShown] = useState(0)
  const [ready, setReady] = useState(false)
  const finished = useRef(false)
  const armedAt = useRef(Date.now() + 900) // small grace so a stray click doesn't skip instantly

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

  return (
    <div
      onClick={finish}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 99,
        background: 'var(--screen)',
        padding: 'min(7vw, 64px)',
        fontFamily: 'var(--font-term)',
        fontSize: 'clamp(15px, 2.2vw, 21px)',
        color: 'var(--green)',
        textShadow: 'var(--glow-green)',
        cursor: ready ? 'pointer' : 'progress',
        overflow: 'hidden',
      }}
    >
      {LINES.slice(0, shown).map((l, i) => (
        <div key={i} style={{ whiteSpace: 'pre-wrap' }}>
          {l.includes('CRT-DOS 6.86') || l.includes('START DESKTOP') ? (
            <span style={{ color: 'var(--cyan)', textShadow: 'var(--glow-cyan)' }}>{l}</span>
          ) : (
            l || '\u00A0'
          )}
        </div>
      ))}
      {ready ? (
        <div style={{ marginTop: 16, color: 'var(--amber)', textShadow: 'var(--glow-amber)' }} className="blink">
          ► PRESS ANY KEY TO ENTER CRT-DOS ◄
        </div>
      ) : (
        <span className="blink">▮</span>
      )}
    </div>
  )
}
