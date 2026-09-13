import { create } from 'zustand'

/** cross-page handoff: "LOAD TO TERMINAL" from MARKETS → TRADE TERMINAL */
export interface LoadedAsset {
  kind: 'meme' | 'stock'
  token: string
  subjectId?: string
  symbol: string
}

interface TerminalState {
  loaded: LoadedAsset | null
  /** handoff: open this Solana mint's detail drawer when MARKETS mounts */
  openMint: string | null
  load: (a: LoadedAsset) => void
  consume: () => LoadedAsset | null
  openCoin: (mint: string) => void
  consumeOpenMint: () => string | null
}

export const useTerminal = create<TerminalState>((set, get) => ({
  loaded: null,
  openMint: null,
  load: (a) => set({ loaded: a }),
  consume: () => {
    const l = get().loaded
    if (l) set({ loaded: null })
    return l
  },
  openCoin: (mint) => set({ openMint: mint }),
  consumeOpenMint: () => {
    const m = get().openMint
    if (m) set({ openMint: null })
    return m
  },
}))
