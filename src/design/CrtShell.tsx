import type { ReactNode } from 'react'
import { cn } from '../lib/format'

/* The CRT monitor the whole app lives inside.
   `top` and `bottom` are pinned chrome (header / status bar);
   `children` is the scrollable screen surface. */
export function CrtShell({
  hyper,
  top,
  bottom,
  children,
}: {
  hyper?: boolean
  top?: ReactNode
  bottom?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={cn('crt-room', hyper && 'hyper')}>
      <div className="crt-bezel">
        <div className="crt-screen crt-flicker">
          <div className="crt-band" />
          {top}
          <div className="crt-content">{children}</div>
          {bottom}
        </div>
      </div>
    </div>
  )
}
