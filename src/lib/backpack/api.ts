/* Backpack Exchange — public market data for STOCK.EXE.
   REST is proxied same-origin (`/backpack` → api.backpack.exchange)
   so the browser does not need CORS. Trading (RFQ / orders) is signed
   ED25519 and stays off this client until a server-side key is wired. */

export const BACKPACK_PROXY = '/backpack'

export type MarketType = 'SPOT' | 'PERP' | 'IPERP' | 'DATED' | 'PREDICTION' | 'RFQ'
export type RwaMarketType = 'STOCK' | string

export interface SecuritySession {
  name: string
  minQuantity: string
  maxQuantity: string
  stepSize: string
}

export interface Security {
  asset: string
  name: string
  cusip: string
  sessions: SecuritySession[]
}

export interface MarketSession {
  name: string
  description: string
  startTime: string
  endTime: string
  timezone: string
  startWeekday: number
  endWeekday: number
}

export interface MarketHoliday {
  market: string
  name: string
  date: string
  startTime?: string | null
  endTime?: string | null
  timezone: string
}

export interface Market {
  symbol: string
  baseSymbol: string
  quoteSymbol: string
  marketType: MarketType
  orderBookState: string
  visible: boolean
  rwaMarketType?: RwaMarketType | null
}

export interface Ticker {
  symbol: string
  firstPrice: string
  lastPrice: string
  priceChange: string
  priceChangePercent: string
  high: string
  low: string
  volume: string
  quoteVolume: string
  trades: string
}

async function bpGet<T>(path: string): Promise<T> {
  const r = await fetch(`${BACKPACK_PROXY}${path}`)
  if (r.status === 204) throw new Error('NO TAPE')
  if (!r.ok) {
    let msg = `BACKPACK ${r.status}`
    try {
      const j = (await r.json()) as { message?: string; code?: string }
      if (j?.message) msg = j.message
    } catch {
      /* keep status */
    }
    throw new Error(msg)
  }
  return r.json() as Promise<T>
}

export function getSecurities() {
  return bpGet<Security[]>('/api/v1/securities')
}

export function getMarketSessions() {
  return bpGet<MarketSession[]>('/api/v1/market-sessions')
}

export function getMarketHolidays() {
  return bpGet<MarketHoliday[]>('/api/v1/market-holidays')
}

export function getMarkets() {
  return bpGet<Market[]>('/api/v1/markets')
}

export function getTickers() {
  return bpGet<Ticker[]>('/api/v1/tickers?interval=1d')
}

export function tickerForAsset(tickers: Ticker[], asset: string): { ticker: Ticker; venue: 'SPOT' | 'PERP' } | null {
  const spot = tickers.find((t) => t.symbol === `${asset}_USDC`)
  if (spot) return { ticker: spot, venue: 'SPOT' }
  const perp = tickers.find((t) => t.symbol === `${asset}_USDC_PERP`)
  if (perp) return { ticker: perp, venue: 'PERP' }
  return null
}

export function rfqSymbol(asset: string) {
  return `${asset}_USDC_RFQ`
}

export function num(s: string | null | undefined): number | null {
  if (s == null || s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
