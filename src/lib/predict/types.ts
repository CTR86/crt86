/* ============================================================
   PREDICT.EXE — normalized prediction-market model + provider
   interface. Two venues (Polymarket, Kalshi), one UI language.
   Prices are dollars 0..1 internally; UI renders cents (64c).
   No mock data: every field comes from a live provider response;
   unavailable fields stay null and render as em-dash.
   ============================================================ */

export type PredictVenueId = 'polymarket' | 'kalshi'
export type PredictOutcome = 'YES' | 'NO'

export interface PredictBookLevel {
  price: number // dollars 0..1
  size: number // shares (poly) / contracts (kalshi)
}

export interface PredictBook {
  yesBids: PredictBookLevel[]
  yesAsks: PredictBookLevel[]
  noBids: PredictBookLevel[]
  noAsks: PredictBookLevel[]
}

export interface PredictionMarket {
  provider: PredictVenueId
  /** Gamma slug (poly) / market ticker (kalshi) */
  marketId: string
  title: string
  description: string | null
  yesPrice: number | null
  noPrice: number | null
  yesBid: number | null
  yesAsk: number | null
  noBid: number | null
  noAsk: number | null
  liquidity: number | null // USD-ish depth where available
  volume: number | null // USD-ish lifetime volume where available
  closeTime: string | null // ISO or null
  status: 'open' | 'closed' | 'paused' | 'unknown'
  rules: string | null
  url: string
  /** venue-native ids needed for trading (token ids / ticker) */
  ref: { yesToken?: string; noToken?: string; ticker?: string; conditionId?: string }
}

export type PredictOrderStatus = 'resting' | 'filled' | 'partial' | 'canceled' | 'rejected' | 'unknown'

export interface NormalizedOrder {
  provider: PredictVenueId
  marketId: string
  orderId: string
  outcome: PredictOutcome
  side: 'BUY' // MVP is buy-only (see PredictWindow)
  price: number // dollars 0..1 limit/market ref
  size: number // shares/contracts
  notional: number // USD max cost
  status: PredictOrderStatus
  filledQty: number
  remainingQty: number
  ts: number | null
}

export interface PredictPosition {
  provider: PredictVenueId
  marketId: string
  title: string
  outcome: PredictOutcome
  size: number
  avgPrice: number
  curPrice: number | null
  value: number | null
  pnl: number | null
}

export interface PredictBalance {
  provider: PredictVenueId
  /** tradable cash in USD (USDC on Polygon / dollars on Kalshi) */
  available: number | null
}

export interface PredictPlaceArgs {
  market: PredictionMarket
  outcome: PredictOutcome
  /** MVP is BUY-only (spec order flow: SELECT YES/NO → BUY) */
  side: 'BUY'
  /** limit price dollars 0..1 (market orders compute from book) */
  price: number
  /** shares (poly) / contracts (kalshi) */
  size: number
  /** true = fill-or-kill at/through the book; false = GTC limit */
  isMarket: boolean
}

/** Auth material per venue (browser-held, never committed). */
export interface PolyAuth {
  address: string
  creds: { key: string; secret: string; passphrase: string }
}

export interface KalshiAuth {
  keyId: string
  /** RSA PEM text — session-only by default, never stored server-side */
  pem: string
  demo: boolean
}

export interface PredictProvider {
  id: PredictVenueId
  label: string
  /** discover one eligible market (BTC-preferring) or resolve the pinned id */
  discoverMarket(pinnedId?: string): Promise<PredictionMarket>
  getMarket(marketId: string): Promise<PredictionMarket>
  getOrderBook(market: PredictionMarket): Promise<PredictBook>
  /** balances/positions need auth; null auth = honest empty */
  getBalance(auth: PolyAuth | KalshiAuth | null): Promise<PredictBalance>
  getPositions(auth: PolyAuth | KalshiAuth | null, market: PredictionMarket): Promise<PredictPosition[]>
  getOrders(auth: PolyAuth | KalshiAuth | null, market: PredictionMarket): Promise<NormalizedOrder[]>
  /** returns the provider order id; throws honest errors otherwise */
  placeOrder(auth: PolyAuth | KalshiAuth, args: PredictPlaceArgs): Promise<string>
  getOrder(auth: PolyAuth | KalshiAuth, market: PredictionMarket, orderId: string): Promise<NormalizedOrder>
  cancelOrder(auth: PolyAuth | KalshiAuth, market: PredictionMarket, orderId: string): Promise<string>
}

export function fmtCents(dollars: number | null | undefined): string {
  if (dollars == null || !isFinite(dollars)) return '—'
  return `${Math.round(dollars * 100)}¢`
}

export function fmtUsd2(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return '—'
  return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
