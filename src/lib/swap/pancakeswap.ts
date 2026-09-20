/* ============================================================
   PancakeProvider — PancakeSwap V2 swaps via on-chain contracts.
   No API key: quotes come from the canonical V2 router's
   getAmountsOut (static eth_call) and swaps go through the same
   router. Router addresses are per-chain VERIFIED (see
   src/lib/swap/chains.ts — Pancake docs v2 addresses page).

   Flow per swap:
     1. Quote direct [in → out]; if the pair has no liquidity,
        retry routed via wrapped native [in → WBNB → out].
     2. swapExactETHForTokens (native in) /
        swapExactTokensForETH (native out) /
        swapExactTokensForTokens (ERC20 → ERC20), with
        deadline = now + 20 min and amountOutMin from slippage.
     3. ERC20 inputs need approve(router) first (handled by the
        window via spender()).
   Primary target is BNB Chain; ETH/Base/Arbitrum routers are
   verified and enabled through configuration (no UI rewrite).
   ============================================================ */

import { encodeFunctionData, type Address } from 'viem'
import { evmChain, PANCAKE_CHAIN_IDS } from './chains'
import { isNative } from './tokens'
import type { EvmToken } from './tokens'
import { publicClient, PANCAKE_V2_ROUTER_ABI } from './evm'
import { baseToHuman } from './amount'
import type { EvmBuiltTx, EvmQuote, EvmSwapProvider } from './types'

export const PANCAKE_TX_DEADLINE_SECS = 20 * 60

function routerOf(chainId: number): Address {
  const r = evmChain(chainId).pancakeV2Router
  if (!r) throw new Error('PancakeSwap is not enabled on this chain — pick BNB Chain.')
  return r
}

/** Path candidates: direct first, then routed via wrapped native. */
export function pancakePathCandidates(chainId: number, tokenIn: EvmToken, tokenOut: EvmToken): Address[][] {
  const w = evmChain(chainId).wrappedNative
  const a: Address = isNative(tokenIn) ? w : tokenIn.address
  const b: Address = isNative(tokenOut) ? w : tokenOut.address
  const direct: Address[] = [a, b]
  if (a.toLowerCase() === w.toLowerCase() || b.toLowerCase() === w.toLowerCase()) return [direct]
  return [direct, [a, w, b]]
}

async function amountsOut(chainId: number, amountIn: bigint, path: Address[]): Promise<bigint | null> {
  try {
    const pc = publicClient(chainId)
    const res = (await pc.readContract({
      address: routerOf(chainId),
      abi: PANCAKE_V2_ROUTER_ABI,
      functionName: 'getAmountsOut',
      args: [amountIn, path],
    })) as bigint[]
    if (!Array.isArray(res) || res.length !== path.length) return null
    const out = res[res.length - 1] as bigint
    return out > 0n ? out : null
  } catch {
    return null
  }
}

export async function quotePancakeV2(args: {
  chainId: number
  tokenIn: EvmToken
  tokenOut: EvmToken
  amountIn: bigint
}): Promise<EvmQuote> {
  routerOf(args.chainId)
  const inAddr: Address = isNative(args.tokenIn) ? evmChain(args.chainId).wrappedNative : args.tokenIn.address
  const outAddr: Address = isNative(args.tokenOut) ? evmChain(args.chainId).wrappedNative : args.tokenOut.address
  if (inAddr.toLowerCase() === outAddr.toLowerCase()) {
    throw new Error('Input and output tokens must differ — pick another token.')
  }
  for (const path of pancakePathCandidates(args.chainId, args.tokenIn, args.tokenOut)) {
    const out = await amountsOut(args.chainId, args.amountIn, path)
    if (out != null) {
      const inHuman = baseToHuman(args.amountIn, args.tokenIn.decimals)
      const outHuman = baseToHuman(out, args.tokenOut.decimals)
      const via = path.length === 3 ? ` · VIA ${evmChain(args.chainId).symbol}` : ''
      return {
        amountOut: out,
        amountOutHuman: outHuman,
        routeLabel: `PANCAKE V2${via}`,
        fee: null,
        path,
        rate: inHuman > 0 ? outHuman / inHuman : 0,
        fetchedAt: Date.now(),
      }
    }
  }
  throw new Error('No PancakeSwap liquidity for this pair — try another pair or UNISWAP.EXE.')
}

export async function buildPancakeV2Tx(args: {
  chainId: number
  tokenIn: EvmToken
  tokenOut: EvmToken
  amountIn: bigint
  amountOutMin: bigint
  recipient: Address
  quote: EvmQuote
}): Promise<EvmBuiltTx> {
  const router = routerOf(args.chainId)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + PANCAKE_TX_DEADLINE_SECS)
  const path = args.quote.path
  const inNative = isNative(args.tokenIn)
  const outNative = isNative(args.tokenOut)

  if (inNative && !outNative) {
    return {
      to: router,
      data: encodeFunctionData({
        abi: PANCAKE_V2_ROUTER_ABI,
        functionName: 'swapExactETHForTokens',
        args: [args.amountOutMin, path, args.recipient, deadline],
      }),
      value: `0x${args.amountIn.toString(16)}` as `0x${string}`,
    }
  }
  if (!inNative && outNative) {
    return {
      to: router,
      data: encodeFunctionData({
        abi: PANCAKE_V2_ROUTER_ABI,
        functionName: 'swapExactTokensForETH',
        args: [args.amountIn, args.amountOutMin, path, args.recipient, deadline],
      }),
    }
  }
  return {
    to: router,
    data: encodeFunctionData({
      abi: PANCAKE_V2_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [args.amountIn, args.amountOutMin, path, args.recipient, deadline],
    }),
  }
}

export const PancakeProvider: EvmSwapProvider = {
  id: 'pancakeswap',
  label: 'PANCAKESWAP',
  chainIds: PANCAKE_CHAIN_IDS,
  defaultChainId: 56,
  defaultSlippageBps: 50,
  spender: routerOf,
  quote: quotePancakeV2,
  buildTx: buildPancakeV2Tx,
}
