import { useQuery } from '@tanstack/react-query'
import { getMarketHolidays, getMarketSessions, getMarkets, getSecurities, getTickers } from '../lib/backpack/api'
import { getBpBalances, getBpRfqs, getBpStatus } from '../lib/backpack/trade'

export function useStockUniverse() {
  return useQuery({
    queryKey: ['bp-securities'],
    queryFn: getSecurities,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  })
}

export function useStockSessions() {
  return useQuery({
    queryKey: ['bp-sessions'],
    queryFn: getMarketSessions,
    staleTime: 60 * 60_000,
  })
}

export function useStockHolidays() {
  return useQuery({
    queryKey: ['bp-holidays'],
    queryFn: getMarketHolidays,
    staleTime: 60 * 60_000,
  })
}

export function useStockMarkets() {
  return useQuery({
    queryKey: ['bp-markets'],
    queryFn: getMarkets,
    staleTime: 5 * 60_000,
  })
}

export function useStockTickers() {
  return useQuery({
    queryKey: ['bp-tickers'],
    queryFn: getTickers,
    staleTime: 8_000,
    refetchInterval: 12_000,
  })
}

export function useBpStatus() {
  return useQuery({
    queryKey: ['bp-status'],
    queryFn: getBpStatus,
    staleTime: 30_000,
  })
}

export function useBpBalances(enabled: boolean) {
  return useQuery({
    queryKey: ['bp-balances'],
    queryFn: getBpBalances,
    enabled,
    staleTime: 8_000,
    refetchInterval: enabled ? 12_000 : false,
  })
}

export function useBpRfqs(enabled: boolean) {
  return useQuery({
    queryKey: ['bp-rfqs'],
    queryFn: getBpRfqs,
    enabled,
    staleTime: 2_000,
    refetchInterval: enabled ? 3_000 : false,
  })
}
