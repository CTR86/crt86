/* ============================================================
   Hyperliquid wire builders — pure functions mirroring the official
   Python SDK (hyperliquid/utils/signing.py) EXACTLY. Key insertion
   order matters (msgpack maps are hashed), so every builder below
   constructs keys in SDK order: a,b,p,s,r,t[,c] / type,orders,
   grouping. Nothing here touches the network (fully unit-tested).
   ============================================================ */

export type HlTif = 'Alo' | 'Ioc' | 'Gtc'

export interface HlOrderWire {
  a: number
  b: boolean
  p: string
  s: string
  r: boolean
  t: { limit: { tif: HlTif } } | { trigger: { isMarket: boolean; triggerPx: string; tpsl: 'tp' | 'sl' } }
  c?: string
}

/** float_to_wire from the SDK: 8-decimal max, normalized, no trailing zeros. */
export function floatToWire(x: number): string {
  if (!isFinite(x)) throw new Error('Invalid price/size — not a number.')
  const rounded = Number(x.toFixed(8))
  if (Math.abs(rounded - x) >= 1e-12) throw new Error('Price/size has more than 8 decimals — tighten it.')
  let s = rounded.toFixed(8).replace(/\.?0+$/, '')
  if (s === '-0' || s === '' || s === '-0.') s = '0'
  return s
}

/** Round a human size DOWN to the asset's lot step (never overbuys). */
export function floorToDecimals(x: number, decimals: number): number {
  if (!isFinite(x) || x <= 0) throw new Error('Size must be greater than zero.')
  const f = 10 ** decimals
  const v = Math.floor(x * f + 1e-9) / f
  if (v <= 0) throw new Error('Size below minimum lot — raise the USD amount.')
  return v
}

/**
 * Limit price formatter. The chain enforces tick granularity
 * server-side (rejection is loud and safe); we cap at 5 decimals
 * to stay inside every documented tick band.
 */
export function formatLimitPx(px: number): string {
  if (!isFinite(px) || px <= 0) throw new Error('Invalid limit price.')
  return floatToWire(Number(px.toFixed(5)))
}

const CLOID_RE = /^0x[0-9a-fA-F]{32}$/

export function randomCloid(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return '0x' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export function buildOrderWire(args: {
  asset: number
  isBuy: boolean
  limitPx: number
  size: number
  reduceOnly: boolean
  tif: HlTif
  cloid?: string
}): HlOrderWire {
  if (args.cloid != null && !CLOID_RE.test(args.cloid)) throw new Error('Invalid client order id.')
  const w: HlOrderWire = {
    a: args.asset,
    b: args.isBuy,
    p: floatToWire(args.limitPx),
    s: floatToWire(args.size),
    r: args.reduceOnly,
    t: { limit: { tif: args.tif } },
  }
  if (args.cloid != null) w.c = args.cloid
  return w
}

export function buildTriggerWire(args: {
  asset: number
  isBuy: boolean
  triggerPx: number
  size: number
  reduceOnly: boolean
  isMarket: boolean
  tpsl: 'tp' | 'sl'
  cloid?: string
}): HlOrderWire {
  const w: HlOrderWire = {
    a: args.asset,
    b: args.isBuy,
    p: floatToWire(args.triggerPx),
    s: floatToWire(args.size),
    r: args.reduceOnly,
    t: { trigger: { isMarket: args.isMarket, triggerPx: floatToWire(args.triggerPx), tpsl: args.tpsl } },
  }
  if (args.cloid != null) {
    if (!CLOID_RE.test(args.cloid)) throw new Error('Invalid client order id.')
    w.c = args.cloid
  }
  return w
}

export interface HlOrderAction {
  type: 'order'
  orders: HlOrderWire[]
  grouping: 'na'
}

export function buildOrderAction(wires: HlOrderWire[]): HlOrderAction {
  if (wires.length === 0) throw new Error('No orders to place.')
  return { type: 'order', orders: wires, grouping: 'na' }
}

export interface HlCancelAction {
  type: 'cancel'
  cancels: Array<{ a: number; o: number }>
}

export function buildCancelAction(asset: number, oid: number): HlCancelAction {
  if (!Number.isInteger(oid) || oid <= 0) throw new Error('Invalid order id.')
  return { type: 'cancel', cancels: [{ a: asset, o: oid }] }
}

export interface HlLeverageAction {
  type: 'updateLeverage'
  asset: number
  isCross: boolean
  leverage: number
}

export function buildLeverageAction(asset: number, leverage: number): HlLeverageAction {
  if (!Number.isInteger(leverage) || leverage < 1) throw new Error('Leverage must be an integer ≥ 1.')
  return { type: 'updateLeverage', asset, isCross: true, leverage }
}

export interface HlApproveAgentAction {
  type: 'approveAgent'
  hyperliquidChain: string
  signatureChainId: string
  agentAddress: string
  agentName: string
  nonce: number
}

export function buildApproveAgentAction(args: {
  testnet: boolean
  agentAddress: string
  agentName: string
  nonce: number
}): HlApproveAgentAction {
  if (!/^0x[0-9a-fA-F]{40}$/.test(args.agentAddress)) throw new Error('Invalid agent address.')
  return {
    type: 'approveAgent',
    hyperliquidChain: args.testnet ? 'Testnet' : 'Mainnet',
    signatureChainId: '0x66eee',
    agentAddress: args.agentAddress.toLowerCase(),
    agentName: args.agentName,
    nonce: args.nonce,
  }
}

/* ---------- exchange response parsing (honest, never fabricated) ---------- */

export type HlOrderStatus =
  | { kind: 'resting'; oid: number }
  | { kind: 'filled'; oid: number; avgPx: string; totalSz: string }
  | { kind: 'error'; message: string }

export function parseOrderStatuses(json: unknown): HlOrderStatus[] {
  const data = (json as { response?: { data?: { statuses?: unknown[] } } })?.response?.data
  const list = data?.statuses
  if (!Array.isArray(list)) {
    const err =
      (json as { response?: unknown })?.response != null
        ? JSON.stringify((json as { response?: unknown }).response).slice(0, 200)
        : 'Hyperliquid returned no order status.'
    throw new Error(err.startsWith('{') ? `Order rejected: ${err}` : err)
  }
  return list.map((s) => {
    const o = s as Record<string, unknown>
    if (o.resting && typeof (o.resting as { oid?: number }).oid === 'number') {
      return { kind: 'resting', oid: (o.resting as { oid: number }).oid }
    }
    if (o.filled) {
      const f = o.filled as { oid?: number; avgPx?: string; totalSz?: string }
      return { kind: 'filled', oid: Number(f.oid), avgPx: String(f.avgPx ?? '?'), totalSz: String(f.totalSz ?? '?') }
    }
    if (typeof o.error === 'string') return { kind: 'error', message: o.error }
    return { kind: 'error', message: JSON.stringify(s).slice(0, 160) }
  })
}

export function assertOkResponse(json: unknown, what: string): void {
  const j = json as { status?: string; response?: unknown }
  if (j?.status !== 'ok') {
    throw new Error(`${what} failed: ${JSON.stringify(j?.response ?? j).slice(0, 200)}`)
  }
  if (typeof j.response === 'string') throw new Error(`${what} failed: ${j.response.slice(0, 200)}`)
}
