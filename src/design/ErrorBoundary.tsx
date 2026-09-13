import { Component, type ReactNode } from 'react'

/* Retro "SYSTEM FAULT" screen — a render crash anywhere in the terminal
   shows this instead of a dead white screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div className="panel" style={{ maxWidth: 580, width: '100%' }}>
            <div className="panel-title">
              <span>◤ SYSTEM FAULT</span>
              <span className="pt-end">NMI</span>
            </div>
            <div className="panel-body" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
              <div className="t12" style={{ color: 'var(--red)', textShadow: 'var(--glow-red)' }}>
                ⛔ FATAL EXCEPTION — TERMINAL HALTED
              </div>
              <div className="telemetry" style={{ maxHeight: 150, width: '100%', textAlign: 'left' }}>
                {this.state.error.message}
              </div>
              <button
                className="bevel-btn b-danger b-lg"
                onClick={() => {
                  this.setState({ error: null })
                  location.hash = '#/'
                }}
              >
                ↺ RESET TERMINAL
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
