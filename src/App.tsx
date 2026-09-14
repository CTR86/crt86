import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CrtShell } from './design/CrtShell'
import { OsBoot } from './os/OsBoot'
import { Desktop } from './os/Desktop'
import { ModuleLoader } from './os/ModuleLoader'
import { ComingSoon } from './os/ComingSoon'
import { BridgeWindow } from './os/BridgeWindow'
import { FaqWindow } from './os/FaqWindow'
import { TerminalWindow } from './os/TerminalWindow'
import { SettingsWindow } from './os/SettingsWindow'
import { RoadmapWindow } from './os/RoadmapWindow'
import { XWindow } from './os/XWindow'
import { GitHubWindow } from './os/GitHubWindow'
import { StockWindow } from './os/StockWindow'
import { MoneyWindow } from './os/MoneyWindow'
import { DexWindow } from './os/DexWindow'
import { SnakeWindow } from './os/SnakeWindow'
import { ErrorBoundary } from './design/ErrorBoundary'
import { MobileNotice } from './design/MobileNotice'
import { WalletHelpDialog } from './design/WalletHelpDialog'
import { Header } from './components/Header'
import { StatusBar } from './components/StatusBar'
import { TickerTape } from './components/TickerTape'
import { useSettings } from './store/settings'
import { SolanaWalletProvider } from './wallets/SolanaWallet'
import { EvmWalletProvider } from './wallets/EvmWallet'
import { play, unlockAudio } from './sound/sfx'
import { RH_ENABLED } from './config'
import { Hub } from './pages/Hub'
import { LaunchDeck } from './pages/LaunchDeck'
import { TradeTerminal } from './pages/TradeTerminal'
import { FeeVault } from './pages/FeeVault'
import { Portfolio } from './pages/Portfolio'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5_000, refetchOnWindowFocus: false },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SolanaWalletProvider>
        <EvmWalletProvider>
          <HashRouter>
            <NeonOs />
          </HashRouter>
        </EvmWalletProvider>
      </SolanaWalletProvider>
    </QueryClientProvider>
  )
}

/* ↑↑↓↓←→←→BA */
function useKonami(onUnlock: () => void) {
  useEffect(() => {
    const seq = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']
    let i = 0
    const h = (e: KeyboardEvent) => {
      i = e.key === seq[i] ? i + 1 : e.key === seq[0] ? 1 : 0
      if (i === seq.length) {
        i = 0
        onUnlock()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onUnlock])
}

/* wrapper around launchpad pages — shows the module loader when opened from the desktop */
function LaunchpadModule({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(() => !!sessionStorage.getItem('neondos-module'))
  const label = useRef(sessionStorage.getItem('neondos-module') ?? 'LAUNCHPAD.EXE')

  useEffect(() => {
    if (!loading) return
    const t = setTimeout(() => {
      setLoading(false)
      sessionStorage.removeItem('neondos-module')
    }, 1700)
    return () => clearTimeout(t)
  }, [loading])

  if (loading) return <ModuleLoader label={label.current} />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Desktop />} />
        <Route path="/launchpad" element={<LaunchpadModule><Hub /></LaunchpadModule>} />
        <Route path="/launchpad/launch" element={<LaunchpadModule><LaunchDeck /></LaunchpadModule>} />
        <Route path="/launchpad/markets" element={<Navigate to="/terminal" replace />} />
        <Route path="/launchpad/vault" element={<LaunchpadModule><FeeVault /></LaunchpadModule>} />
        <Route path="/launchpad/portfolio" element={<LaunchpadModule><Portfolio /></LaunchpadModule>} />
        <Route path="/faq" element={<LaunchpadModule><FaqWindow /></LaunchpadModule>} />
        <Route path="/roadmap" element={<LaunchpadModule><RoadmapWindow /></LaunchpadModule>} />
        <Route path="/x" element={<LaunchpadModule><XWindow /></LaunchpadModule>} />
        <Route path="/github" element={<LaunchpadModule><GitHubWindow /></LaunchpadModule>} />
        <Route path="/stock" element={<LaunchpadModule><StockWindow /></LaunchpadModule>} />
        <Route path="/money" element={<LaunchpadModule><MoneyWindow /></LaunchpadModule>} />
        <Route path="/snake" element={<LaunchpadModule><SnakeWindow /></LaunchpadModule>} />
        <Route path="/perp" element={<ComingSoon exe="PERP.EXE" icon="📈" title="PERPETUALS" desc="Jupiter Perps inside the CRT — long/short SOL, ETH, WBTC with leverage. Keeper-fulfilled, oracle-priced. Engine parked until launch." />} />
        <Route path="/gacha" element={<ComingSoon exe="GACHA.EXE" icon="🎰" title="GACHA TERMINAL" desc="On-chain gacha pulls — capsules, odds, reveals and rarity flex. Feed the machine, chase the holographic." />} />
        <Route path="/settings" element={<LaunchpadModule><SettingsWindow /></LaunchpadModule>} />
        <Route path="/launchpad/trade" element={RH_ENABLED ? <LaunchpadModule><TradeTerminal /></LaunchpadModule> : <Navigate to="/launchpad" replace />} />
        <Route path="/dex" element={<LaunchpadModule><DexWindow /></LaunchpadModule>} />
        <Route path="/bridge" element={<LaunchpadModule><BridgeWindow /></LaunchpadModule>} />
        <Route path="/terminal" element={<LaunchpadModule><TerminalWindow /></LaunchpadModule>} />
        <Route path="/launch" element={<Navigate to="/launchpad/launch" replace />} />
        <Route path="/markets" element={<Navigate to="/terminal" replace />} />
        <Route path="/vault" element={<Navigate to="/launchpad/vault" replace />} />
        <Route path="/portfolio" element={<Navigate to="/launchpad/portfolio" replace />} />
        <Route path="/trade" element={<Navigate to={RH_ENABLED ? '/launchpad/trade' : '/'} replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  )
}

function NeonOs() {
  const { effects, night } = useSettings()
  const { pathname } = useLocation()
  const [showBoot, setShowBoot] = useState(() => !sessionStorage.getItem('neondos-booted'))
  const [hyper, setHyper] = useState(false)

  useKonami(() => {
    setHyper(true)
    play('coin')
    setTimeout(() => setHyper(false), 15_000)
  })

  useEffect(() => {
    document.body.classList.toggle('fx-off', !effects)
    document.body.classList.toggle('night', night)
    document.title = RH_ENABLED ? 'CRT86 — Dual-Chain Terminal' : 'CRT86 — Solana Launch System'
  }, [effects, night])

  /* retro key-click on EVERY press — anywhere on the terminal.
     pointerdown also unlocks the AudioContext on the first gesture. */
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      unlockAudio()
      play('click')
    }
    document.addEventListener('pointerdown', down)
    const vis = () => unlockAudio()
    document.addEventListener('visibilitychange', vis)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])

  const finishBoot = () => {
    sessionStorage.setItem('neondos-booted', '1')
    setShowBoot(false)
    play('boot')
  }

  const isLaunchpad = pathname.startsWith('/launchpad')

  return (
    <CrtShell
      hyper={hyper}
      top={isLaunchpad ? <><Header /><TickerTape /></> : undefined}
      bottom={<StatusBar />}
    >
      {showBoot && <OsBoot onComplete={finishBoot} />}
      <MobileNotice />
      <WalletHelpDialog />
      <AppRoutes />
    </CrtShell>
  )
}
