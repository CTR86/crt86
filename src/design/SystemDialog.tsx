import { useEffect, type ReactNode } from 'react'

/* "SYSTEM DIALOG" modal — window with a pink title bar */
export function SystemDialog({
  title,
  children,
  actions,
  onClose,
}: {
  title: string
  children: ReactNode
  actions?: ReactNode
  onClose?: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="dialog" role="dialog" aria-label={title}>
        <div className="dialog-title">
          <span>▚ {title}</span>
          {onClose && (
            <button className="bevel-btn b-sm" onClick={onClose} aria-label="close">
              ✕
            </button>
          )}
        </div>
        <div className="dialog-body">{children}</div>
        {actions != null && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>
  )
}
