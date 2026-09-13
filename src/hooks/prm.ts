import { useEffect, useRef, useState } from 'react'
import { formatUnits, parseAbiItem, type Address } from 'viem'
import { readContract } from 'viem/actions'
import { PRM, publicClient } from '../lib/prm/chain'
import { MEME_FACTORY_ABI } from '../lib/prm/abis'
import { fetchMemePage, fetchStockPage, type MemeListing, type StockListing } from '../lib/prm/discovery'

/* ---------- directory pages (RH chain) — polled, no websockets on this chain ---------- */

interface PageResult<T> {
  data: T[] | undefined
  total: number
  loading: boolean
  error: string | null
  refetch: () => void
}

function usePage<T>(
  page: number,
  pageSize: number,
  fetcher: (offset: number, limit: number) => Promise<{ total: number; memes?: T[]; stocks?: T[] }>,
  pick: (r: { memes?: T[]; stocks?: T[] }) => T[] | undefined,
  enabled = true,
): PageResult<T> {
  const [data, setData] = useState<T[] | undefined>()
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    fetcher((page - 1) * pageSize, pageSize)
      .then((r) => {
        if (!alive) return
        setTotal(r.total)
        setData(pick(r) ?? [])
      })
      .catch((e) => {
        if (alive) setError(String(e?.message ?? e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, tick, enabled])

  return { data, total, loading, error, refetch: () => setTick((t) => t + 1) }
}

export function useMemePage(page: number, pageSize = 12, enabled = true): PageResult<MemeListing> {
  return usePage<MemeListing>(page, pageSize, fetchMemePage, (r) => r.memes, enabled)
}

export function useStockPage(page: number, pageSize = 12, enabled = true): PageResult<StockListing> {
  return usePage<StockListing>(page, pageSize, fetchStockPage, (r) => r.stocks, enabled)
}

/* ---------- live feed ---------- */

export interface FeedRow {
  id: string
  kind: 'buy' | 'sell' | 'launch'
  label: string
  detail: string
  ts: number
}

const BOUGHT_EV = parseAbiItem('event Bought(address indexed buyer, address indexed recipient, uint256 deskIn, uint256 memeOut, uint256 fee)')
const SOLD_EV = parseAbiItem('event Sold(address indexed seller, address indexed recipient, uint256 memeIn, uint256 deskOut, uint256 fee)')
const MEME_CREATED_EV = parseAbiItem('event MemeCreated(bytes32 indexed subjectId, address indexed token, address indexed curve, address creator, uint256 graduationDesk)')

/** Global new-launch tape + per-curve trade tape for the selected meme. */
export function useLiveFeed(selectedMeme: string | null, selectedSymbol: string): FeedRow[] {
  const [rows, setRows] = useState<FeedRow[]>([])
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => {
    const client = publicClient()
    const unsubs: Array<() => void> = []

    const push = (r: FeedRow) => {
      if (seen.current.has(r.id)) return
      seen.current.add(r.id)
      setRows((prev) => [r, ...prev].slice(0, 60))
    }

    // 1. global new meme launches (MemeFactory is a single address — watchable)
    try {
      const u1 = client.watchContractEvent({
        address: PRM.memeFactory,
        abi: [MEME_CREATED_EV],
        onLogs: (logs) => {
          for (const l of logs) {
            const token = (l.args as { token?: Address }).token
            push({
              id: `launch-${l.transactionHash}-${l.logIndex}`,
              kind: 'launch',
              label: 'NEW LAUNCH',
              detail: `${token?.slice(0, 10)}… minted on RH-CHAIN`,
              ts: Number(l.blockTimestamp ?? Math.floor(Date.now() / 1000)),
            })
          }
        },
        onError: () => {},
      })
      unsubs.push(u1)
    } catch {
      /* keep the terminal alive if watch setup fails */
    }

    // 2. trades on the selected meme's curve
    if (selectedMeme) {
      void (async () => {
        try {
          const curve = (await readContract(publicClient(), {
            address: PRM.memeFactory,
            abi: MEME_FACTORY_ABI,
            functionName: 'getMeme',
            args: [selectedMeme as Address],
          })) as { curve: string }
          if (!curve?.curve) return
          const u = client.watchContractEvent({
            address: curve.curve as Address,
            abi: [BOUGHT_EV, SOLD_EV],
            onLogs: (logs) => {
              for (const l of logs) {
                const a = l.args as { buyer?: Address; seller?: Address; deskIn?: bigint; deskOut?: bigint; memeIn?: bigint; memeOut?: bigint }
                if (l.eventName === 'Bought') {
                  push({
                    id: `buy-${l.transactionHash}-${l.logIndex}`,
                    kind: 'buy',
                    label: 'BUY',
                    detail: `${a.buyer?.slice(0, 6)}…${a.buyer?.slice(-4)} paid ${Number(formatUnits(a.deskIn ?? 0n, 18)).toFixed(4)} ETH → ${Number(formatUnits(a.memeOut ?? 0n, 0)) === 0 ? '?' : formatUnits(a.memeOut ?? 0n, 2)} ${selectedSymbol}`,
                    ts: Number(l.blockTimestamp ?? Math.floor(Date.now() / 1000)),
                  })
                } else {
                  push({
                    id: `sell-${l.transactionHash}-${l.logIndex}`,
                    kind: 'sell',
                    label: 'SELL',
                    detail: `${a.seller?.slice(0, 6)}…${a.seller?.slice(-4)} sold ${selectedSymbol} → ${Number(formatUnits(a.deskOut ?? 0n, 18)).toFixed(4)} ETH`,
                    ts: Number(l.blockTimestamp ?? Math.floor(Date.now() / 1000)),
                  })
                }
              }
            },
            onError: () => {},
          })
          unsubs.push(u)
        } catch {
          /* ignore */
        }
      })()
    }

    return () => unsubs.forEach((u) => u?.())
  }, [selectedMeme, selectedSymbol])

  return rows
}

/** rolling price series for the live oscilloscope (accumulates real poll results) */
export function useRollingSeries(priceEth: number | null, max = 90): number[] {
  const [series, setSeries] = useState<number[]>([])
  const last = useRef<number | null>(null)
  useEffect(() => {
    if (priceEth == null || !isFinite(priceEth) || priceEth <= 0) return
    if (last.current === priceEth) return
    last.current = priceEth
    setSeries((s) => [...s, priceEth].slice(-max))
  }, [priceEth, max])
  return series
}
