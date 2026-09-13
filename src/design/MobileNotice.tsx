import { useEffect, useState } from 'react'

/* Shown once per visit on small screens: the terminal switches to its
   compact mobile UI. Dismissible — desktop mode is still the full view. */
export function MobileNotice() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 820px)').matches)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)')
    const h = () => setMobile(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])

  if (!mobile || dismissed) return null

  return (
    <div className="dialog-overlay" style={{ zIndex: 300 }}>
      <div className="dialog">
        <div className="dialog-title">
          <span>▚ MOBILE MODE</span>
        </div>
        <div className="dialog-body" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <div style={{ fontSize: 40 }}>📱</div>
          <div className="t10" style={{ color: 'var(--cyan)', textShadow: 'var(--glow-cyan)' }}>
            COMPACT TERMINAL ENGAGED
          </div>
          <div className="dim" style={{ maxWidth: 340 }}>
            You're on a phone, so the terminal switches to its responsive mobile UI. Launch coins,
            scan markets and check your dossier right here — for the full desktop experience, open
            CRT86 on a desktop browser.
          </div>
          <button className="bevel-btn b-cyan b-sm" onClick={() => setDismissed(true)}>
            ENTER MOBILE MODE ▶
          </button>
        </div>
      </div>
    </div>
  )
}
