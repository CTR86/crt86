import { EvmSwapWindow } from './EvmSwapWindow'
import { UniswapProvider } from '../lib/swap/uniswap'

/* UNISWAP.EXE — Uniswap V3 swaps inside the CRT. UI + flow shared
   with PANCAKE.EXE via EvmSwapWindow; provider logic in
   src/lib/swap/uniswap.ts. */
export function UniswapWindow() {
  return <EvmSwapWindow exe="UNISWAP.EXE" provider={UniswapProvider} />
}
