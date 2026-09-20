import { EvmSwapWindow } from './EvmSwapWindow'
import { PancakeProvider } from '../lib/swap/pancakeswap'

/* PANCAKE.EXE — PancakeSwap swaps inside the CRT. UI + flow shared
   with UNISWAP.EXE via EvmSwapWindow; provider logic in
   src/lib/swap/pancakeswap.ts. */
export function PancakeWindow() {
  return <EvmSwapWindow exe="PANCAKE.EXE" provider={PancakeProvider} />
}
