/* ============================================================
   Uniswap Trading API client (browser side).
   Talks ONLY to the same-origin /api/uniswap proxy — the API key
   lives server-side and never touches this bundle.
   Verified against the official OpenAPI spec
   (trade-api.gateway.uniswap.org/v1/api.json):
     POST /quote → { requestId, routing, quote, permitData }
     POST /swap  → { requestId, swap: { to, data, value } }
   Scope: CLASSIC routing only (single sign-and-send tx through
   Universal Router). DUTCH/PRIORITY (UniswapX off-chain orders),
   BRIDGE/WRAP/UNWRAP/CHAINED routings are rejected with an honest
   error so the provider falls back to the on-chain V3 path.
   ============================================================ */

import type { Address, Hex } from 'viem'

export interface ApiPermitData {
  domain: Record<string, unknown>
  types: Record<string, Array<{ name: string; type: string }>>
  values: Record<string, unknown>
}

export interface ApiClassicQuote {
  raw: unknown
  chainId: number
  amountOut: bigint
  routeString: string | null
  priceImpact: number | null
  gasFeeUSD: number | null
  slippage: number | null
}

export interface ApiQuoteResponse {
  routing: string
  classic: ApiClassicQuote | null
  permitData: ApiPermitData | null
}

/** Routings UNISWAP.EXE can execute as one wallet-signed tx. */
export const EXECUTABLE_ROUTINGS = ['CLASSIC'] as const

export function isExecutableRouting(routing: string): boolean {
  return (EXECUTABLE_ROUTINGS as readonly string[]).includes(String(routing || '').toUpperCase())
}

function asBigint(v: unknown): bigint | null {
  try {
    if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v)
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return BigInt(v)
  } catch {
    /* fall through */
  }
  return null
}

/** Parse + validate a /quote response. Throws honest errors, never fabricates. */
export function parseApiQuoteResponse(json: unknown): ApiQuoteResponse {
  if (!json || typeof json !== 'object') throw new Error('Uniswap API returned an empty quote.')
  const j = json as Record<string, unknown>
  const routing = String(j.routing || '').toUpperCase()
  if (!routing) {
    const msg = (j as { message?: string }).message
    throw new Error(msg ? String(msg).slice(0, 200) : 'Uniswap API returned no routing.')
  }
  if (!isExecutableRouting(routing)) {
    throw new Error(`Uniswap API routing ${routing} needs an off-chain order flow — falling back to on-chain V3.`)
  }
  const q = j.quote as Record<string, unknown> | null
  if (!q || typeof q !== 'object') throw new Error('Uniswap API quote missing quote body.')
  const out = q.output as Record<string, unknown> | null
  const amountOut = asBigint(out?.amount)
  if (amountOut == null || amountOut <= 0n) {
    const fail = Array.isArray(q.txFailureReasons) ? q.txFailureReasons.join('; ') : ''
    throw new Error(
      fail ? `Uniswap route simulation failed: ${String(fail).slice(0, 160)}` : 'Uniswap API quoted zero output.',
    )
  }
  const permitRaw = (j.permitData ?? null) as {
    domain?: Record<string, unknown>
    types?: Record<string, Array<{ name: string; type: string }>>
    values?: Record<string, unknown>
  } | null
  const permitData: ApiPermitData | null =
    permitRaw && permitRaw.domain && permitRaw.types && permitRaw.values
      ? { domain: permitRaw.domain, types: permitRaw.types, values: permitRaw.values }
      : null
  return {
    routing,
    classic: {
      raw: q,
      chainId: Number(q.chainId) || 0,
      amountOut,
      routeString: typeof q.routeString === 'string' ? q.routeString : null,
      priceImpact: typeof q.priceImpact === 'number' ? q.priceImpact : null,
      gasFeeUSD: q.gasFeeUSD != null ? Number(q.gasFeeUSD) : null,
      slippage: typeof q.slippage === 'number' ? q.slippage : null,
    },
    permitData,
  }
}

export interface ApiSwapTx {
  to: Address
  data: Hex
  value: Hex | undefined
}

/** Parse + validate a /swap response into a wallet-sendable tx. */
export function parseApiSwapResponse(json: unknown): ApiSwapTx {
  if (!json || typeof json !== 'object') throw new Error('Uniswap API returned an empty swap.')
  const s = (json as Record<string, unknown>).swap as Record<string, unknown> | null
  if (!s || typeof s !== 'object') {
    const msg = (json as { message?: string }).message
    throw new Error(msg ? String(msg).slice(0, 200) : 'Uniswap API returned no swap calldata.')
  }
  const to = String(s.to || '')
  const data = String(s.data || '')
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error('Uniswap API returned an invalid swap target.')
  if (!/^0x[0-9a-fA-F]*$/.test(data) || data.length < 10) throw new Error('Uniswap API returned invalid swap calldata.')
  const valueRaw = s.value
  let value: Hex | undefined
  if (valueRaw != null && String(valueRaw) !== '0' && String(valueRaw) !== '') {
    const v = asBigint(valueRaw)
    if (v == null) throw new Error('Uniswap API returned an invalid swap value.')
    value = `0x${v.toString(16)}` as Hex
  }
  return { to: to as Address, data: data as Hex, value }
}

async function postOp<T>(op: string, body: unknown, timeoutMs: number): Promise<{ ok: boolean; status: number; json: T | null }> {
  const r = await fetch(`/api/uniswap?op=${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  return { ok: r.ok, status: r.status, json: (await r.json().catch(() => null)) as T | null }
}

let statusCache: { at: number; configured: boolean } | null = null

/** True when the server proxy has a key (else the provider stays on-chain). */
export async function uniswapApiConfigured(): Promise<boolean> {
  if (statusCache && Date.now() - statusCache.at < 5 * 60_000) return statusCache.configured
  try {
    const r = await fetch('/api/uniswap?op=status', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    const j = (await r.json().catch(() => null)) as { configured?: boolean } | null
    const configured = r.ok && j?.configured === true
    statusCache = { at: Date.now(), configured }
    return configured
  } catch {
    return false
  }
}

export async function fetchApiQuote(args: {
  chainId: number
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  swapper: Address
  slippageBps: number
}): Promise<ApiQuoteResponse> {
  const r = await postOp<unknown>(
    'quote',
    {
      chainId: args.chainId,
      tokenIn: args.tokenIn,
      tokenOut: args.tokenOut,
      amount: args.amountIn.toString(),
      swapper: args.swapper,
      slippageBps: args.slippageBps,
    },
    30_000,
  )
  if (!r.ok) {
    const msg = (r.json as { message?: string } | null)?.message
    throw new Error(msg ? String(msg).slice(0, 250) : `Uniswap quote HTTP ${r.status}`)
  }
  return parseApiQuoteResponse(r.json)
}

export async function fetchApiSwap(args: {
  classicQuote: unknown
  permitData?: ApiPermitData | null
  signature?: Hex | null
  deadline?: number | null
}): Promise<ApiSwapTx> {
  const r = await postOp<unknown>(
    'swap',
    {
      quote: args.classicQuote,
      ...(args.permitData && args.signature ? { permitData: args.permitData, signature: args.signature } : {}),
      ...(args.deadline != null ? { deadline: args.deadline } : {}),
    },
    50_000,
  )
  if (!r.ok) {
    const msg = (r.json as { message?: string } | null)?.message
    throw new Error(msg ? String(msg).slice(0, 250) : `Uniswap swap HTTP ${r.status}`)
  }
  return parseApiSwapResponse(r.json)
}
