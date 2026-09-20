/* ============================================================
   SwapProvider interface — the conceptual contract from the task:

     SwapProvider
     ├── JupiterProvider  (existing: src/lib/dex/api.ts — untouched)
     ├── UniswapProvider  (src/lib/swap/uniswap.ts)
     └── PancakeProvider  (src/lib/swap/pancakeswap.ts)

   Jupiter keeps its own Solana order/execute transport. The two EVM
   providers implement this interface over the shared transport in
   evm.ts (public client, balances, allowance, wallet send). The
   generic <EvmSwapWindow/> renders any EvmSwapProvider, so adding a
   future provider is provider-file + one chain-registry entry.
   ============================================================ */

import type { Address, Hex } from 'viem'
import type { EvmToken } from './tokens'
import type { ApiClassicQuote, ApiPermitData } from './uniswapApi'

export type SwapProviderId = 'uniswap' | 'pancakeswap'

export interface EvmQuote {
  amountOut: bigint
  amountOutHuman: number
  /** e.g. 'UNISWAP V3 · 0.30%' or 'PANCAKE V2 · BNB→USDT' */
  routeLabel: string
  /** fee tier (Uniswap, bps of 1e6) or null (Pancake V2) */
  fee: number | null
  /** resolved swap path actually quoted (for display + tx build) */
  path: Address[]
  rate: number
  fetchedAt: number
  /**
   * Uniswap Trading API context. Present only when the quote came from
   * the API (CLASSIC routing). buildTx turns classicQuote (+ an
   * EIP-712 permit signature when permitData is present) into the
   * wallet-sendable tx via POST /swap.
   */
  api?: {
    classicQuote: ApiClassicQuote['raw']
    permitData: ApiPermitData | null
    gasFeeUSD: number | null
    priceImpact: number | null
    routeString: string | null
  }
  /**
   * Attached by the window after the user signs the API's permit
   * message (gasless EIP-712). Consumed by buildTx, never fabricated.
   */
  permit?: { permitData: ApiPermitData; signature: Hex }
}

export interface EvmBuiltTx {
  to: Address
  data: Hex
  /** hex wei; undefined = no native value */
  value?: Hex
}

export type EthSignTypedData = (args: {
  account: Address
  permitData: ApiPermitData
}) => Promise<Hex>

export interface EvmSwapProvider {
  id: SwapProviderId
  /** 'UNISWAP' / 'PANCAKESWAP' — CRT display */
  label: string
  chainIds: number[]
  defaultChainId: number
  defaultSlippageBps: number
  /** spender that needs ERC20 approval (router address per chain) */
  spender(chainId: number): Address
  /**
   * Spender used when the live quote came from an API whose execution
   * contract differs from spender() (Uniswap API executes through
   * Universal Router via Permit2). Defaults to spender().
   */
  approvalSpender?(chainId: number, quote: EvmQuote): Address
  /**
   * Gasless EIP-712 permit signature for API quotes carrying
   * permitData. Throws on rejection/failure — the window then falls
   * back to a classic on-chain approval + re-quote.
   */
  signPermit?(args: { permitData: ApiPermitData; account: Address; ethRequest: <T = unknown>(method: string, params?: unknown[]) => Promise<T> }): Promise<Hex>
  quote(args: { chainId: number; tokenIn: EvmToken; tokenOut: EvmToken; amountIn: bigint; swapper?: Address; slippageBps?: number }): Promise<EvmQuote>
  buildTx(args: {
    chainId: number
    tokenIn: EvmToken
    tokenOut: EvmToken
    amountIn: bigint
    amountOutMin: bigint
    recipient: Address
    quote: EvmQuote
  }): Promise<EvmBuiltTx>
}
