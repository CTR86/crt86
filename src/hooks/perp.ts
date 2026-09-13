/* PERP.EXE — tanstack hooks (reuse app's QueryClient + staleTime patterns) */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJlpInfo, fetchPerpPrices, fetchPositionsForOwner, enrichPositionDerived } from '../lib/perp/api'
import type { PerpPrice } from '../lib/perp/types'

export function usePerpPrices() {
  return useQuery<PerpPrice[]>({
    queryKey: ['perp-prices'],
    queryFn: fetchPerpPrices,
    refetchInterval: 20_000,
    staleTime: 15_000,
    retry: 2,
  })
}

export function useJlpInfo() {
  return useQuery({
    queryKey: ['perp-jlp'],
    queryFn: fetchJlpInfo,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: 1,
  })
}

export function usePerpPositions(ownerBase58: string | null) {
  return useQuery({
    queryKey: ['perp-positions', ownerBase58],
    queryFn: async () => {
      if (!ownerBase58) return { positions: [], note: null as string | null }
      const { positions, note } = await fetchPositionsForOwner(ownerBase58)
      return { positions, note }
    },
    enabled: !!ownerBase58,
    refetchInterval: 12_000,
    staleTime: 8_000,
    retry: 1,
  })
}

export function usePerpPositionsEnriched(ownerBase58: string | null, prices: PerpPrice[] | undefined) {
  const base = usePerpPositions(ownerBase58)
  const enriched = (base.data?.positions ?? []).map((p) => enrichPositionDerived(p as never, prices))
  return { ...base, enriched }
}

export function usePerpInvalidate() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['perp-positions'] })
    void qc.invalidateQueries({ queryKey: ['perp-prices'] })
    void qc.invalidateQueries({ queryKey: ['perp-jlp'] })
  }
}

export function usePerpTx() {
  return useMutation({
    mutationFn: async (_args: unknown) => {
      throw new Error('Use direct transaction builders in the window (keeps wallet signing explicit).')
    },
  })
}
