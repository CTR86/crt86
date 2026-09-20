/* ============================================================
   UniswapProvider — Uniswap swaps, API-first with on-chain fallback.
   1. Trading API (server key via /api/uniswap proxy): best-price
      CLASSIC routing across V2/V3/V4, simulated, with gasless
      Permit2 signatures when an approval is needed. No key material
      ever touches the browser bundle.
   2. On-chain fallback (no key / API down / non-CLASSIC routing):
      canonical QuoterV2 + SwapRouter02 over public RPC.
   Router addresses are per-chain VERIFIED (see
   src/lib/swap/chains.ts) — chains without a verified deployment
   are rejected, never guessed.
   ============================================================ */

import { encodeFunctionData, type Address, type Hex } from 'viem'
import { evmChain, UNISWAP_CHAIN_IDS } from './chains'
import { isNative, NATIVE_SENTINEL } from './tokens'
import type { EvmToken } from './tokens'
import { publicClient, QUOTER_V2_ABI, SWAP_ROUTER_02_ABI } from './evm'
import { baseToHuman } from './amount'
import {
  fetchApiQuote,
  fetchApiSwap,
  uniswapApiConfigured,
  type ApiPermitData,
} from './uniswapApi'
import type { EvmBuiltTx, EvmQuote, EvmSwapProvider } from './types'

/** Permit2 — Universal Router pulls ERC20s through it. Same on every chain. */
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address

/** Standard V3 fee tiers probed in order — missing pools revert and are skipped. */
export const UNISWAP_FEE_TIERS = [500, 3000, 10_000]

function feeLabel(fee: number): string {
  return `${(fee / 10_000).toFixed(fee === 500 ? 2 : fee === 3000 ? 1 : 0)}%`
}

/** V3 pools hold wrapped native only — map the sentinel before quoting. */
function toPoolToken(chainId: number, t: EvmToken): Address {
  return isNative(t) ? evmChain(chainId).wrappedNative : t.address
}

async function quoteSingleTier(args: {
  chainId: number
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  fee: number
}): Promise<bigint | null> {
  try {
    const pc = publicClient(args.chainId)
    const dep = evmChain(args.chainId).uniswapV3
    if (!dep) return null
    const res = (await pc.readContract({
      address: dep.quoterV2,
      abi: QUOTER_V2_ABI,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          tokenIn: args.tokenIn,
          tokenOut: args.tokenOut,
          amountIn: args.amountIn,
          fee: args.fee,
          sqrtPriceLimitX96: 0n,
        },
      ],
    })) as unknown as [bigint, bigint, number, bigint]
    const out = Array.isArray(res) ? (res[0] as bigint) : 0n
    return out > 0n ? out : null
  } catch {
    return null
  }
}

export async function quoteUniswapV3(args: {
  chainId: number
  tokenIn: EvmToken
  tokenOut: EvmToken
  amountIn: bigint
  swapper?: Address
  slippageBps?: number
}): Promise<EvmQuote> {
  // 1) Trading API first (best price across V2/V3/V4, simulated).
  if (args.swapper) {
    try {
      if (await uniswapApiConfigured()) {
        return await quoteViaApi({
          chainId: args.chainId,
          tokenIn: args.tokenIn,
          tokenOut: args.tokenOut,
          amountIn: args.amountIn,
          swapper: args.swapper,
          slippageBps: args.slippageBps ?? 50,
        })
      }
    } catch {
      /* fall through to on-chain — a different network route often works */
    }
  }
  // 2) On-chain fallback: canonical QuoterV2 over public RPC.
  return quoteOnchain({ chainId: args.chainId, tokenIn: args.tokenIn, tokenOut: args.tokenOut, amountIn: args.amountIn })
}

function apiTokenAddr(t: EvmToken): Address {
  // The Trading API takes the zero address for native currency.
  return isNative(t) ? NATIVE_SENTINEL : t.address
}

async function quoteViaApi(args: {
  chainId: number
  tokenIn: EvmToken
  tokenOut: EvmToken
  amountIn: bigint
  swapper: Address
  slippageBps: number
}): Promise<EvmQuote> {
  const res = await fetchApiQuote({
    chainId: args.chainId,
    tokenIn: apiTokenAddr(args.tokenIn),
    tokenOut: apiTokenAddr(args.tokenOut),
    amountIn: args.amountIn,
    swapper: args.swapper,
    slippageBps: args.slippageBps,
  })
  const c = res.classic
  if (!c) throw new Error('Uniswap API returned no executable quote — retry for on-chain fallback.')
  const outHuman = baseToHuman(c.amountOut, args.tokenOut.decimals)
  const inHuman = baseToHuman(args.amountIn, args.tokenIn.decimals)
  return {
    amountOut: c.amountOut,
    amountOutHuman: outHuman,
    routeLabel: `UNISWAP API · ${c.routeString ? c.routeString.slice(0, 48) : 'BEST PRICE'}`,
    fee: null,
    path: [apiTokenAddr(args.tokenIn), apiTokenAddr(args.tokenOut)],
    rate: inHuman > 0 ? outHuman / inHuman : 0,
    fetchedAt: Date.now(),
    api: {
      classicQuote: c.raw,
      permitData: res.permitData,
      gasFeeUSD: c.gasFeeUSD,
      priceImpact: c.priceImpact,
      routeString: c.routeString,
    },
  }
}

async function quoteOnchain(args: {
  chainId: number
  tokenIn: EvmToken
  tokenOut: EvmToken
  amountIn: bigint
}): Promise<EvmQuote> {
  if (!evmChain(args.chainId).uniswapV3) {
    throw new Error('No on-chain Uniswap fallback on this chain (API unreachable) — retry or pick BNB Chain / Ethereum / Polygon.')
  }
  const tokenIn = toPoolToken(args.chainId, args.tokenIn)
  const tokenOut = toPoolToken(args.chainId, args.tokenOut)
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    throw new Error('Input and output tokens must differ — pick another token.')
  }
  const results = await Promise.all(
    UNISWAP_FEE_TIERS.map(async (fee) => ({
      fee,
      out: await quoteSingleTier({ chainId: args.chainId, tokenIn, tokenOut, amountIn: args.amountIn, fee }),
    })),
  )
  let best: { fee: number; out: bigint } | null = null
  for (const r of results) {
    if (r.out != null && (best == null || r.out > best.out)) best = { fee: r.fee, out: r.out }
  }
  if (!best) {
    throw new Error('No Uniswap V3 pool for this pair — try another pair or PANCAKE.EXE.')
  }
  const inHuman = baseToHuman(args.amountIn, args.tokenIn.decimals)
  const outHuman = baseToHuman(best.out, args.tokenOut.decimals)
  return {
    amountOut: best.out,
    amountOutHuman: outHuman,
    routeLabel: `UNISWAP V3 · ${feeLabel(best.fee)}`,
    fee: best.fee,
    path: [tokenIn, tokenOut],
    rate: inHuman > 0 ? outHuman / inHuman : 0,
    fetchedAt: Date.now(),
  }
}

export async function buildUniswapTx(args: {
  chainId: number
  tokenIn: EvmToken
  tokenOut: EvmToken
  amountIn: bigint
  amountOutMin: bigint
  recipient: Address
  quote: EvmQuote
}): Promise<EvmBuiltTx> {
  // API quote → POST /swap for simulated calldata (permit signature attached by the window).
  if (args.quote.api) {
    const swap = await fetchApiSwap({
      classicQuote: args.quote.api.classicQuote,
      permitData: args.quote.permit?.permitData ?? null,
      signature: args.quote.permit?.signature ?? null,
      deadline: Math.floor(Date.now() / 1000) + 1_200,
    })
    return { to: swap.to, data: swap.data, ...(swap.value != null ? { value: swap.value } : {}) }
  }
  return buildUniswapV3Tx(args)
}

export function buildUniswapV3Tx(args: {
  chainId: number
  tokenIn: EvmToken
  tokenOut: EvmToken
  amountIn: bigint
  amountOutMin: bigint
  recipient: Address
  quote: EvmQuote
}): EvmBuiltTx {
  const dep = evmChain(args.chainId).uniswapV3
  if (!dep) throw new Error('Uniswap V3 is not enabled on this chain.')
  const fee = args.quote.fee ?? 3000
  const tokenIn = toPoolToken(args.chainId, args.tokenIn)
  const tokenOut = toPoolToken(args.chainId, args.tokenOut)
  const inNative = isNative(args.tokenIn)
  const outNative = isNative(args.tokenOut)

  const single = encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn,
        tokenOut,
        fee,
        recipient: outNative ? dep.swapRouter02 : args.recipient,
        amountIn: args.amountIn,
        amountOutMinimum: args.amountOutMin,
        sqrtPriceLimitX96: 0n,
      },
    ],
  })
  const calls: `0x${string}`[] = [single]
  if (outNative) {
    calls.push(
      encodeFunctionData({
        abi: SWAP_ROUTER_02_ABI,
        functionName: 'unwrapWETH9',
        args: [args.amountOutMin, args.recipient],
      }),
    )
  }
  if (inNative) {
    calls.push(encodeFunctionData({ abi: SWAP_ROUTER_02_ABI, functionName: 'refundETH', args: [] }))
  }
  const data =
    calls.length === 1
      ? single
      : encodeFunctionData({ abi: SWAP_ROUTER_02_ABI, functionName: 'multicall', args: [calls] })
  return {
    to: dep.swapRouter02,
    data,
    ...(inNative ? { value: `0x${args.amountIn.toString(16)}` as `0x${string}` } : {}),
  }
}

/** Gasless EIP-712 Permit2 signature for API quotes carrying permitData. */
export async function signUniswapPermit(args: {
  permitData: ApiPermitData
  account: Address
  ethRequest: <T = unknown>(method: string, params?: unknown[]) => Promise<T>
}): Promise<Hex> {
  const typedData = {
    domain: args.permitData.domain,
    types: args.permitData.types,
    primaryType: 'PermitSingle',
    message: args.permitData.values,
  }
  const sig = await args.ethRequest<string>('eth_signTypedData_v4', [args.account, JSON.stringify(typedData)])
  if (!sig || typeof sig !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(sig)) {
    throw new Error('Wallet did not return a valid permit signature.')
  }
  return sig as Hex
}

export const UniswapProvider: EvmSwapProvider = {
  id: 'uniswap',
  label: 'UNISWAP',
  chainIds: UNISWAP_CHAIN_IDS,
  defaultChainId: 56,
  defaultSlippageBps: 50,
  spender(chainId: number): Address {
    const dep = evmChain(chainId).uniswapV3
    if (!dep) throw new Error('Uniswap V3 is not enabled on this chain.')
    return dep.swapRouter02
  },
  approvalSpender(): Address {
    // API quotes execute through Universal Router via Permit2.
    return PERMIT2_ADDRESS
  },
  signPermit: signUniswapPermit,
  quote: quoteUniswapV3,
  buildTx: buildUniswapTx,
}
