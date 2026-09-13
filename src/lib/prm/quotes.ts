import { PRM, publicClient } from './chain'
import { ROUTER_ABI } from './abis'

/* ============================================================
   Quote engine — quoteStockExactIn / quoteMemeExactIn are
   "intentionally non-view": always simulateContract (eth_call),
   never broadcast, pinned to a single block.
   ============================================================ */

export type TradeMode =
  | 'eth-meme' // buyMemeWithEth
  | 'meme-eth' // sellMemeForEth
  | 'eth-stock' // buyStockWithEth
  | 'stock-eth' // sellStockForEth
  | 'stock-meme' // buyMemeWithStock
  | 'meme-stock' // sellMemeForStock

export interface QuoteArgs {
  mode: TradeMode
  meme?: string
  subjectId?: string
  amountIn: bigint
}

export interface QuoteResult {
  mode: TradeMode
  output: bigint
  inputUsed: bigint
  stockRefund: bigint
  minOut: bigint
  /** sell quotes that would partially fill are unsafe — docs require rejecting these */
  partialFillRisk: boolean
  quotedAtBlock: bigint
  expiresAt: number
  amountIn: bigint
}

const QUOTE_TTL_MS = 4 * 60 * 1000 // docs sample deadline: 5 min; we re-quote early

export function minOutOf(output: bigint, slippagePct: number): bigint {
  const bps = BigInt(Math.round((100 - slippagePct) * 100))
  return (output * bps + 9999n) / 10000n
}

export async function getQuote(args: QuoteArgs, slippagePct: number): Promise<QuoteResult> {
  const client = publicClient()
  const block = await client.getBlockNumber()
  const expiresAt = Date.now() + QUOTE_TTL_MS

  const finish = (output: bigint, inputUsed: bigint, stockRefund = 0n): QuoteResult => ({
    mode: args.mode,
    output,
    inputUsed,
    stockRefund,
    minOut: minOutOf(output, slippagePct),
    partialFillRisk: isSell(args.mode) && inputUsed !== args.amountIn,
    quotedAtBlock: block,
    expiresAt,
    amountIn: args.amountIn,
  })

  if (args.mode === 'eth-stock' || args.mode === 'stock-eth') {
    if (!args.subjectId) throw new Error('Missing subjectId')
    const r = (await client.simulateContract({
      address: PRM.router,
      abi: ROUTER_ABI,
      functionName: 'quoteStockExactIn',
      args: [args.subjectId as `0x${string}`, args.mode === 'eth-stock', args.amountIn],
      blockNumber: block,
    })).result as [bigint, bigint]
    return finish(r[0], r[1])
  }

  if (!args.meme) throw new Error('Missing meme address')
  const useEth = args.mode === 'eth-meme' || args.mode === 'meme-eth'
  const buy = args.mode === 'eth-meme' || args.mode === 'stock-meme'
  const r = (await client.simulateContract({
    address: PRM.router,
    abi: ROUTER_ABI,
    functionName: 'quoteMemeExactIn',
    args: [args.meme as `0x${string}`, buy, useEth, args.amountIn],
    blockNumber: block,
  })).result as [bigint, bigint, bigint]
  return finish(r[0], r[1], r[2])
}

export function isBuy(mode: TradeMode): boolean {
  return mode === 'eth-meme' || mode === 'eth-stock' || mode === 'stock-meme'
}
export function isSell(mode: TradeMode): boolean {
  return !isBuy(mode)
}

export function swapFunctionName(mode: TradeMode): string {
  switch (mode) {
    case 'eth-meme':
      return 'buyMemeWithEth'
    case 'meme-eth':
      return 'sellMemeForEth'
    case 'eth-stock':
      return 'buyStockWithEth'
    case 'stock-eth':
      return 'sellStockForEth'
    case 'stock-meme':
      return 'buyMemeWithStock'
    case 'meme-stock':
      return 'sellMemeForStock'
  }
}

/** human description of the route, used by the circuit-path diagram */
export function routeHops(mode: TradeMode, memeSymbol: string, stockSymbol: string): string[] {
  switch (mode) {
    case 'eth-meme':
      return ['ETH', memeSymbol]
    case 'meme-eth':
      return [memeSymbol, 'ETH']
    case 'eth-stock':
      return ['ETH', stockSymbol]
    case 'stock-eth':
      return [stockSymbol, 'ETH']
    case 'stock-meme':
      return [stockSymbol, memeSymbol]
    case 'meme-stock':
      return [memeSymbol, stockSymbol]
  }
}

export function routeViaV4(mode: TradeMode): boolean {
  // meme routes through a graduated pool hop via Uniswap v4
  return mode === 'meme-eth' || mode === 'eth-meme'
}
