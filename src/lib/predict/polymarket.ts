/* ============================================================
   Polymarket provider for PREDICT.EXE.
   - Discovery + market reads: Gamma API (public).
   - Books/prices: CLOB public endpoints.
   - Trading: official @polymarket/clob-client (viem WalletClient,
     EOA signature_type 0, funder = own address). Orders are EIP-712
     signed in the browser wallet — no private key ever handled.
   - L1 (derive API creds) + L2 (HMAC) auth per the SDK; creds are
     per-user, revocable, browser-held (localStorage, session option).
   - All HTTP runs through the same-origin /api/poly forwarder
     (strict host allowlist) so every browser works regardless of
     upstream CORS. Signing stays client-side.
   - Positions: public Data API by wallet address.
   - Market WS (public) direct in browser; user WS is intentionally
     NOT used (docs: server environments only) — fills via polling.
   Sources: official clob-client TS source (endpoints/auth/signing),
   py-clob-client README (allowances, flows).
   ============================================================ */

import { Chain, ClobClient, OrderType, Side } from '@polymarket/clob-client'
import { createPublicClient, createWalletClient, custom, erc20Abi, http, type Address } from 'viem'
import { polygon } from 'viem/chains'
import { evmChain } from '../swap/chains'
import type {
  KalshiAuth,
  NormalizedOrder,
  PolyAuth,
  PredictBook,
  PredictBookLevel,
  PredictOrderStatus,
  PredictionMarket,
} from './types'

export const POLY_CLOB_HOST = 'https://clob.polymarket.com'
const PROXY = '/api/poly'

/** Same-origin forwarder: /api/poly?base=<gamma|clob|data>&path=/<upstream-path> */
function fwd(base: 'gamma' | 'clob' | 'data', path: string, params: Record<string, string> = {}): string {
  const clean = path.startsWith('/') ? path : `/${path}`
  const sp = new URLSearchParams({ base, path: clean })
  for (const [k, v] of Object.entries(params)) sp.set(k, v)
  return `${PROXY}?${sp.toString()}`
}

async function fwdGet<T>(base: 'gamma' | 'clob' | 'data', path: string, params: Record<string, string> = {}, headers?: Record<string, string>): Promise<T> {
  const url = fwd(base, path, params)
  const r = await fetch(url, {
    headers: { Accept: 'application/json', ...(headers ?? {}) },
    signal: AbortSignal.timeout(25_000),
  })
  if (!r.ok) {
    const j = await r.json().catch(() => null)
    throw new Error((j as { message?: string } | null)?.message ?? `Polymarket HTTP ${r.status}`)
  }
  return (await r.json()) as T
}

/* ---------- Gamma discovery ---------- */

interface GammaMarketRaw {
  slug: string
  question: string
  description?: string
  outcomes?: string // JSON string
  clobTokenIds?: string // JSON string
  outcomePrices?: string // JSON string
  volume?: string
  liquidity?: string
  endDate?: string
  closed?: boolean
  umaResolutionStatuses?: string
  groupItemTitle?: string
}

interface GammaEventRaw {
  slug: string
  title: string
  description?: string
  endDate?: string
  closed?: boolean
  archived?: boolean
  volume?: number | string
  liquidity?: number | string
  markets?: GammaMarketRaw[]
}

function parseJsonArr(s: string | undefined): string[] {
  if (!s) return []
  try {
    const v = JSON.parse(s) as unknown
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return isFinite(n) ? n : null
}

function pickMarket(event: GammaEventRaw): GammaMarketRaw | null {
  const open = (event.markets ?? []).filter((m) => !m.closed)
  if (open.length === 0) return null
  // prefer a binary Yes/No market with token ids + prices
  const binary = open.filter((m) => {
    const outs = parseJsonArr(m.outcomes)
    const ids = parseJsonArr(m.clobTokenIds)
    return outs.length === 2 && ids.length === 2 && /yes/i.test(outs[0] ?? '') && /no/i.test(outs[1] ?? '')
  })
  const pool = binary.length > 0 ? binary : open
  pool.sort((a, b) => (num(b.volume) ?? 0) - (num(a.volume) ?? 0))
  return pool[0] ?? null
}

function toPredictionMarket(event: GammaEventRaw, m: GammaMarketRaw): PredictionMarket {
  const ids = parseJsonArr(m.clobTokenIds)
  const prices = parseJsonArr(m.outcomePrices)
  const yesPrice = num(prices[0])
  const noPrice = num(prices[1])
  return {
    provider: 'polymarket',
    marketId: event.slug || m.slug,
    title: m.question || event.title,
    description: m.description || event.description || null,
    yesPrice,
    noPrice,
    yesBid: null,
    yesAsk: null,
    noBid: null,
    noAsk: null,
    liquidity: num(m.liquidity) ?? (typeof event.liquidity === 'number' ? event.liquidity : num(event.liquidity)),
    volume: num(m.volume) ?? (typeof event.volume === 'number' ? event.volume : num(event.volume)),
    closeTime: m.endDate || event.endDate || null,
    status: m.closed || event.closed ? 'closed' : 'open',
    rules: m.description || event.description || null,
    url: `https://polymarket.com/event/${event.slug || m.slug}`,
    ref: { yesToken: ids[0], noToken: ids[1] },
  }
}

/** Preferred pinned slug from env (Vite, public — a slug is not a secret). */
function pinnedSlug(): string {
  try {
    return ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_POLYMARKET_MARKET_SLUG ?? '').trim()
  } catch {
    return ''
  }
}

export async function discoverPolyMarket(): Promise<PredictionMarket> {
  const pinned = pinnedSlug()
  if (pinned) {
    const found = await getPolyEvent(pinned)
    if (found) return found
    throw new Error(`Pinned market '${pinned}' not found or closed — clear VITE_POLYMARKET_MARKET_SLUG to auto-discover.`)
  }
  const events = await fwdGet<GammaEventRaw[]>('gamma', '/events', { active: 'true', closed: 'false', limit: '30' })
  if (!Array.isArray(events) || events.length === 0) throw new Error('No open Polymarket events found.')
  const btc = events.filter((e) => /bitcoin|\bbtc\b/i.test(`${e.title} ${(e.markets ?? []).map((m) => m.question).join(' ')}`))
  const ordered = [...btc, ...events.filter((e) => !btc.includes(e))]
  for (const e of ordered) {
    const m = pickMarket(e)
    if (m) return toPredictionMarket(e, m)
  }
  throw new Error('No tradable binary market found on Polymarket right now.')
}

export async function getPolyEvent(slug: string): Promise<PredictionMarket | null> {
  const events = await fwdGet<GammaEventRaw[]>('gamma', '/events', { slug })
  const e = Array.isArray(events) ? events[0] : null
  if (!e || e.closed || e.archived) return null
  const m = pickMarket(e)
  return m ? toPredictionMarket(e, m) : null
}

/* ---------- books & prices (public) ---------- */

interface ClobBookRaw {
  market: string
  asset_id: string
  bids: Array<{ price: string; size: string }>
  asks: Array<{ price: string; size: string }>
  timestamp?: string
}

function levels(raw: Array<{ price: string; size: string }> | undefined, desc: boolean): PredictBookLevel[] {
  const list = (raw ?? [])
    .map((l) => ({ price: Number(l.price), size: Number(l.size) }))
    .filter((l) => isFinite(l.price) && isFinite(l.size) && l.size > 0)
  list.sort((a, b) => (desc ? b.price - a.price : a.price - b.price))
  return list.slice(0, 8)
}

function complement(levelsIn: PredictBookLevel[]): PredictBookLevel[] {
  // NO book ≈ 1 − YES book (same liquidity, mirrored price)
  return levelsIn.map((l) => ({ price: Number((1 - l.price).toFixed(4)), size: l.size }))
}

export async function getPolyBook(market: PredictionMarket): Promise<PredictBook> {
  const yesToken = market.ref.yesToken
  const noToken = market.ref.noToken
  if (!yesToken || !noToken) throw new Error('Market has no CLOB token ids.')
  const [yes, no] = await Promise.all([
    fwdGet<ClobBookRaw>('clob', '/book', { token_id: yesToken }).catch(() => null),
    fwdGet<ClobBookRaw>('clob', '/book', { token_id: noToken }).catch(() => null),
  ])
  const yesBids = levels(yes?.bids, true)
  const yesAsks = levels(yes?.asks, false)
  // Prefer the native NO book; fall back to the mirrored YES book.
  const noBids = no ? levels(no.bids, true) : complement(yesAsks).reverse()
  const noAsks = no ? levels(no.asks, false) : complement(yesBids).reverse()
  return { yesBids, yesAsks, noBids, noAsks }
}

export function bookTops(book: PredictBook): Pick<PredictionMarket, 'yesBid' | 'yesAsk' | 'noBid' | 'noAsk' | 'yesPrice' | 'noPrice'> {
  const yesBid = book.yesBids[0]?.price ?? null
  const yesAsk = book.yesAsks[0]?.price ?? null
  const noBid = book.noBids[0]?.price ?? null
  const noAsk = book.noAsks[0]?.price ?? null
  const yesPrice = yesBid != null && yesAsk != null ? (yesBid + yesAsk) / 2 : (yesBid ?? yesAsk ?? null)
  const noPrice = noBid != null && noAsk != null ? (noBid + noAsk) / 2 : (noBid ?? noAsk ?? null)
  return { yesBid, yesAsk, noBid, noAsk, yesPrice, noPrice }
}

/* ---------- wallet + SDK ---------- */

export const POLY_USDC = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as Address
export const POLY_CTF = '0x4D97DCd97eC945f40cF65F87097ACe5EA047604' as Address
export const POLY_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E' as Address
export const POLY_EXCHANGE_NEGRISK = '0xC5d563A36AE78145C45a50134d48A1215220f80a' as Address

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
}

function eip1193(): Eip1193 {
  const w = window.ethereum as Eip1193 | undefined
  if (!w) throw new Error('No EVM wallet found — connect MetaMask on Polygon to trade Polymarket.')
  return w
}

export async function polyWalletClient(address: Address) {
  return createWalletClient({ chain: polygon, transport: custom(eip1193()), account: address })
}

function sdkHost(): string {
  // The SDK builds `${host}/order` etc — point it at our forwarder.
  return `${PROXY}/clob`
}

export async function derivePolyCreds(address: Address): Promise<PolyAuth['creds']> {
  const client = new ClobClient(sdkHost(), Chain.POLYGON, await polyWalletClient(address), undefined, 0, address)
  let creds: { key: string; secret: string; passphrase: string }
  try {
    creds = await client.createOrDeriveApiKey()
  } catch (e) {
    const raw = String((e as Error).message ?? e).slice(0, 400)
    // Surface upstream Geo/derivation details instead of swallowing behind generic
    throw new Error(`Derive failed — ${mapPolyError(raw)} — raw: ${raw.slice(0, 200)}`)
  }
  if (!creds?.key || !creds?.secret || !creds?.passphrase) {
    throw new Error(`Polymarket refused API credentials for this wallet (empty ${JSON.stringify(creds ?? {})}). Try: ensure wallet is on Polygon, sign the EIP-712 prompt, and that your region is not geo-blocked (Polymarket enforces closed-only in some regions).`)
  }
  return { key: creds.key, secret: creds.secret, passphrase: creds.passphrase }
}

async function authedClient(auth: PolyAuth) {
  const client = new ClobClient(
    sdkHost(),
    Chain.POLYGON,
    await polyWalletClient(auth.address as Address),
    { key: auth.creds.key, secret: auth.creds.secret, passphrase: auth.creds.passphrase },
    0,
    auth.address as Address,
  )
  return client
}

function rpcForPolygon() {
  return createPublicClient({ transport: http(evmChain(137).rpcs[0]) })
}

export async function polyUsdcBalance(owner: Address): Promise<number | null> {
  try {
    const pc = rpcForPolygon()
    const raw = (await pc.readContract({ address: POLY_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })) as bigint
    return Number(raw) / 1e6
  } catch {
    return null
  }
}

export async function polyAllowance(owner: Address, token: Address, spender: Address): Promise<bigint> {
  const pc = rpcForPolygon()
  return (await pc.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] })) as bigint
}

export function polyExchangeFor(negRisk: boolean): Address {
  return negRisk ? POLY_EXCHANGE_NEGRISK : POLY_EXCHANGE
}

export async function polyIsNegRisk(tokenId: string): Promise<boolean> {
  try {
    const j = await fwdGet<{ neg_risk?: boolean }>('clob', '/neg-risk', { token_id: tokenId })
    return j.neg_risk === true
  } catch {
    return false
  }
}

/* ---------- orders / positions ---------- */

function mapPolyOrderStatus(s: string): PredictOrderStatus {
  const t = s.toLowerCase()
  if (t.includes('cancel')) return 'canceled'
  if (t.includes('fill') && !t.includes('partial')) return 'filled'
  if (t.includes('partial')) return 'partial'
  if (t.includes('live') || t.includes('open') || t.includes('rest')) return 'resting'
  if (t.includes('reject') || t.includes('fail') || t.includes('error')) return 'rejected'
  return 'unknown'
}

interface PolyOrderRaw {
  id?: string
  status?: string
  outcome?: string
  side?: string
  price?: string
  original_size?: string
  size_matched?: string
  created_at?: number
}

function normalizeTs(v: unknown): number | null {
  const n = Number(v)
  if (!isFinite(n) || n <= 0) return null
  // CLOB uses seconds; normalize to ms if needed
  return n < 2e12 ? n * 1000 : n
}

function toNormalized(providerMarket: PredictionMarket, o: PolyOrderRaw): NormalizedOrder {
  const size = Number(o.original_size ?? 0)
  const matched = Number(o.size_matched ?? 0)
  const status = mapPolyOrderStatus(String(o.status ?? ''))
  return {
    provider: 'polymarket',
    marketId: providerMarket.marketId,
    orderId: String(o.id ?? ''),
    outcome: /no/i.test(String(o.outcome ?? '')) ? 'NO' : 'YES',
    side: 'BUY',
    price: Number(o.price ?? 0),
    size,
    notional: size * Number(o.price ?? 0),
    status,
    filledQty: matched,
    remainingQty: Math.max(0, size - matched),
    ts: normalizeTs(o.created_at),
  }
}

export function mapPolyError(msg: string): string {
  const m = msg.slice(0, 350)
  if (/user rejected|denied|4001|action_rejected/i.test(m)) return 'You rejected the signature in your wallet.'
  if (/allowance|approve|erc20/i.test(m)) return 'USDC allowance missing — approve the exchange contract first.'
  if (/balance|funds|insufficient/i.test(m)) return 'Insufficient USDC on Polygon — deposit via polymarket.com first.'
  if (/geo|blocked|restricted|ban/i.test(m)) return 'Polymarket restricted this region/account — order refused upstream.'
  if (/tick|price.*invalid|min.*size|notional/i.test(m)) return 'Order rejected by the book (price/size) — adjust and retry.'
  return m
}

export const PolymarketProvider = {
  id: 'polymarket' as const,
  label: 'POLYMARKET',
  discoverMarket: discoverPolyMarket,
  getMarket: async (marketId: string) => {
    const m = await getPolyEvent(marketId)
    if (!m) throw new Error('Polymarket market not found or closed.')
    return m
  },
  getOrderBook: getPolyBook,
  getBalance: async (auth: PolyAuth | KalshiAuth | null) => {
    if (!auth || !('secret' in auth)) return { provider: 'polymarket' as const, available: null }
    const bal = await polyUsdcBalance((auth as PolyAuth).address as Address)
    return { provider: 'polymarket' as const, available: bal }
  },
  getPositions: async (auth: PolyAuth | KalshiAuth | null, market: PredictionMarket) => {
    if (!auth || !('secret' in auth)) return []
    const a = auth as PolyAuth
    const list = await fwdGet<Array<{ asset?: string; size?: number; avgPrice?: number; curPrice?: number; initialValue?: number; currentValue?: number }>>(
      'data',
      '/positions',
      { user: a.address },
    ).catch(() => [])
    const out = []
     for (const p of list ?? []) {
       const yes = p.asset === market.ref.yesToken
       const no = p.asset === market.ref.noToken
       if (!yes && !no) continue
       const size = Number(p.size ?? 0)
       if (!isFinite(size) || size === 0) continue
       const avg = Number(p.avgPrice ?? 0)
       const cur = Number(p.curPrice ?? NaN)
       const value = Number(p.currentValue ?? NaN)
       out.push({
         provider: 'polymarket' as const,
         marketId: market.marketId,
         title: market.title,
         outcome: (yes ? 'YES' : 'NO') as 'YES' | 'NO',
         size,
         avgPrice: avg,
         curPrice: isFinite(cur) ? cur : null,
         value: isFinite(value) ? value : null,
         pnl: isFinite(value) ? value - size * avg : null,
       })
     }
    return out
  },
  getOrders: async (auth: PolyAuth | KalshiAuth | null, market: PredictionMarket) => {
    if (!auth || !('secret' in auth)) return []
    const client = await authedClient(auth as PolyAuth)
    const list = (await client.getOpenOrders({}).catch(() => [])) as PolyOrderRaw[]
    return (Array.isArray(list) ? list : []).map((o) => toNormalized(market, o))
  },
  placeOrder: async (auth: PolyAuth | KalshiAuth, args: import('./types').PredictPlaceArgs) => {
    const a = auth as PolyAuth
    if (!a?.creds) throw new Error('Connect + derive Polymarket API credentials first.')
    const client = await authedClient(a)
    const tokenId = args.outcome === 'YES' ? args.market.ref.yesToken : args.market.ref.noToken
    if (!tokenId) throw new Error('Market has no token for this outcome.')
    try {
      let res: { success?: boolean; orderID?: string; errorMsg?: string; error?: string }
      if (args.isMarket) {
        // market order: FOK through the book by USD notional
        const signed = await client.createMarketOrder({
          tokenID: tokenId,
          amount: args.price * args.size,
          side: Side.BUY,
        })
        res = await client.postOrder(signed, OrderType.FOK)
      } else {
        const signed = await client.createOrder({
          tokenID: tokenId,
          price: args.price,
          size: args.size,
          side: Side.BUY,
        })
        res = await client.postOrder(signed, OrderType.GTC)
      }
      const id = String(res?.orderID ?? '')
      if (!res?.success || !id || id === 'undefined') throw new Error(res?.errorMsg ?? res?.error ?? 'Polymarket refused the order.')
      return id
    } catch (e) {
      throw new Error(mapPolyError(String((e as Error).message ?? e)), { cause: e })
    }
  },
  getOrder: async (auth: PolyAuth | KalshiAuth, market: PredictionMarket, orderId: string) => {
    const client = await authedClient(auth as PolyAuth)
    const o = (await client.getOrder(orderId)) as PolyOrderRaw
    if (!o || !o.id) throw new Error('Order not found.')
    return toNormalized(market, o)
  },
  cancelOrder: async (auth: PolyAuth | KalshiAuth, market: PredictionMarket, orderId: string) => {
    const client = await authedClient(auth as PolyAuth)
    await client.cancelOrder({ orderID: orderId })
    void market
    return `CANCELED #${orderId}`
  },
  } satisfies import('./types').PredictProvider
