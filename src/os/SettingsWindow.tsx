import { useNavigate } from 'react-router-dom'
import { useSettings } from '../store/settings'
import { useSolanaWallet } from '../wallets/SolanaWallet'
import { Panel } from '../design/ui'
import { play } from '../sound/sfx'
import { cn } from '../lib/format'

function ToggleRow({ label, desc, on, onToggle }: { label: string; desc: string; on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div className="stat-row" style={{ alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t9" style={{ color: on ? 'var(--green)' : 'var(--text-dim)', textShadow: on ? 'var(--glow-green)' : 'none' }}>
          {label} — {on ? 'ON' : 'OFF'}
        </div>
        <div className="faint" style={{ fontSize: 14 }}>{desc}</div>
      </div>
      <button
        className={cn('chip-toggle', on && 'on')}
        style={{ fontSize: 9, padding: '8px 12px' }}
        onClick={() => {
          onToggle(!on)
          play(on ? 'click' : 'open')
        }}
      >
        {on ? '◉ ON' : '○ OFF'}
      </button>
    </div>
  )
}

/* SETTINGS.EXE — the CRT-DOS control panel */
export function SettingsWindow() {
  const { effects, sound, night, setEffects, setSound, setNight } = useSettings()
  const { address, available } = useSolanaWallet()
  const nav = useNavigate()

  return (
    <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 640, width: '100%' }}>
        <Panel title="SETTINGS.EXE — CRT-DOS CONTROL PANEL" end={<span className="pt-end">v6.86</span>}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <ToggleRow
              label="CRT EFFECTS"
              desc="scanlines, phosphor glow, curvature, flicker"
              on={effects}
              onToggle={setEffects}
            />
            <ToggleRow
              label="SOUND FX"
              desc="key-clicks, beeps, coin drops, launch rumble"
              on={sound}
              onToggle={setSound}
            />
            <ToggleRow
              label="NIGHT MODE"
              desc="black & white monochrome phosphor display"
              on={night}
              onToggle={setNight}
            />
          </div>

          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column' }}>
            <div className="stat-row">
              <span className="sk">SOL WALLET</span>
              <span className="sv">{address ? `CONNECTED · ${address.slice(0, 6)}…` : available ? 'DETECTED — NOT CONNECTED' : 'NOT INSTALLED'}</span>
            </div>
            <div className="stat-row">
              <span className="sk">SYSTEM</span>
              <span className="sv">CRT-DOS 6.86 · CRT86 SYSTEMS INC.</span>
            </div>
            <div className="stat-row">
              <span className="sk">MODULES</span>
              <span className="sv">LAUNCHPAD ✓ · SWAPS ✓ · PERPS ✓ · BRIDGE ✓ · TERMINAL ✓</span>
            </div>
          </div>

          <p className="faint" style={{ fontSize: 14, marginBottom: 0, marginTop: 12 }}>
            Settings save automatically in this browser. Connect your wallet from the bay above, then tune the experience here.
          </p>
        </Panel>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <button className="bevel-btn b-lg b-cyan" onClick={() => nav('/')}>
            ◀ BACK TO DESKTOP
          </button>
        </div>
      </div>
    </div>
  )
}
