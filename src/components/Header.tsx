import { NavLink, useNavigate } from 'react-router-dom'
import { useSolanaWallet } from '../wallets/SolanaWallet'
import { useEvmWallet } from '../wallets/EvmWallet'
import { useUi } from '../store/ui'
import { play } from '../sound/sfx'
import { shortAddr } from '../lib/format'
import { LedDot } from '../design/ui'
import { RH_ENABLED } from '../config'

const NAV = [
  { to: '/launchpad', label: 'HUB' },
  { to: '/launchpad/launch', label: 'LAUNCH DECK' },
  ...(RH_ENABLED ? [{ to: '/launchpad/trade', label: 'TRADE TERMINAL' }] : []),
  { to: '/launchpad/vault', label: 'FEE VAULT' },
  { to: '/launchpad/portfolio', label: 'PORTFOLIO' },
]

function SolanaBay() {
  const { address, walletName, available, connecting, connect, disconnect } = useSolanaWallet()
  const openWalletHelp = useUi((s) => s.openWalletHelp)
  if (address)
    return (
      <button className="bevel-btn b-sm" onClick={() => void disconnect()} title="disconnect">
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <LedDot color="green" /> {walletName}:{shortAddr(address)}
        </span>
      </button>
    )
  if (!available)
    return (
      <button className="bevel-btn b-sm b-amber" onClick={() => openWalletHelp('sol')} title="how to install a Solana wallet">
        INSTALL SOL WALLET
      </button>
    )
  return (
    <button className="bevel-btn b-sm b-cyan" disabled={connecting} onClick={() => void connect().catch(() => play('error'))}>
      {connecting ? 'LINKING…' : RH_ENABLED ? 'TAPE A: SOL' : 'CONNECT SOLANA'}
    </button>
  )
}

function EvmBay() {
  const { address, chainId, available, connecting, connect, disconnect, ensureChain } = useEvmWallet()
  const openWalletHelp = useUi((s) => s.openWalletHelp)
  if (address && chainId === 4663)
    return (
      <button className="bevel-btn b-sm" onClick={disconnect} title="disconnect">
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <LedDot color="pink" /> EVM:{shortAddr(address)}
        </span>
      </button>
    )
  if (address)
    return (
      <button className="bevel-btn b-sm b-amber" onClick={() => void ensureChain()} title="switch to Robinhood Chain">
        ⚠ CHAIN {chainId} — LOAD RH-CHAIN
      </button>
    )
  if (!available)
    return (
      <button className="bevel-btn b-sm b-amber" onClick={() => openWalletHelp('evm')} title="how to install an EVM wallet">
        INSTALL EVM WALLET
      </button>
    )
  return (
    <button className="bevel-btn b-sm b-pink" disabled={connecting} onClick={() => void connect().catch(() => play('error'))}>
      {connecting ? 'LINKING…' : RH_ENABLED ? 'TAPE B: EVM' : 'CONNECT EVM'}
    </button>
  )
}

export function Header() {
  const nav = useNavigate()
  return (
    <header className="app-header">
      <button className="bevel-btn b-sm b-cyan" onClick={() => { nav('/'); play('open') }} title="back to the CRT-DOS desktop">
        ◀ DESKTOP
      </button>
      <div className="logo-block">
        <span className="chrome-logo logo-main">CRT86</span>
        <span className="logo-sub">{RH_ENABLED ? 'DUAL-CHAIN TRADING TERMINAL' : 'SOLANA LAUNCH TERMINAL'}</span>
      </div>
      <nav className="nav-tabs">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => 'nav-tab' + (isActive ? ' active' : '')} onClick={() => play('click')}>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="bay-row">
        <SolanaBay />
        {RH_ENABLED && <EvmBay />}
        <button className="bevel-btn b-sm" onClick={() => { nav('/settings'); play('open') }} title="CRT, SFX, night mode — CRT-DOS control panel">
          ⚙️ SETTINGS
        </button>
      </div>
    </header>
  )
}
