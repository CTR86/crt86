/* ============================================================
   Hyperliquid perp client — browser-direct (CORS * verified).
   Info (market data, positions) needs no auth. Trading uses L1
   EIP-712 signatures constructed EXACTLY per the official Python
   SDK: keccak(msgpack(action) + nonceBE64 + vaultFlag) →
   phantom Agent {source a/b, connectionId} → sign typed data
   (domain Exchange/1/1337). Signed with the connected wallet per
   action, or silently with a local agent key approved on-chain
   via ApproveAgent. Nothing is fabricated; exchange rejections
   surface verbatim.
   Endpoints verified live (testnet): meta, allMids,
   metaAndAssetCtxs, clearinghouseState.
   ============================================================ */

import { encode } from '@msgpack/msgpack'
import { keccak256, parseSignature, toHex, type Address, type Hex } from 'viem'
import {
  assertOkResponse,
  buildCancelAction,
  buildLeverageAction,
  buildOrderAction,
  buildOrderWire,
  buildTriggerWire,
  floorToDecimals,
  formatLimitPx,
  parseOrderStatuses,
} from './hlWire'
import type {
  HlAuth,
  PerpAccount,
  PerpMarket,
  PerpNetwork,
  PerpOpenOrder,
  PerpPlaceArgs,
  PerpPosition,
  PerpProvider,
} from './types'

const BASE: Record<PerpNetwork, string> = {
  mainnet: 'https://api.hyperliquid.xyz',
  testnet: 'https://api.hyperliquid-testnet.xyz',
}

const HL_MIN_NOTIONAL = 10
const MARKET_SLIPPAGE = 0.02

let lastNonce = 0
function nextNonce(): number {
  const now = Date.now()
  lastNonce = Math.max(now, lastNonce + 1)
  return lastNonce
}

async function hlInfo<T>(net: PerpNetwork, payload: unknown): Promise<T> {
  const r = await fetch(`${BASE[net]}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  })
  if (!r.ok) throw new Error(`Hyperliquid info HTTP ${r.status}`)
  return (await r.json()) as T
}

interface HlMeta {
  universe: Array<{ name: string; szDecimals: number; maxLeverage: number }>
}

interface HlAssetCtx {
  funding: string
  markPx: string
  oraclePx: string
}

/* ---------- markets (public, cached 60s) ---------- */

const metaCache = new Map<PerpNetwork, { at: number; markets: PerpMarket[] }>()

export async function fetchHlMarkets(net: PerpNetwork): Promise<PerpMarket[]> {
  const hit = metaCache.get(net)
  if (hit && Date.now() - hit.at < 60_000) return hit.markets
  const [meta, ctxs] = await Promise.all([
    hlInfo<HlMeta>(net, { type: 'meta' }),
    hlInfo<[HlMeta, HlAssetCtx[]]>(net, { type: 'metaAndAssetCtxs' }).catch(() => null),
  ])
  const ctxByIdx = new Map<number, HlAssetCtx>()
  if (ctxs && Array.isArray(ctxs[1])) ctxs[1].forEach((c, i) => ctxByIdx.set(i, c))
  const markets: PerpMarket[] = meta.universe.map((u, i) => {
    const ctx = ctxByIdx.get(i)
    const mark = ctx?.markPx != null ? Number(ctx.markPx) : null
    const funding = ctx?.funding != null ? Number(ctx.funding) : null
    return {
      venue: 'hyperliquid' as const,
      symbol: u.name,
      mark: mark != null && isFinite(mark) ? mark : null,
      funding: funding != null && isFinite(funding) ? funding : null,
      maxLeverage: u.maxLeverage || 50,
      sizeDecimals: u.szDecimals,
      minNotional: HL_MIN_NOTIONAL,
      ref: i,
    }
  })
  metaCache.set(net, { at: Date.now(), markets })
  return markets
}

export async function hlAssetIndex(net: PerpNetwork, coin: string): Promise<number> {
  const markets = await fetchHlMarkets(net)
  const m = markets.find((x) => x.symbol === coin)
  if (!m) throw new Error(`Unknown Hyperliquid market ${coin}.`)
  return m.ref as number
}

/* ---------- account / positions / orders (public reads, any address) ---------- */

interface HlClearinghouse {
  marginSummary: { accountValue: string; totalMarginUsed: string }
  withdrawable: string
  assetPositions: Array<{
    type: string
    position: {
      coin: string
      szi: string
      entryPx: string
      unrealizedPnl: string
      leverage: { type: string; value: number }
    }
  }>
}

export async function fetchHlAccount(net: PerpNetwork, user: string): Promise<PerpAccount> {
  const st = await hlInfo<HlClearinghouse>(net, { type: 'clearinghouseState', user })
  const equity = Number(st.marginSummary?.accountValue)
  const avail = Number(st.withdrawable)
  return {
    venue: 'hyperliquid',
    equity: isFinite(equity) ? equity : null,
    available: isFinite(avail) ? avail : null,
  }
}

export async function fetchHlPositions(net: PerpNetwork, user: string): Promise<PerpPosition[]> {
  const [st, mids] = await Promise.all([
    hlInfo<HlClearinghouse>(net, { type: 'clearinghouseState', user }),
    hlInfo<Record<string, string>>(net, { type: 'allMids' }).catch((): Record<string, string> => ({})),
  ])
  const out: PerpPosition[] = []
  for (const ap of st.assetPositions ?? []) {
    const p = ap.position
    const size = Math.abs(Number(p.szi))
    if (!isFinite(size) || size === 0) continue
    const mark = mids[p.coin] != null ? Number(mids[p.coin]) : null
    out.push({
      venue: 'hyperliquid',
      symbol: p.coin,
      side: Number(p.szi) > 0 ? 'LONG' : 'SHORT',
      size,
      entryPx: Number(p.entryPx),
      markPx: mark != null && isFinite(mark) ? mark : null,
      upnl: Number(p.unrealizedPnl) || 0,
      leverage: Number(p.leverage?.value) || 0,
    })
  }
  return out
}

interface HlOpenOrderRaw {
  coin: string
  oid: number
  side: string
  limitPx: string
  sz: string
  reduceOnly: boolean
}

export async function fetchHlOpenOrders(net: PerpNetwork, user: string): Promise<PerpOpenOrder[]> {
  const list = await hlInfo<HlOpenOrderRaw[]>(net, { type: 'openOrders', user })
  return (list ?? []).map((o) => ({
    venue: 'hyperliquid' as const,
    symbol: o.coin,
    orderId: String(o.oid),
    side: o.side === 'A' ? ('SELL' as const) : ('BUY' as const),
    price: Number(o.limitPx),
    size: Number(o.sz),
    reduceOnly: o.reduceOnly === true,
  }))
}

/* ---------- L1 signing (exact SDK construction) ---------- */

export interface HlSignature {
  r: Hex
  s: Hex
  v: number
}

function splitSig(sigHex: string): HlSignature {
  const { r, s, v } = parseSignature(sigHex as Hex)
  if (r == null || s == null || v == null) throw new Error('Wallet returned a malformed signature.')
  return { r, s, v: Number(v) }
}

function actionHashBytes(action: unknown, nonce: number): Uint8Array {
  const packed = encode(action as Record<string, unknown>)
  const out = new Uint8Array(packed.length + 8 + 1)
  out.set(packed, 0)
  const view = new DataView(out.buffer)
  view.setBigUint64(packed.length, BigInt(nonce), false)
  out[packed.length + 8] = 0 // no vault
  return out
}

const HL_DOMAIN = {
  name: 'Exchange',
  version: '1',
  chainId: 1337,
  verifyingContract: '0x0000000000000000000000000000000000000000',
} as const

const AGENT_TYPES = {
  Agent: [
    { name: 'source', type: 'string' },
    { name: 'connectionId', type: 'bytes32' },
  ],
} as const

async function signAgentPayload(
  auth: HlAuth,
  source: string,
  connectionId: Hex,
): Promise<HlSignature> {
  if (auth.agentKey) {
    const { privateKeyToAccount } = await import('viem/accounts')
    const account = privateKeyToAccount(auth.agentKey as Hex)
    const sig = await account.signTypedData({
      domain: { ...HL_DOMAIN },
      types: { Agent: [...AGENT_TYPES.Agent] },
      primaryType: 'Agent',
      message: { source, connectionId },
    })
    return splitSig(sig)
  }
  const sig = await auth.ethRequest<string>('eth_signTypedData_v4', [
    auth.user,
    JSON.stringify({
      domain: HL_DOMAIN,
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        Agent: [
          { name: 'source', type: 'string' },
          { name: 'connectionId', type: 'bytes32' },
        ],
      },
      primaryType: 'Agent',
      message: { source, connectionId },
    }),
  ])
  return splitSig(sig)
}

/** Sign any L1 action. Returns the exact POST /exchange body. */
export async function hlSignL1(
  net: PerpNetwork,
  auth: HlAuth,
  action: unknown,
): Promise<{ action: unknown; nonce: number; signature: HlSignature }> {
  const nonce = nextNonce()
  const hash = keccak256(toHex(actionHashBytes(action, nonce)))
  const signature = await signAgentPayload(auth, net === 'mainnet' ? 'a' : 'b', hash)
  return { action, nonce, signature }
}

async function hlExchange(net: PerpNetwork, body: unknown): Promise<unknown> {
  const r = await fetch(`${BASE[net]}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) {
    const msg = (j as { error?: string } | null)?.error ?? `Hyperliquid exchange HTTP ${r.status}`
    throw new Error(String(msg).slice(0, 250))
  }
  return j
}

/* ---------- trading ---------- */

export function hlOrderPx(market: PerpMarket, side: 'LONG' | 'SHORT', type: 'MARKET' | 'LIMIT', limitPx?: number): { px: number; tif: 'Alo' | 'Ioc' | 'Gtc' } {
  if (market.mark == null || !isFinite(market.mark) || market.mark <= 0) {
    throw new Error(`No live mark price for ${market.symbol} — retry.`)
  }
  if (type === 'LIMIT') {
    if (limitPx == null || !isFinite(limitPx) || limitPx <= 0) throw new Error('Enter a limit price.')
    return { px: limitPx, tif: 'Gtc' }
  }
  const px = side === 'LONG' ? market.mark * (1 + MARKET_SLIPPAGE) : market.mark * (1 - MARKET_SLIPPAGE)
  return { px, tif: 'Ioc' }
}

async function ensureLeverage(
  net: PerpNetwork,
  auth: HlAuth,
  asset: number,
  leverage: number,
  maxLeverage: number,
  log?: (l: string) => void,
): Promise<void> {
  const lev = Math.min(Math.floor(leverage), maxLeverage)
  if (lev < 1) throw new Error('Leverage must be ≥ 1.')
  const action = buildLeverageAction(asset, lev)
  const signed = await hlSignL1(net, auth, action)
  const res = await hlExchange(net, signed)
  assertOkResponse(res, 'Set leverage')
  log?.(`LEVERAGE ${lev}x SET`)
}

export async function hlPlaceOrder(
  net: PerpNetwork,
  auth: HlAuth,
  args: PerpPlaceArgs,
  log?: (l: string) => void,
): Promise<string> {
  const asset = args.market.ref as number
  if (args.sizeBase <= 0) throw new Error('Size must be greater than zero.')
  const notional = args.sizeBase * (args.market.mark ?? 0)
  if (notional < args.market.minNotional) {
    throw new Error(`Below $${args.market.minNotional} minimum notional — raise size.`)
  }
  await ensureLeverage(net, auth, asset, args.leverage, args.market.maxLeverage, log)
  const { px, tif } = hlOrderPx(args.market, args.side, args.type, args.limitPx)
  const wire = buildOrderWire({
    asset,
    isBuy: args.side === 'LONG',
    limitPx: args.type === 'LIMIT' ? Number(formatLimitPx(px)) : px,
    size: args.sizeBase,
    reduceOnly: args.reduceOnly === true,
    tif,
  })
  const signed = await hlSignL1(net, auth, buildOrderAction([wire]))
  const res = await hlExchange(net, signed)
  const statuses = parseOrderStatuses(res)
  const s = statuses[0]
  if (s.kind === 'error') throw new Error(`Order rejected: ${s.message}`)
  if (s.kind === 'filled') return `FILLED ${s.totalSz} @ ${s.avgPx} (oid ${s.oid})`
  return `RESTING oid ${s.oid} — GTC limit on the book`
}

export async function hlCancelOrder(
  net: PerpNetwork,
  auth: HlAuth,
  order: PerpOpenOrder,
): Promise<string> {
  const asset = await hlAssetIndex(net, order.symbol)
  const action = buildCancelAction(asset, Number(order.orderId))
  const signed = await hlSignL1(net, auth, action)
  const res = await hlExchange(net, signed)
  assertOkResponse(res, 'Cancel')
  return `CANCELED ${order.symbol} #${order.orderId}`
}

export async function hlClosePosition(
  net: PerpNetwork,
  auth: HlAuth,
  pos: PerpPosition,
  markPx: number,
  leverage: number,
): Promise<string> {
  const markets = await fetchHlMarkets(net)
  const market = markets.find((m) => m.symbol === pos.symbol)
  if (!market) throw new Error(`Unknown market ${pos.symbol}.`)
  await ensureLeverage(net, auth, market.ref as number, leverage, market.maxLeverage)
  const isBuy = pos.side === 'SHORT'
  const px = isBuy ? markPx * (1 + MARKET_SLIPPAGE) : markPx * (1 - MARKET_SLIPPAGE)
  const wire = buildOrderWire({
    asset: market.ref as number,
    isBuy,
    limitPx: px,
    size: floorToDecimals(pos.size, market.sizeDecimals),
    reduceOnly: true,
    tif: 'Ioc',
  })
  const signed = await hlSignL1(net, auth, buildOrderAction([wire]))
  const res = await hlExchange(net, signed)
  const [s] = parseOrderStatuses(res)
  if (s.kind === 'error') throw new Error(`Close rejected: ${s.message}`)
  return s.kind === 'filled' ? `CLOSED @ ${s.avgPx}` : `CLOSE RESTING oid ${s.oid}`
}

/** Reduce-only TP/SL trigger orders on an open position (one signature, batched). */
export async function hlPlaceTpSl(
  net: PerpNetwork,
  auth: HlAuth,
  args: { market: PerpMarket; position: PerpPosition; tpPx: number | null; slPx: number | null },
): Promise<string> {
  const asset = args.market.ref as number
  if (args.tpPx == null && args.slPx == null) throw new Error('Set a TP price, an SL price, or both.')
  const isBuy = args.position.side === 'SHORT' // closing side
  const size = floorToDecimals(args.position.size, args.market.sizeDecimals)
  const wires = []
  if (args.tpPx != null) {
    if (!isFinite(args.tpPx) || args.tpPx <= 0) throw new Error('Invalid TP price.')
    wires.push(
      buildTriggerWire({
        asset,
        isBuy,
        triggerPx: args.tpPx,
        size,
        reduceOnly: true,
        isMarket: true,
        tpsl: 'tp',
      }),
    )
  }
  if (args.slPx != null) {
    if (!isFinite(args.slPx) || args.slPx <= 0) throw new Error('Invalid SL price.')
    wires.push(
      buildTriggerWire({
        asset,
        isBuy,
        triggerPx: args.slPx,
        size,
        reduceOnly: true,
        isMarket: true,
        tpsl: 'sl',
      }),
    )
  }
  const signed = await hlSignL1(net, auth, buildOrderAction(wires))
  const res = await hlExchange(net, signed)
  const statuses = parseOrderStatuses(res)
  const bad = statuses.find((s) => s.kind === 'error')
  if (bad && bad.kind === 'error') throw new Error(`TP/SL rejected: ${bad.message}`)
  return `TP/SL ARMED (${statuses.length} trigger${statuses.length > 1 ? 's' : ''} reduce-only)`
}

/* ---------- local agent (ApproveAgent via connected wallet) ---------- */

export async function hlCreateAgent(
  net: PerpNetwork,
  auth: HlAuth,
  agentName: string,
): Promise<{ agentAddress: Address; agentKey: Hex }> {
  const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts')
  const agentKey = generatePrivateKey()
  const agentAddress = privateKeyToAccount(agentKey).address
  const nonce = nextNonce()
  const action = {
    type: 'ApproveAgent',
    hyperliquidChain: net === 'mainnet' ? 'Mainnet' : 'Testnet',
    signatureChainId: '0x66eee',
    agentAddress: agentAddress.toLowerCase(),
    agentName: agentName.slice(0, 32),
    nonce,
  }
  const sig = await auth.ethRequest<string>('eth_signTypedData_v4', [
    auth.user,
    JSON.stringify({
      domain: {
        name: 'HyperliquidSignTransaction',
        version: '1',
        chainId: 421614,
        verifyingContract: '0x0000000000000000000000000000000000000000',
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        'HyperliquidTransaction:ApproveAgent': [
          { name: 'hyperliquidChain', type: 'string' },
          { name: 'agentAddress', type: 'address' },
          { name: 'agentName', type: 'string' },
          { name: 'nonce', type: 'uint64' },
        ],
      },
      primaryType: 'HyperliquidTransaction:ApproveAgent',
      message: action,
    }),
  ])
  const res = await hlExchange(net, { action, nonce, signature: splitSig(sig) })
  assertOkResponse(res, 'Approve agent')
  return { agentAddress, agentKey }
}

export function isHlRejection(msg: string): boolean {
  return /user rejected|user denied|user cancelled|user canceled|rejected the request|denied transaction|action_rejected|4001/i.test(msg)
}

export function mapHlError(msg: string): string {
  const m = msg.slice(0, 400)
  if (isHlRejection(m)) return 'You rejected the signature in your wallet.'
  if (/does not exist/i.test(m)) return 'Account not found on Hyperliquid — bridge USDC to HyperCore first (testnet faucet for testnet).'
  if (/insufficient|margin/i.test(m)) return 'Insufficient margin — reduce size/leverage or top up.'
  if (/minimum value/i.test(m)) return 'Below $10 minimum order value — raise size.'
  if (/leverage/i.test(m)) return 'Leverage rejected — exceeds this market’s max.'
  if (/reduce.only/i.test(m)) return 'Reduce-only rejected — no position to reduce.'
  if (/timed out|timeout|failed to fetch|network/i.test(m)) return 'Network hiccup reaching Hyperliquid — retry.'
  return m
}

export const HyperliquidProvider: PerpProvider = {
  id: 'hyperliquid',
  label: 'HYPERLIQUID',
  marketsLabel: 'PERP UNIVERSE',
  fetchMarkets: fetchHlMarkets,
  fetchAccount: (net, auth) => fetchHlAccount(net, (auth as HlAuth).user),
  fetchPositions: (net, auth) => fetchHlPositions(net, (auth as HlAuth).user),
  fetchOpenOrders: (net, auth) => fetchHlOpenOrders(net, (auth as HlAuth).user),
  placeOrder: (net, auth, args, log?) => hlPlaceOrder(net, auth as HlAuth, args, log),
  cancelOrder: (net, auth, order) => hlCancelOrder(net, auth as HlAuth, order),
  placeTpSl: (net, auth, args) => hlPlaceTpSl(net, auth as HlAuth, args),
  closePosition: (net, auth, pos) =>
    fetchHlMarkets(net).then((ms) => {
      const m = ms.find((x) => x.symbol === pos.symbol)
      if (!m || m.mark == null) throw new Error('No live mark price — retry.')
      return hlClosePosition(net, auth as HlAuth, pos, m.mark, pos.leverage || 1)
    }),
};
