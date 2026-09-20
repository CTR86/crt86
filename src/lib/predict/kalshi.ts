/* ============================================================
   Kalshi provider for PREDICT.EXE.
   - Bases (verified from official docs): prod
     https://api.elections.kalshi.com/trade-api/v2, demo
     https://demo-api.kalshi.co/trade-api/v2 (UI toggle, demo default).
   - Auth: per-user RSA key ID + PEM (pasted, session-only default).
     Signing is RSA-PSS/SHA256 over timestamp+METHOD+path (query
     stripped), base64 — performed SERVER-SIDE by /api/kalshi per
     request because Kalshi's CORS preflight forbids KALSHI-* headers
     from browsers (verified OPTIONS 204 without those headers).
     The proxy never stores or logs credentials.
   - Public reads go direct from the browser (CORS echo verified),
     with unsigned-proxy fallback on network failure.
   - YES = bid, NO = ask-at-(1-price) (single YES book).
   - Create Order V2 shape verified from official OpenAPI excerpts.
   ============================================================ */

import type {
  KalshiAuth,
  PredictionMarket,
} from './types'

const BASE: Record<'prod' | 'demo', string> = {
  prod: 'https://api.elections.kalshi.com/trade-api/v2',
  demo: 'https://demo-api.kalshi.co/trade-api/v2',
}

/** UI-selected network (demo default). Providers read this; window sets it on toggle. */
let kalshiDemoMode = true

export function setKalshiDemo(demo: boolean): void {
  kalshiDemoMode = demo
}

function pinnedTicker(): string {
  try {
    return ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_KALSHI_MARKET_TICKER ?? '').trim()
  } catch {
    return ''
  }
}

function uuid(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/* ---------- transport: direct-first, unsigned-proxy fallback ---------- */

async function directGet<T>(base: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString()
  const r = await fetch(`${base}${path}${qs ? `?${qs}` : ''}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!r.ok) throw new Error(`Kalshi HTTP ${r.status}`)
  return (await r.json()) as T
}

async function proxyCall<T>(args: {
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  query?: Record<string, string>
  body?: unknown
  auth?: KalshiAuth | null
  demo: boolean
}): Promise<T> {
  const r = await fetch('/api/kalshi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      method: args.method,
      path: args.path,
      query: args.query ?? {},
      body: args.body ?? null,
      keyId: (args.auth as KalshiAuth | null)?.keyId ?? null,
      pem: (args.auth as KalshiAuth | null)?.pem ?? null,
      demo: args.demo,
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) {
    const msg = (j as { message?: string } | null)?.message ?? `Kalshi proxy HTTP ${r.status}`
    throw new Error(String(msg).slice(0, 300))
  }
  return j as T
}

/** Public GET: browser-direct, unsigned-proxy fallback. */
async function publicGet<T>(base: string, demo: boolean, path: string, params: Record<string, string> = {}): Promise<T> {
  try {
    return await directGet<T>(base, path, params)
  } catch (e) {
    const m = String((e as Error).message ?? e)
    if (/timed out|timeout|failed to fetch|network|load failed/i.test(m)) {
      return proxyCall<T>({ method: 'GET', path, query: params, demo })
    }
    throw e
  }
}

/** Authed call: always via proxy (browser cannot send KALSHI-* headers). */
function authed<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  auth: KalshiAuth,
  query: Record<string, string> = {},
  body: unknown = null,
): Promise<T> {
  if (!auth?.keyId || !auth?.pem) throw new Error('Paste your Kalshi Key ID + RSA private key first.')
  return proxyCall<T>({ method, path, query, body, auth, demo: auth.demo })
}

/* ---------- discovery ---------- */

interface KalshiMarketRaw {
  ticker?: string
  title?: string
  subtitle?: string
  rules_primary?: string
  status?: string
  yes_bid?: number | string
  yes_ask?: number | string
  last_price?: number | string
  volume?: number | string
  open_interest?: number | string
  close_time?: string
  expiration_time?: string
  event_ticker?: string
}

function dollars(v: unknown): number | null {
  // Kalshi uses cents ints AND fixed-point dollar strings across versions.
  if (typeof v === 'number') {
    if (!isFinite(v)) return null
    return v > 1 ? v / 100 : v
  }
  if (typeof v === 'string') {
    const n = Number(v)
    if (!isFinite(n)) return null
    // '56' style cents vs '0.56' style dollars: >1 with no dot = cents
    if (!v.includes('.') && n > 1) return n / 100
    return n
  }
  return null
}

function marketOpen(m: KalshiMarketRaw): boolean {
  const s = String(m.status ?? '').toLowerCase()
  return s === 'open' || s === 'active'
}

function toPredictionMarket(m: KalshiMarketRaw): PredictionMarket {
  const yesBid = dollars(m.yes_bid)
  const yesAsk = dollars(m.yes_ask)
  const last = dollars(m.last_price)
  const yesPrice = yesBid != null && yesAsk != null ? (yesBid + yesAsk) / 2 : (last ?? yesBid ?? yesAsk ?? null)
  return {
    provider: 'kalshi',
    marketId: String(m.ticker ?? ''),
    title: String(m.title ?? m.ticker ?? ''),
    description: String(m.subtitle ?? ''),
    yesPrice,
    noPrice: yesPrice != null ? Number((1 - yesPrice).toFixed(4)) : null,
    yesBid,
    yesAsk,
    noBid: yesAsk != null ? Number((1 - yesAsk).toFixed(4)) : null,
    noAsk: yesBid != null ? Number((1 - yesBid).toFixed(4)) : null,
    liquidity: null, // Kalshi exposes open_interest, not USD depth — no fabrication
    volume: m.volume != null && isFinite(Number(m.volume)) ? Number(m.volume) : null,
    closeTime: m.close_time || m.expiration_time || null,
    status: marketOpen(m) ? 'open' : /paus|suspend|halt/i.test(String(m.status)) ? 'paused' : 'closed',
    rules: String(m.rules_primary ?? ''),
    url: `https://kalshi.com/markets/${m.event_ticker ?? ''}/${String(m.ticker ?? '').toLowerCase()}`,
    ref: { ticker: String(m.ticker ?? '') },
  }
}

export async function discoverKalshiMarket(demo: boolean): Promise<PredictionMarket> {
  const base = demo ? BASE.demo : BASE.prod
  const pinned = pinnedTicker()
  if (pinned) {
    const m = await publicGet<{ market?: KalshiMarketRaw }>(base, demo, `/markets/${encodeURIComponent(pinned)}`).catch(() => null)
    const raw = m?.market ?? (m as unknown as KalshiMarketRaw)
    if (raw?.ticker && marketOpen(raw)) return toPredictionMarket(raw)
    throw new Error(`Pinned market '${pinned}' not found or not open — clear VITE_KALSHI_MARKET_TICKER to auto-discover.`)
  }
  const page = await publicGet<{ markets?: KalshiMarketRaw[] }>(base, demo, '/markets', { limit: '50', status: 'open' })
  const list = (page?.markets ?? []).filter((m) => m.ticker && marketOpen(m))
  if (list.length === 0) throw new Error('No open Kalshi markets found.')
  const btc = list.filter((m) => /bitcoin|\bbtc\b/i.test(`${m.title} ${m.ticker}`))
  const withBook = btc.length > 0 ? btc : list
  // prefer a market with a live YES bid (real liquidity)
  withBook.sort((a, b) => (Number(b.volume ?? 0) || 0) - (Number(a.volume ?? 0) || 0))
  const liquid = withBook.find((m) => (dollars(m.yes_bid) ?? 0) > 0) ?? withBook[0]
  return toPredictionMarket(liquid)
}

export async function getKalshiMarket(demo: boolean, ticker: string): Promise<PredictionMarket> {
  const base = demo ? BASE.demo : BASE.prod
  const m = await publicGet<{ market?: KalshiMarketRaw }>(base, demo, `/markets/${encodeURIComponent(ticker)}`)
  const raw = m?.market ?? (m as unknown as KalshiMarketRaw)
  if (!raw?.ticker) throw new Error('Kalshi market not found.')
  return toPredictionMarket(raw)
}

/* ---------- book ---------- */

export async function getKalshiBook(demo: boolean, ticker: string): Promise<import('./types').PredictBook> {
  const base = demo ? BASE.demo : BASE.prod
  const j = await publicGet<unknown>(base, demo, `/markets/${encodeURIComponent(ticker)}/orderbook`, { depth: '10' })
  const root = (j as { orderbook?: unknown }).orderbook ?? j
  const ob = root as { yes?: Array<[number, number]>; no?: Array<[number, number]> }
  const norm = (levels: unknown): import('./types').PredictBookLevel[] => {
    if (!Array.isArray(levels)) return []
    return levels
      .map((l) => {
        const px = Array.isArray(l) ? l[0] : (l as { price?: unknown }).price
        const sz = Array.isArray(l) ? l[1] : (l as { size?: unknown; count?: unknown }).size ?? (l as { count?: unknown }).count
        const price = dollars(px)
        const size = Number(sz)
        return price != null && isFinite(size) && size > 0 ? { price, size } : null
      })
      .filter((l): l is import('./types').PredictBookLevel => l !== null)
      .slice(0, 8)
  };
  // Kalshi book legs: yes[] and no[] are each [price,count] resting orders.
  // YES book bids = yes leg; YES asks = no leg mirrored (1-p).
  const yesLeg = norm((ob as { yes_bids?: unknown }).yes_bids ?? ob.yes)
  const noLeg = norm((ob as { no_bids?: unknown }).no_bids ?? ob.no)
  const mirror = (ls: import('./types').PredictBookLevel[]): import('./types').PredictBookLevel[] =>
    ls.map((l) => ({ price: Number((1 - l.price).toFixed(4)), size: l.size }))
  return {
    yesBids: yesLeg.sort((a, b) => b.price - a.price),
    yesAsks: mirror(noLeg).sort((a, b) => a.price - b.price),
    noBids: noLeg.sort((a, b) => b.price - a.price),
    noAsks: mirror(yesLeg).sort((a, b) => a.price - b.price),
  }
}

/* ---------- exchange status ---------- */

export async function getKalshiExchangeStatus(demo: boolean): Promise<'open' | 'paused' | 'unknown'> {
  const base = demo ? BASE.demo : BASE.prod
  try {
    const j = await publicGet<Record<string, unknown>>(base, demo, '/exchange/status')
    const active = (j as { exchange_active?: boolean; trading_active?: boolean }).exchange_active
    const trading = (j as { trading_active?: boolean }).trading_active
    if (active === false || trading === false) return 'paused'
    return 'open'
  } catch {
    return 'unknown'
  }
}

/* ---------- authed: balance / positions / orders ---------- */

function mapKalshiOrderStatus(s: string): import('./types').PredictOrderStatus {
  const t = s.toLowerCase()
  if (t === 'resting') return 'resting'
  if (t === 'canceled' || t === 'cancelled') return 'canceled'
  if (t === 'executed') return 'filled'
  return 'unknown'
}

export function mapKalshiError(msg: string): string {
  const m = msg.slice(0, 350)
  if (/401|unauthorized|invalid.*key|forbidden/i.test(m)) return 'Kalshi rejected the credentials — check Key ID + PEM (demo vs prod must match).'
  if (/429|rate/i.test(m)) return 'Kalshi rate-limited — wait a bit and retry.'
  if (/insufficient|balance|margin/i.test(m)) return 'Insufficient Kalshi balance — fund the account first.'
  if (/paused|halt|suspend|closed/i.test(m)) return 'Market/exchange not tradable right now.'
  return m
}

export const KalshiProvider = {
  id: 'kalshi' as const,
  label: 'KALSHI',
  discoverMarket: async () => discoverKalshiMarket(kalshiDemoMode),
  getMarket: async (marketId: string) => getKalshiMarket(kalshiDemoMode, marketId),
  getOrderBook: async (market: PredictionMarket) => getKalshiBook(kalshiDemoMode, String(market.ref.ticker ?? market.marketId)),
  getBalance: async (auth: import('./types').KalshiAuth | import('./types').PolyAuth | null) => {
    if (!auth || !('pem' in auth)) return { provider: 'kalshi' as const, available: null }
    const kalshiAuth = auth as import('./types').KalshiAuth
    const j = await authed('GET', '/portfolio/balance', kalshiAuth)
    const cents = Number((j as { balance?: unknown }).balance)
    return { provider: 'kalshi' as const, available: isFinite(cents) ? cents / 100 : null }
  },
  getPositions: async (auth: import('./types').KalshiAuth | import('./types').PolyAuth | null, market: PredictionMarket) => {
    if (!auth || !('pem' in auth)) return []
    const kalshiAuth = auth as import('./types').KalshiAuth
    const j = await authed<{ market_positions?: Array<Record<string, unknown>>; positions?: Array<Record<string, unknown>> }>(
      'GET', '/portfolio/positions', kalshiAuth, { ticker: String(market.ref.ticker ?? market.marketId) },
    )
    const list = j.market_positions ?? j.positions ?? []
    const out: import('./types').PredictPosition[] = []
    for (const p of list) {
      if (String(p.ticker ?? '') !== String(market.ref.ticker ?? market.marketId)) continue
      const count = Number(p.position ?? p.count ?? 0)
      if (!isFinite(count) || count === 0) continue
      const avg = dollars(p.avg_price ?? p.average_price) ?? 0
      out.push({
        provider: 'kalshi' as const,
        marketId: market.marketId,
        title: market.title,
        outcome: (count >= 0 ? 'YES' : 'NO') as 'YES' | 'NO',
        size: Math.abs(count),
        avgPrice: avg,
        curPrice: market.yesPrice,
        value: market.yesPrice != null ? Math.abs(count) * market.yesPrice : null,
        pnl: market.yesPrice != null ? Math.abs(count) * (market.yesPrice - avg) * (count >= 0 ? 1 : -1) : null,
      })
    }
    return out
  },
  getOrders: async (auth, market) => {
    if (!auth || !('pem' in auth)) return []
    const a = auth as KalshiAuth
    const j = await authed<{ orders?: Array<Record<string, unknown>> }>('GET', '/portfolio/orders', a, {
      ticker: String(market.ref.ticker ?? market.marketId),
      status: 'resting',
    })
    const list = j.orders ?? []
    return list.map((o) => ({
      provider: 'kalshi' as const,
      marketId: market.marketId,
      orderId: String(o.order_id ?? ''),
      outcome: (String(o.book_side ?? o.outcome_side ?? 'bid').toLowerCase() === 'ask' ? 'NO' : 'YES') as 'YES' | 'NO',
      side: 'BUY' as const,
      price: dollars(o.yes_price_dollars ?? o.price) ?? 0,
      size: Number(o.remaining_count_fp ?? o.remaining_count ?? 0),
      notional: 0,
      status: mapKalshiOrderStatus(String(o.status ?? '')),
      filledQty: Number(o.fill_count_fp ?? o.fill_count ?? 0),
      remainingQty: Number(o.remaining_count_fp ?? o.remaining_count ?? 0),
      ts: null,
    }))
  },
  placeOrder: async (auth, args) => {
    const a = auth as KalshiAuth
    if (!a?.keyId || !a?.pem) throw new Error('Paste your Kalshi Key ID + RSA private key first.')
    const ticker = String(args.market.ref.ticker ?? args.market.marketId)
    if (!ticker) throw new Error('Market has no ticker.')
    if (!Number.isInteger(args.size) || args.size < 1) throw new Error('Kalshi needs a whole number of contracts (≥ 1).')
    if (!(args.price > 0) || !(args.price < 1)) throw new Error('Price must be between 0 and 1 (exclusive).')
    // YES = bid at price; NO = ask at (1 - price)
    const side = args.outcome === 'YES' ? 'bid' : 'ask'
    const px = args.outcome === 'YES' ? args.price : 1 - args.price
    const priceStr = px.toFixed(4)
    try {
      const res = await authed<{ order_id?: string; fill_count?: string; remaining_count?: string }>(
        'POST',
        '/portfolio/events/orders',
        a,
        {},
        {
          ticker,
          client_order_id: uuid(),
          side,
          count: String(args.size),
          price: priceStr,
          time_in_force: 'good_till_canceled',
          self_trade_prevention_type: 'taker_at_cross',
        },
      )
      if (!res?.order_id) throw new Error('Kalshi returned no order id.')
      const filled = Number(res.fill_count ?? 0)
      return `${res.order_id} — filled ${filled}, resting ${res.remaining_count ?? '?'}`
    } catch (e) {
      throw new Error(mapKalshiError(String((e as Error).message ?? e)), { cause: e })
    }
  },
  getOrder: async (auth, market, orderId) => {
    const a = auth as KalshiAuth
    const o = await authed<Record<string, unknown>>('GET', `/portfolio/orders/${encodeURIComponent(orderId)}`, a)
    const price = dollars(o.yes_price_dollars ?? o.price) ?? 0
    const size = Number(o.initial_count_fp ?? o.initial_count ?? o.remaining_count_fp ?? 0)
    return {
      provider: 'kalshi' as const,
      marketId: market.marketId,
      orderId: String(o.order_id ?? orderId),
      outcome: 'YES' as const,
      side: 'BUY' as const,
      price,
      size,
      notional: size * price,
      status: mapKalshiOrderStatus(String(o.status ?? '')),
      filledQty: Number(o.fill_count_fp ?? o.fill_count ?? 0),
      remainingQty: Number(o.remaining_count_fp ?? o.remaining_count ?? 0),
      ts: null,
    }
  },
  cancelOrder: async (auth, market, orderId) => {
    const a = auth as KalshiAuth
    await authed('DELETE', `/portfolio/events/orders/${encodeURIComponent(orderId)}`, a)
    void market
    return `CANCELED #${orderId}`
  },
} satisfies import('./types').PredictProvider

export { BASE as KALSHI_BASES }
