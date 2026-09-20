/* ============================================================
   Aster perp client — browser-direct (CORS * verified).
   Auth is EIP-712, NOT an API key: every TRADE/USER_DATA request
   carries user (main wallet) + signer (agent address) + nonce
   (microseconds), with the url-encoded params signed by the AGENT
   key as Message {msg} under domain AsterSignTransaction v1
   (chainId 1666 mainnet / 714 testnet). Verified against the
   official V3 docs + testnet doc. Agent key lives in localStorage,
   signs locally via viem, never leaves the browser.
   Since 2026-09-01, order/account endpoints need a funded main
   wallet (error -5050 otherwise) — surfaced honestly.
   ============================================================ */

import type { Hex } from 'viem'
import type {
  AsterAuth,
  PerpAccount,
  PerpMarket,
  PerpNetwork,
  PerpOpenOrder,
  PerpPlaceArgs,
  PerpPosition,
  PerpProvider,
} from './types'

const BASE: Record<PerpNetwork, string> = {
  mainnet: 'https://fapi.asterdex.com',
  testnet: 'https://fapi.asterdex-testnet.com',
}

const CHAIN_ID: Record<PerpNetwork, number> = { mainnet: 1666, testnet: 714 }

let lastMs = 0
let msCounter = 0
function nextNonce(): string {
  const now = Date.now()
  if (now === lastMs) msCounter += 1
  else {
    lastMs = now
    msCounter = 0
  }
  return String(now * 1_000_000 + msCounter)
}

function encodeParams(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

async function signParams(net: PerpNetwork, agentKey: Hex, params: Record<string, string>): Promise<string> {
  const { privateKeyToAccount } = await import('viem/accounts')
  const account = privateKeyToAccount(agentKey)
  const msg = encodeParams(params)
  return account.signTypedData({
    domain: {
      name: 'AsterSignTransaction',
      version: '1',
      chainId: CHAIN_ID[net],
      verifyingContract: '0x0000000000000000000000000000000000000000',
    },
    types: { Message: [{ name: 'msg', type: 'string' }] },
    primaryType: 'Message',
    message: { msg },
  })
}

function asterError(json: unknown, fallback: string): Error {
  const j = json as { code?: number; msg?: string } | null
  if (j && typeof j.code === 'number' && j.code !== 200) {
    if (j.code === -5050) {
      return new Error('Aster needs a funded wallet first — deposit once on Aster, then trade (testnet faucet for testnet).')
    }
    return new Error(`Aster: ${j.msg ?? 'request rejected'} (code ${j.code})`.slice(0, 250))
  }
  return new Error(fallback)
}

/** Signed request. GET/DELETE → signed query string; POST/PUT → signed form body. */
async function asterSigned<T>(
  net: PerpNetwork,
  auth: AsterAuth,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const { privateKeyToAccount } = await import('viem/accounts')
  const signer = privateKeyToAccount(auth.agentKey as Hex).address
  const full = { ...params, user: auth.user, signer, nonce: nextNonce() }
  const signature = await signParams(net, auth.agentKey as Hex, full)
  const base = `${BASE[net]}${path}`
  let r: Response
  if (method === 'POST' || method === 'PUT') {
    r = await fetch(base, {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: `${encodeParams(full)}&signature=${signature}`,
      signal: AbortSignal.timeout(20_000),
    })
  } else {
    // GET + DELETE carry signed params in the query string.
    r = await fetch(`${base}?${encodeParams(full)}&signature=${signature}`, {
      method,
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
  }
  const j = await r.json().catch(() => null)
  if (!r.ok) throw asterError(j, `Aster HTTP ${r.status}`)
  if (j && typeof (j as { code?: number }).code === 'number' && (j as { code: number }).code !== 200) {
    throw asterError(j, 'Aster rejected the request.')
  }
  return j as T
}

async function asterPublic<T>(net: PerpNetwork, path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = encodeParams(params)
  const r = await fetch(`${BASE[net]}${path}${qs ? `?${qs}` : ''}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!r.ok) throw new Error(`Aster HTTP ${r.status}`)
  return (await r.json()) as T
}

/* ---------- markets (public) ---------- */

interface AsterSymbolFilter {
  filterType: string
  tickSize?: string
  stepSize?: string
  minQty?: string
  notional?: string
}

interface AsterSymbol {
  symbol: string
  status: string
  contractType: string
  orderType?: string[]
  filters: AsterSymbolFilter[]
}

function filterOf(filters: AsterSymbolFilter[], t: string): AsterSymbolFilter | undefined {
  return filters.find((f) => f.filterType === t)
}

export function roundDownToStep(qty: number, step: number): number {
  if (!isFinite(qty) || qty <= 0) throw new Error('Size must be greater than zero.')
  if (!isFinite(step) || step <= 0) return qty
  const v = Math.floor(qty / step + 1e-9) * step
  // kill float dust (e.g. 0.30000000004)
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)))
  const clean = Number(v.toFixed(Math.min(decimals + 2, 12)))
  if (clean <= 0) throw new Error('Size below minimum lot — raise the USD amount.')
  return clean
}

export function roundToTick(px: number, tick: number): number {
  if (!isFinite(px) || px <= 0) throw new Error('Invalid price.')
  if (!isFinite(tick) || tick <= 0) return px
  const v = Math.round(px / tick) * tick
  const decimals = Math.max(0, Math.ceil(-Math.log10(tick)))
  return Number(v.toFixed(Math.min(decimals + 2, 12)))
}

export interface AsterMarketMeta extends PerpMarket {
  tickSize: number
  stepSize: number
}

const asterMarketsCache = new Map<PerpNetwork, { at: number; markets: AsterMarketMeta[] }>()

export async function fetchAsterMarkets(net: PerpNetwork): Promise<AsterMarketMeta[]> {
  const hit = asterMarketsCache.get(net)
  if (hit && Date.now() - hit.at < 60_000) return hit.markets
  const [info, prices, marks] = await Promise.all([
    asterPublic<{ symbols: AsterSymbol[] }>(net, '/fapi/v3/exchangeInfo'),
    asterPublic<Array<{ symbol: string; price: string }>>(net, '/fapi/v3/ticker/price').catch(() => []),
    asterPublic<Array<{ symbol: string; markPrice: string; lastFundingRate: string }>>(net, '/fapi/v3/premiumIndex').catch(
      () => [],
    ),
  ])
  const priceBy = new Map(prices.map((p) => [p.symbol, Number(p.price)]))
  const markBy = new Map(marks.map((m) => [m.symbol, m]))
  const markets: AsterMarketMeta[] = []
  for (const s of info.symbols ?? []) {
    if (s.status !== 'TRADING' || s.contractType !== 'PERPETUAL') continue
    const tickSize = Number(filterOf(s.filters, 'PRICE_FILTER')?.tickSize ?? 0)
    const stepSize = Number(filterOf(s.filters, 'LOT_SIZE')?.stepSize ?? 0)
    const minNotional = Number(filterOf(s.filters, 'MIN_NOTIONAL')?.notional ?? 5)
    const mark = markBy.get(s.symbol)
    const markPx = mark ? Number(mark.markPrice) : (priceBy.get(s.symbol) ?? NaN)
    const funding = mark ? Number(mark.lastFundingRate) : NaN
    const stepDec = stepSize > 0 ? Math.max(0, Math.ceil(-Math.log10(stepSize))) : 8
    markets.push({
      venue: 'aster',
      symbol: s.symbol,
      mark: isFinite(markPx) ? markPx : null,
      funding: isFinite(funding) ? funding : null,
      maxLeverage: 125,
      sizeDecimals: Math.min(stepDec, 8),
      minNotional: isFinite(minNotional) && minNotional > 0 ? minNotional : 5,
      ref: s.symbol,
      tickSize: tickSize > 0 ? tickSize : 0,
      stepSize: stepSize > 0 ? stepSize : 0,
    })
  }
  asterMarketsCache.set(net, { at: Date.now(), markets })
  return markets
}

/* ---------- account / positions / orders ---------- */

export async function fetchAsterAccount(net: PerpNetwork, auth: AsterAuth): Promise<PerpAccount> {
  const j = await asterSigned<{
    totalMarginBalance?: string
    availableBalance?: string
  }>(net, auth, 'GET', '/fapi/v3/account', { timestamp: String(Date.now()), recvWindow: '5000' })
  const equity = Number(j.totalMarginBalance)
  const avail = Number(j.availableBalance)
  return {
    venue: 'aster',
    equity: isFinite(equity) ? equity : null,
    available: isFinite(avail) ? avail : null,
  }
}

interface AsterPosRaw {
  symbol: string
  positionAmt: string
  entryPrice: string
  unrealizedProfit: string
  leverage: string
  markPrice?: string
}

export async function fetchAsterPositions(net: PerpNetwork, auth: AsterAuth): Promise<PerpPosition[]> {
  const list = await asterSigned<AsterPosRaw[]>(net, auth, 'GET', '/fapi/v3/positionRisk', {
    timestamp: String(Date.now()),
    recvWindow: '5000',
  })
  const out: PerpPosition[] = []
  for (const p of list ?? []) {
    const amt = Number(p.positionAmt)
    if (!isFinite(amt) || amt === 0) continue
    const mark = p.markPrice != null ? Number(p.markPrice) : NaN
    out.push({
      venue: 'aster',
      symbol: p.symbol,
      side: amt > 0 ? 'LONG' : 'SHORT',
      size: Math.abs(amt),
      entryPx: Number(p.entryPrice) || 0,
      markPx: isFinite(mark) ? mark : null,
      upnl: Number(p.unrealizedProfit) || 0,
      leverage: Number(p.leverage) || 0,
    })
  }
  return out
}

interface AsterOrderRaw {
  orderId: number
  symbol: string
  side: 'BUY' | 'SELL'
  price: string
  origQty: string
  type: string
  status: string
  reduceOnly: boolean
}

export async function fetchAsterOpenOrders(net: PerpNetwork, auth: AsterAuth, symbol?: string): Promise<PerpOpenOrder[]> {
  const list = await asterSigned<AsterOrderRaw[]>(net, auth, 'GET', '/fapi/v3/openOrders', {
    ...(symbol ? { symbol } : {}),
    timestamp: String(Date.now()),
    recvWindow: '5000',
  })
  return (list ?? []).map((o) => ({
    venue: 'aster' as const,
    symbol: o.symbol,
    orderId: String(o.orderId),
    side: o.side,
    price: Number(o.price),
    size: Number(o.origQty),
    reduceOnly: o.reduceOnly === true,
  }))
}

/* ---------- trading ---------- */

export async function asterSetLeverage(
  net: PerpNetwork,
  auth: AsterAuth,
  symbol: string,
  leverage: number,
): Promise<void> {
  const lev = Math.max(1, Math.min(125, Math.floor(leverage)))
  await asterSigned(net, auth, 'POST', '/fapi/v3/leverage', {
    symbol,
    leverage: String(lev),
    timestamp: String(Date.now()),
    recvWindow: '5000',
  })
}

interface AsterOrderResp {
  orderId: number
  status: string
  executedQty?: string
  avgPrice?: string
}

export function mapAsterError(msg: string): string {
  const m = msg.slice(0, 300)
  if (/-5050|only be used after deposit/i.test(m)) {
    return 'Aster needs a funded wallet first — deposit once on Aster, then trade (testnet faucet for testnet).'
  }
  if (/insufficient|balance/i.test(m)) return 'Insufficient margin — reduce size/leverage or top up.'
  if (/min_notional|notional|MIN_NOTIONAL/i.test(m)) return 'Below minimum notional — raise size.'
  if (/lot_size|LOT_SIZE|stepSize|tick/i.test(m)) return 'Size/price rejected by symbol filters — retry (rounded automatically).'
  if (/leverage/i.test(m)) return 'Leverage rejected — exceeds this market’s max.'
  if (/timed out|timeout|failed to fetch|network/i.test(m)) return 'Network hiccup reaching Aster — retry.'
  return m
}

export async function asterPlaceOrder(
  net: PerpNetwork,
  auth: AsterAuth,
  args: PerpPlaceArgs,
  log?: (l: string) => void,
): Promise<string> {
  const meta = args.market as AsterMarketMeta
  if (args.sizeBase <= 0) throw new Error('Size must be greater than zero.')
  const qty = roundDownToStep(args.sizeBase, meta.stepSize || 10 ** -meta.sizeDecimals)
  await asterSetLeverage(net, auth, args.market.symbol, args.leverage)
  log?.(`LEVERAGE ${Math.floor(args.leverage)}x SET`)
  const params: Record<string, string> =
    args.type === 'MARKET'
      ? { symbol: args.market.symbol, side: args.side === 'LONG' ? 'BUY' : 'SELL', type: 'MARKET', quantity: String(qty) }
      : {
          symbol: args.market.symbol,
          side: args.side === 'LONG' ? 'BUY' : 'SELL',
          type: 'LIMIT',
          timeInForce: 'GTC',
          quantity: String(qty),
          price: String(roundToTick(args.limitPx ?? 0, meta.tickSize || 0)),
        };
  if (args.reduceOnly) params.reduceOnly = 'true'
  try {
    const res = await asterSigned<AsterOrderResp>(net, auth, 'POST', '/fapi/v3/order', params)
    if (res.status === 'FILLED') return `FILLED ${res.executedQty} @ ${res.avgPrice} (#${res.orderId})`
    return `PLACED #${res.orderId} — ${res.status}`
  } catch (e) {
    throw new Error(mapAsterError(String((e as Error).message ?? e)), { cause: e })
  }
}

/** Reduce-only TP/SL stop-market orders on an open position. */
export async function asterPlaceTpSl(
  net: PerpNetwork,
  auth: AsterAuth,
  args: { market: AsterMarketMeta; position: PerpPosition; tpPx: number | null; slPx: number | null },
): Promise<string> {
  if (args.tpPx == null && args.slPx == null) throw new Error('Set a TP price, an SL price, or both.')
  const qty = roundDownToStep(args.position.size, args.market.stepSize || 10 ** -args.market.sizeDecimals)
  const side = args.position.side === 'LONG' ? 'SELL' : 'BUY'
  const placed: string[] = []
  const base = {
    symbol: args.position.symbol,
    side,
    quantity: String(qty),
    reduceOnly: 'true',
    timestamp: String(Date.now()),
    recvWindow: '5000',
  }
  if (args.tpPx != null) {
    if (!isFinite(args.tpPx) || args.tpPx <= 0) throw new Error('Invalid TP price.')
    const res = await asterSigned<AsterOrderResp>(net, auth, 'POST', '/fapi/v3/order', {
      ...base,
      type: 'TAKE_PROFIT_MARKET',
      stopPrice: String(roundToTick(args.tpPx, args.market.tickSize || 0)),
    })
    placed.push(`TP #${res.orderId}`)
  }
  if (args.slPx != null) {
    if (!isFinite(args.slPx) || args.slPx <= 0) throw new Error('Invalid SL price.')
    const res = await asterSigned<AsterOrderResp>(net, auth, 'POST', '/fapi/v3/order', {
      ...base,
      type: 'STOP_MARKET',
      stopPrice: String(roundToTick(args.slPx, args.market.tickSize || 0)),
      timestamp: String(Date.now()),
      recvWindow: '5000',
    })
    placed.push(`SL #${res.orderId}`)
  }
  return `TP/SL ARMED (${placed.join(', ')})`
}

/** User-data listenKey for live WS fills (signed, keep alive externally). */
export async function asterListenKey(net: PerpNetwork, auth: AsterAuth): Promise<string> {
  const j = await asterSigned<{ listenKey: string }>(net, auth, 'POST', '/fapi/v3/listenKey', {})
  if (!j?.listenKey) throw new Error('Aster refused the listen key.')
  return j.listenKey
}

export async function asterKeepaliveListenKey(net: PerpNetwork, auth: AsterAuth): Promise<void> {
  await asterSigned(net, auth, 'PUT', '/fapi/v3/listenKey', {}).catch(() => {})
  // A failed keepalive just means re-subscribe on next refresh.
}

export async function asterCancelOrder(net: PerpNetwork, auth: AsterAuth, symbol: string, orderId: string): Promise<string> {  await asterSigned(net, auth, 'DELETE', '/fapi/v3/order', {
    symbol,
    orderId,
    timestamp: String(Date.now()),
    recvWindow: '5000',
  })
  return `CANCELED ${symbol} #${orderId}`
}

export const AsterProvider: PerpProvider = {
  id: 'aster',
  label: 'ASTER',
  marketsLabel: 'PERP SYMBOLS',
  fetchMarkets: fetchAsterMarkets,
  fetchAccount: (net, auth) => fetchAsterAccount(net, auth as AsterAuth),
  fetchPositions: (net, auth) => fetchAsterPositions(net, auth as AsterAuth),
  fetchOpenOrders: (net, auth) => fetchAsterOpenOrders(net, auth as AsterAuth),
  placeOrder: (net, auth, args, log) => asterPlaceOrder(net, auth as AsterAuth, args, log),
  cancelOrder: (net, auth, order) => asterCancelOrder(net, auth as AsterAuth, order.symbol, order.orderId),
  placeTpSl: (net, auth, args) =>
    asterPlaceTpSl(net, auth as AsterAuth, {
      market: args.market as AsterMarketMeta,
      position: args.position,
      tpPx: args.tpPx,
      slPx: args.slPx,
    }),
  closePosition: async (net, auth, pos) => {
    const a = auth as AsterAuth
    const markets = await fetchAsterMarkets(net)
    const meta = markets.find((m) => m.symbol === pos.symbol)
    if (!meta) throw new Error(`Unknown market ${pos.symbol}.`)
    const qty = roundDownToStep(pos.size, meta.stepSize || 10 ** -meta.sizeDecimals)
    const res = await asterSigned<AsterOrderResp>(net, a, 'POST', '/fapi/v3/order', {
      symbol: pos.symbol,
      side: pos.side === 'LONG' ? 'SELL' : 'BUY',
      type: 'MARKET',
      quantity: String(qty),
      reduceOnly: 'true',
      timestamp: String(Date.now()),
      recvWindow: '5000',
    })
    return `CLOSED ${pos.symbol} (#${res.orderId} — ${res.status})`
  },
};
