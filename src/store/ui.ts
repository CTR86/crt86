import { create } from 'zustand'

/** wallet-install guidance dialog (shown when no extension is detected) */
interface UiState {
  walletHelp: 'sol' | 'evm' | null
  openWalletHelp: (k: 'sol' | 'evm') => void
  closeWalletHelp: () => void
}

export const useUi = create<UiState>((set) => ({
  walletHelp: null,
  openWalletHelp: (k) => set({ walletHelp: k }),
  closeWalletHelp: () => set({ walletHelp: null }),
}))
