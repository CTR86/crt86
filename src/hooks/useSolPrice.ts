import { useQuery } from '@tanstack/react-query'

/** live SOL/USD — CoinGecko first, Binance fallback */
export function useSolPrice() {
  return useQuery<number>({
    queryKey: ['sol-price'],
    queryFn: async () => {
      try {
        const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
        const j = await r.json()
        const p = j?.solana?.usd
        if (typeof p === 'number' && p > 0) return p
        throw new Error('bad shape')
      } catch {
        const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT')
        const j = await r.json()
        const p = parseFloat(j?.price)
        if (isFinite(p) && p > 0) return p
        throw new Error('SOL price unavailable')
      }
    },
    refetchInterval: 60_000,
    staleTime: 50_000,
    retry: 1,
  })
}
