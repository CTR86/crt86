import { useNavigate } from 'react-router-dom'
import { Panel } from '../design/ui'

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: '01',
    title: 'DEX.EXE — SOLANA',
    body: 'Spot DEX inside the CRT. Swap, chart and snipe Solana pairs first — same terminal, no new site.',
  },
  {
    n: '02',
    title: 'ROBINHOOD CHAIN — FULL OS',
    body: 'RH-CHAIN wired into every module: launchpad, DEX and trading terminal. Same CRT, both chains.',
  },
  {
    n: '03',
    title: 'BSC INTEGRATION',
    body: 'BNB Chain next. Launchpad, DEX and terminal follow the same plug-in path as RH-CHAIN.',
  },
]

export function RoadmapWindow() {
  const nav = useNavigate()
  return (
    <div className="page" style={{ alignItems: 'center' }}>
      <div style={{ maxWidth: 640, width: '100%' }}>
        <Panel title="ROADMAP.EXE — CRT-DOS PLAN" end={<span className="pt-end">NO DATES · STEPS ONLY</span>}>
          <div className="faint" style={{ fontSize: 15, marginBottom: 12 }}>
            LIVE NOW: Solana launchpad · BRIDGE.EXE (SOL ⇄ EVM) · markets tape. What ships next, in order:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {STEPS.map((s) => (
              <div key={s.n} className="stat-row" style={{ alignItems: 'flex-start', gap: 12, padding: '12px 0' }}>
                <span className="sk" style={{ color: 'var(--pink)', minWidth: 36 }}>{s.n}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t9" style={{ color: 'var(--cyan)', textShadow: 'var(--glow-cyan)' }}>{s.title}</div>
                  <div className="dim" style={{ fontSize: 17, marginTop: 4 }}>{s.body}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <button className="bevel-btn b-lg b-cyan" onClick={() => nav('/')}>◀ BACK TO DESKTOP</button>
        </div>
      </div>
    </div>
  )
}
