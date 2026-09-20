import { useMutation, useQuery, type UseQueryOptions } from '@tanstack/react-query'
import {
  getBurns,
  getLaunchStatus,
  getLaunches,
  getPairs,
  getStats,
  getToken,
  getTokenFees,
  getTokens,
  prepareFeeClaim,
  prepareLaunch,
  submitFeeClaim,
  submitLaunch,
  type LaunchRecord,
  type PrepareLaunchBody,
  type TokensData,
} from '../lib/stonkfun'

export function useTokens(params: Parameters<typeof getTokens>[0], opts?: Partial<UseQueryOptions<TokensData>>) {
  const isNewest = params.sort === 'newest'
  return useQuery<TokensData>({
    queryKey: ['sf-tokens', params],
    queryFn: () => getTokens(params),
    // Newest feed must feel "as it launches" — poll twice as fast and
    // mark stale immediately so mounts + window focus always refetch.
    refetchInterval: isNewest ? 5_000 : 10_000,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: true,
    ...opts,
  })
}

export function useTokenDetail(mint: string | null) {
  return useQuery({
    queryKey: ['sf-token', mint],
    queryFn: () => getToken(mint!),
    enabled: !!mint,
    refetchInterval: 5_000,
  })
}

export function useStats() {
  return useQuery({ queryKey: ['sf-stats'], queryFn: getStats, refetchInterval: 30_000 })
}

export function usePairs() {
  return useQuery({ queryKey: ['sf-pairs'], queryFn: () => getPairs({ launchable: true }), staleTime: 5 * 60_000 })
}

export function useCreatorLaunches(creator: string | null) {
  return useQuery({
    queryKey: ['sf-launches', creator],
    queryFn: () => getLaunches({ creator: creator!, pageSize: 50 }),
    enabled: !!creator,
    refetchInterval: 20_000,
  })
}

export function useTokenFees(mint: string | null) {
  return useQuery({
    queryKey: ['sf-fees', mint],
    queryFn: () => getTokenFees(mint!),
    enabled: !!mint,
    refetchInterval: 10_000,
  })
}

export function useBurns(mint: string | null) {
  return useQuery({
    queryKey: ['sf-burns', mint],
    queryFn: () => getBurns(mint!, 8),
    enabled: !!mint,
  })
}

/** polls until completed; pass enabled=false to stop */
export function useLaunchStatus(signature: string | null) {
  return useQuery<LaunchRecord>({
    queryKey: ['sf-launch-status', signature],
    queryFn: () => getLaunchStatus(signature!),
    enabled: !!signature,
    refetchInterval: (q) => {
      const d = q.state.data
      return d?.status === 'completed' ? false : 2_500
    },
    refetchIntervalInBackground: true,
  })
}

export function usePrepareLaunch() {
  return useMutation({ mutationFn: (body: PrepareLaunchBody) => prepareLaunch(body) })
}

export function useSubmitLaunch() {
  return useMutation({
    mutationFn: (body: { signedQuote: string; signedTransaction: string; logo: string }) => submitLaunch(body),
  })
}

export function usePrepareFeeClaim() {
  return useMutation({ mutationFn: (v: { mint: string; creatorWallet: string }) => prepareFeeClaim(v.mint, v.creatorWallet) })
}

export function useSubmitFeeClaim() {
  return useMutation({
    mutationFn: (v: { mint: string; creatorWallet: string; intentId: string; signedTransaction: string }) =>
      submitFeeClaim(v.mint, v),
  })
}
