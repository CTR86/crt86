import { useEffect, useRef, useState } from 'react'
import { RH_ENABLED } from '../config'

const LINES = [
  'CRTBIOS v8.6 — CRT86 SYSTEMS INC.',
  'COPYRIGHT 1986-2026. ALL RIGHTS RESERVED.',
  '',
  'CPU ................ Z80-X @ 6.14 MHz  OK',
  'MEM CHECK .......... 640K OK',
  'AUDIO .............. SID 8580 OK',
  '',
  'DETECTING SOLANA MAINNET-BETA .... OK',
  ...(RH_ENABLED ? ['DETECTING RH-CHAIN (4663) ........ OK'] : []),
  'LOADING NEONLAUNCH.SYS ........... OK',
  'MOUNTING MARKET DATA ............. OK',
  'CALIBRATING PHOSPHOR ............. OK',
  '',
  'READY.',
]

/* Fake BIOS POST sequence — skippable with any key / click */
export function BootScreen({ onDone }: { onDone: () => void }) {
  const [shown, setShown] = useState(0)
  const [ready, setReady] = useState(false)
  const doneRef = useRef(false)

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
    }, 170)
    return () => clearInterval(iv)
  }, [])

  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    onDone()
  }

  useEffect(() => {
    if (!ready) return
    window.addEventListener('keydown', finish)
    return () => window.removeEventListener('keydown', finish)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  return (
    <div
      onClick={ready ? finish : undefined}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 99,
        background: 'var(--screen)',
        padding: 'min(8vw, 70px)',
        fontFamily: 'var(--font-term)',
        fontSize: 'clamp(15px, 2.4vw, 22px)',
        color: 'var(--green)',
        textShadow: 'var(--glow-green)',
        cursor: ready ? 'pointer' : 'default',
        overflow: 'hidden',
      }}
    >
      {LINES.slice(0, shown).map((l, i) => (
        <div key={i}>{l || '\u00A0'}</div>
      ))}
      {ready ? (
        <div style={{ marginTop: 18, color: 'var(--amber)', textShadow: 'var(--glow-amber)' }} className="blink">
          ► PRESS ANY KEY TO BOOT CRT86 ◄
        </div>
      ) : (
        <span className="blink">▮</span>
      )}
    </div>
  )
}
