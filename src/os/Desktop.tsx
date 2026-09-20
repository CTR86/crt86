import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { play } from '../sound/sfx'
import { OFFICIAL_CA } from '../config'
import { shortAddr } from '../lib/format'
import { useSolanaWallet } from '../wallets/SolanaWallet'

interface OsFile {
  exe: string
  icon: string
  route: string
  ready: boolean
  desc: string
}

const FILES: OsFile[] = [
  { exe: 'LAUNCHPAD.EXE', icon: '🚀', route: '/launchpad', ready: true, desc: 'Multi-engine coin launcher' },
  { exe: 'MONEY.EXE', icon: '💰', route: '/money', ready: true, desc: 'Official coin — contract address' },
  { exe: 'STOCK.EXE', icon: '📊', route: '/stock', ready: true, desc: 'Backpack tokenized stocks — tape' },
  { exe: 'PERP.EXE', icon: '📈', route: '/perp', ready: true, desc: 'Perps — Hyperliquid + Aster, long/short with leverage' },
  { exe: 'PREDICT.EXE', icon: '🔮', route: '/predict', ready: true, desc: 'Prediction markets — Polymarket + Kalshi' },
  { exe: 'JUP.EXE', icon: '💱', route: '/jup', ready: true, desc: 'Jupiter-powered Solana swaps' },
  { exe: 'UNISWAP.EXE', icon: '🦄', route: '/uniswap', ready: true, desc: 'Uniswap API swaps · BNB, ETH, Base + more' },
  { exe: 'PANCAKE.EXE', icon: '🥞', route: '/pancake', ready: true, desc: 'PancakeSwap swaps · BNB Chain first' },
  { exe: 'LEND.EXE', icon: '🏦', route: '/lend', ready: true, desc: 'Jupiter Lend — earn yield + borrow' },
  { exe: 'BRIDGE.EXE', icon: '🌉', route: '/bridge', ready: true, desc: 'Cross-chain bridge · Relay' },
  { exe: 'TERMINAL.EXE', icon: '📟', route: '/terminal', ready: true, desc: 'Market wire — glaze the movers' },
  { exe: 'FAQ.TXT', icon: '📄', route: '/faq', ready: true, desc: 'Read the manual' },
  { exe: 'ROADMAP.EXE', icon: '🗺️', route: '/roadmap', ready: true, desc: 'What ships next' },
  { exe: 'X.EXE', icon: '𝕏', route: '/x', ready: true, desc: '@crt86vibe' },
  { exe: 'GITHUB.EXE', icon: '🐙', route: '/github', ready: true, desc: 'CTR86/crt86 — source' },
  { exe: 'SNAKE.EXE', icon: '🐍', route: '/snake', ready: true, desc: 'Wire worm — eat bytes, beat your best' },
  { exe: 'SHOOT.EXE', icon: '🛸', route: '/shoot', ready: true, desc: 'Star ranger — blast the swarm, beat your best' },
  { exe: 'SETTINGS.EXE', icon: '⚙️', route: '/settings', ready: true, desc: 'CRT · SFX · night mode' },
]

function clockString(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour12: false })
}

/* CRT-DOS 6.86 desktop — file icons; double-click on desktop, single tap on mobile */
export function Desktop() {
  const nav = useNavigate()
  const { address, available, walletName } = useSolanaWallet()
  const [selected, setSelected] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 820px)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)')
    const h = () => setIsMobile(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])

  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(iv)
  }, [])

  const open = (f: OsFile) => {
    play('open')
    sessionStorage.setItem('neondos-module', f.exe)
    nav(f.route)
  }

  const handleTap = (f: OsFile) => {
    if (isMobile) {
      open(f)
    } else {
      setSelected(f.exe)
    }
  }

  const cleanLabel = (exe: string) => exe.replace(/\.(EXE|TXT)$/, '')
  const sel = FILES.find((f) => f.exe === selected)

  return (
    <div
      className="desktop-wrap"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('desktop-icons')) setSelected(null)
      }}
    >
      <div className="desktop-watermark">CRT-DOS 6.86</div>

      <div className="desktop-icons">
        {FILES.map((f) => {
          const label = isMobile ? cleanLabel(f.exe) : f.exe
          return (
            <div
              key={f.exe}
              className={cnIcon(selected === f.exe)}
              onClick={() => handleTap(f)}
              onDoubleClick={() => !isMobile && open(f)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') open(f)
              }}
              tabIndex={0}
              role="button"
              aria-label={`${cleanLabel(f.exe)} — ${f.desc}`}
              title={`${f.desc}${f.ready ? '' : ' (coming soon)'} · ${isMobile ? 'tap to open' : 'double-click to open'}`}
            >
              <span className="os-icon-frame">
                {f.icon}
                {!f.ready && <span className="os-icon-soon">SOON</span>}
              </span>
              <span className="os-icon-label">{label}</span>
            </div>
          )
        })}
      </div>

      <div style={{ flex: 1 }} />

      <div className="os-taskbar">
        <span className="tb-badge">⚡ CRT86</span>
        <span className="tb-item dim">
          {sel ? `SELECTED: ${isMobile ? cleanLabel(sel.exe) : sel.exe} — ${sel.desc}` : isMobile ? 'TAP A FILE TO OPEN' : 'DOUBLE-CLICK A FILE TO OPEN'}
        </span>
        <span className="tb-item" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            className="led"
            style={address ? {} : { background: available ? 'var(--amber)' : '#2c1f45', boxShadow: available ? 'var(--glow-amber)' : 'none', animation: 'none' }}
            title={address ? 'Solana wallet connected' : available ? 'Wallet detected — connect it' : 'No wallet installed'}
          />
          {address ? `${walletName ?? 'WALLET'} ${address.slice(0, 4)}…` : available ? 'WALLET: NOT CONNECTED' : 'NO WALLET'}
        </span>
        {OFFICIAL_CA.trim() !== '' && (
          <span
            className="tb-item"
            role="button"
            tabIndex={0}
            title={'Official CA — click to copy:\n' + OFFICIAL_CA}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--amber)' }}
            onClick={() => {
              play('click')
              void navigator.clipboard?.writeText(OFFICIAL_CA).then(
                () => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                },
                () => setCopied(false),
              )
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLElement).click()
            }}
          >
            💰 CA {copied ? '✓ COPIED' : shortAddr(OFFICIAL_CA, 4)}
          </span>
        )}
        <span className="tb-clock">{clockString(clock)}</span>
      </div>
    </div>
  )

  function cnIcon(sel: boolean) {
    return 'os-icon' + (sel ? ' sel' : '')
  }
}
