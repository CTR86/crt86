import { useQuery } from '@tanstack/react-query'
import { getMarketHolidays, getMarketSessions, getMarkets, getSecurities, getTickers } from '../lib/backpack/api'

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
