import { readContract } from 'viem/actions'
import { PRM, PHASE, publicClient } from './chain'
import { ERC20_ABI, MEME_CURVE_ABI, MEME_FACTORY_ABI, SUBJECT_FACTORY_ABI } from './abis'
import { timeAgo } from '../format'

export interface MemeListing {
  token: string
  curve: string
  creator: string
  subjectId: string
  createdAt: bigint
  name: string
  symbol: string
  decimals: number
  phase: number
  /** rough ETH price estimate from the curve quote (stale once graduated to v4) */
  priceEth: number | null
}

export interface StockListing {
  subjectId: string
  deskToken: string
  curve: string
  openedAt: bigint
  openingPriceWethX18: bigint
  name: string
  symbol: string
  decimals: number
  priceEth: number | null
}

const client = publicClient()

async function erc20Meta(address: string): Promise<{ name: string; symbol: string; decimals: number }> {
  try {
    const [name, symbol, decimals] = await Promise.all([
      readContract(client, { address: address as `0x${string}`, abi: ERC20_ABI, functionName: 'name' }),
      readContract(client, { address: address as `0x${string}`, abi: ERC20_ABI, functionName: 'symbol' }),
      readContract(client, { address: address as `0x${string}`, abi: ERC20_ABI, functionName: 'decimals' }),
    ])
    return { name: String(name), symbol: String(symbol), decimals: Number(decimals) }
  } catch {
    return { name: 'UNKNOWN', symbol: '???', decimals: 18 }
  }
}

/** ETH price of one whole token, from a raw 0.1-ETH quote scaled by decimals */
function priceFromRawOut(rawOut: bigint | null, decimals: number): number | null {
  if (rawOut == null) return null
  const out = Number(rawOut)
  if (!isFinite(out) || out <= 0) return null
  return (0.1 * 10 ** decimals) / out
}

async function memeRawQuoteFor01Eth(curve: string): Promise<bigint | null> {
  try {
    const [memeOut] = (await readContract(client, {
      address: curve as `0x${string}`,
      abi: MEME_CURVE_ABI,
      functionName: 'quoteBuy',
      args: [10n ** 17n], // 0.1 ETH worth of desk
    })) as [bigint, bigint, bigint]
    return memeOut
  } catch {
    return null
  }
}

export async function fetchMemePage(offset: number, limit: number): Promise<{ total: number; memes: MemeListing[] }> {
  const total = Number(
    await readContract(client, { address: PRM.memeFactory, abi: MEME_FACTORY_ABI, functionName: 'memeCount' }),
  )
  const start = Math.max(0, Math.min(offset, Math.max(0, total - 1)))
  const end = Math.min(start + limit, total)
  const idx: number[] = []
  for (let i = start; i < end; i++) idx.push(i)
  if (!idx.length) return { total, memes: [] }

  // newest first
  const tokens = await Promise.all(
    idx.reverse().map((i) =>
      readContract(client, { address: PRM.memeFactory, abi: MEME_FACTORY_ABI, functionName: 'memeTokens', args: [BigInt(i)] }) as Promise<string>,
    ),
  )

  const memes = await Promise.all(
    tokens.map(async (t): Promise<MemeListing> => {
      const addr = t as string
      try {
        const m = (await readContract(client, {
          address: PRM.memeFactory,
          abi: MEME_FACTORY_ABI,
          functionName: 'getMeme',
          args: [addr as `0x${string}`],
        })) as { subjectId: string; token: string; curve: string; creator: string; graduationDesk: string; createdAt: bigint }
        const [meta, phase, memeOutRaw] = await Promise.all([
          erc20Meta(m.token),
          readContract(client, { address: m.curve as `0x${string}`, abi: MEME_CURVE_ABI, functionName: 'phase' }).catch(() => 0),
          memeRawQuoteFor01Eth(m.curve),
        ])
        return {
          token: m.token,
          curve: m.curve,
          creator: m.creator,
          subjectId: m.subjectId,
          createdAt: m.createdAt,
          phase: Number(phase),
          priceEth: priceFromRawOut(memeOutRaw, meta.decimals),
          ...meta,
        }
      } catch {
        const meta = await erc20Meta(addr)
        return {
          token: addr,
          curve: '',
          creator: '',
          subjectId: '',
          createdAt: 0n,
          phase: PHASE.TRADING,
          priceEth: null,
          ...meta,
        }
      }
    }),
  )
  return { total, memes }
}

export async function fetchStockPage(offset: number, limit: number): Promise<{ total: number; stocks: StockListing[] }> {
  const total = Number(
    await readContract(client, { address: PRM.subjectFactory, abi: SUBJECT_FACTORY_ABI, functionName: 'subjectCount' }),
  )
  const start = Math.max(0, Math.min(offset, Math.max(0, total - 1)))
  const end = Math.min(start + limit, total)
  const idx: number[] = []
  for (let i = start; i < end; i++) idx.push(i)
  if (!idx.length) return { total, stocks: [] }

  const ids = await Promise.all(
    idx.reverse().map((i) =>
      readContract(client, { address: PRM.subjectFactory, abi: SUBJECT_FACTORY_ABI, functionName: 'subjectIds', args: [BigInt(i)] }) as Promise<string>,
    ),
  )

  const stocks = await Promise.all(
    ids.map(async (id): Promise<StockListing> => {
      const subjectId = id as string
      try {
        const s = (await readContract(client, {
          address: PRM.subjectFactory,
          abi: SUBJECT_FACTORY_ABI,
          functionName: 'getSubject',
          args: [subjectId as `0x${string}`],
        })) as { deskToken: string; curve: string; K: bigint; S: bigint; openingPriceWethX18: bigint; openedAt: bigint }
        const [meta, stockOutRaw] = await Promise.all([erc20Meta(s.deskToken), stockRawQuoteFor01Eth(subjectId)])
        return {
          subjectId,
          deskToken: s.deskToken,
          curve: s.curve,
          openedAt: s.openedAt,
          openingPriceWethX18: s.openingPriceWethX18,
          priceEth: priceFromRawOut(stockOutRaw, meta.decimals),
          ...meta,
        }
      } catch {
        return {
          subjectId,
          deskToken: '',
          curve: '',
          openedAt: 0n,
          openingPriceWethX18: 0n,
          priceEth: null,
          name: 'pSTOCK',
          symbol: '???',
          decimals: 18,
        }
      }
    }),
  )
  return { total, stocks }
}

async function stockRawQuoteFor01Eth(subjectId: string): Promise<bigint | null> {
  try {
    const r = (await readContract(client, {
      address: PRM.router,
      abi: ROUTER_ABI_LIGHT,
      functionName: 'quoteStockExactIn',
      args: [subjectId as `0x${string}`, true, 10n ** 17n],
    })) as [bigint, bigint]
    return r[0]
  } catch {
    return null
  }
}

/* minimal router slice for stock price quotes */
const ROUTER_ABI_LIGHT = [
  {
    type: 'function',
    name: 'quoteStockExactIn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'subjectId', type: 'bytes32' },
      { name: 'buy', type: 'bool' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'output', type: 'uint256' },
      { name: 'inputUsed', type: 'uint256' },
    ],
  },
] as const

export function listingAge(createdAt: bigint): string {
  if (createdAt <= 0n) return '—'
  return timeAgo(Number(createdAt) * 1000)
}
