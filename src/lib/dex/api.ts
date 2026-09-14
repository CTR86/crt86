/* ============================================================
   DEX.EXE — Jupiter Swap read/execute layer.
   Flow (per https://developers.jup.ag/docs/swap/order-and-execute):
     1. GET /order?inputMint&outputMint&amount&taker → { transaction, requestId, ... }
     2. Wallet signs the base64 versioned transaction (partial sign —
        JupiterZ routes need the MM signature added at /execute time).
     3. POST /execute { signedTransaction, requestId } → managed landing.
   Auth: same-origin /api/jup proxy first (server injects x-api-key),
   direct https://api.jup.ag fallback for local dev without the proxy.
   No mock data, no fabricated routes/hashes. Errors are real + actionable.
   ============================================================ */

import { JUP_PRICE_BASE, JUP_SWAP_BASE, JUP_TOKENS_BASE, MINT_SOL, POPULAR_TOKENS, dexRpcCandidates, jupHeaders } from './config'

/* ---------- types ---------- */
export interface DexToken {
  mint: string
  symbol: string
  name: string
  decimals: number
  icon?: string | null
  isVerified?: boolean
  organicScore?: number | null
  usdPrice?: number | null
}

export interface OrderResponse {
  mode?: string
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  inUsdValue?: number
  outUsdValue?: number
  priceImpact?: number
  swapUsdValue?: number
  otherAmountThreshold?: string
  swapMode?: string
  slippageBps?: number
  routePlan?: Array<{
    swapInfo?: { ammKey?: string; label?: string; inputMint?: string; outputMint?: string; inAmount?: string; outAmount?: string }
    percent?: number
    bps?: number
    usdValue?: number
  }>
  feeMint?: string
  feeBps?: number
  platformFee?: { amount?: string; feeBps?: number; feeMint?: string }
  signatureFeeLamports?: number
  prioritizationFeeLamports?: number
  rentFeeLamports?: number
  router?: string
  transaction: string | null
  lastValidBlockHeight?: string
  gasless?: boolean
  requestId: string
  taker?: string | null
  quoteId?: string
  maker?: string
  expireAt?: string
  errorCode?: number
  errorMessage?: string
  error?: string
}

export interface ExecuteResponse {
  status: 'Success' | 'Failed'
  signature: string
  code: number
  totalInputAmount?: string
  totalOutputAmount?: string
  inputAmountResult?: string
  outputAmountResult?: string
  error?: string
}

export interface ParsedQuote {
  outHuman: number
  rate: number
  priceImpactPct: number | null
  usdIn: number | null
  usdOut: number | null
  routerLabel: string
  routeLabels: string[]
  feeBps: number | null
  feeMint: string | null
  minOutHuman: number | null
  slippageBps: number | null
  mode: string | null
  gasless: boolean
  expireAtMs: number | null
  fetchedAt: number
}

/* ---------- amount math (exact, no float drift) ---------- */
export function toBaseUnits(human: string, decimals: number): string {
  const s = human.trim()
  if (!s) throw new Error('Enter an amount.')
  if (!/^\d*\.?\d*$/.test(s) || s === '.' || s === '') throw new Error('Invalid amount — digits and one dot only.')
  const [wholeRaw, fracRaw = ''] = s.split('.')
  const whole = wholeRaw === '' ? '0' : wholeRaw
  if (fracRaw.length > decimals) {
    throw new Error(`Too many decimals — this token supports ${decimals}.`)
  }
  const frac = fracRaw.padEnd(decimals, '0')
  const base = BigInt(whole === '0' ? '0' : whole) * 10n ** BigInt(decimals) + (frac === '' ? 0n : BigInt(frac))
  if (base <= 0n) throw new Error('Amount must be greater than zero.')
  return base.toString()
}

export function fromBaseUnits(base: string, decimals: number): number {
  const b = BigInt(base)
  const denom = 10n ** BigInt(decimals)
  const whole = b / denom
  const frac = b % denom
  return Number(whole) + Number(frac) / Number(denom)
}

export function formatTokenAmount(human: number, decimals: number): string {
  if (!isFinite(human)) return '—'
  if (human === 0) return '0'
  if (human >= 1) return human.toLocaleString('en-US', { maximumFractionDigits: Math.min(6, decimals) })
  if (human >= 0.000001) return String(Number(human.toFixed(6)))
  return human.toPrecision(3)
}

/* ---------- validation ---------- */
export function validateSwapInput(args: {
  amountHuman: string
  inputDecimals: number
  balanceHuman: number | null
  inputMint: string
  outputMint: string
  walletConnected: boolean
}): string | null {
  if (!args.walletConnected) return 'Wallet not connected — connect Phantom to trade.'
  if (!args.inputMint || !args.outputMint) return 'Pick two tokens first.'
  if (args.inputMint === args.outputMint) return 'Input and output tokens must differ — pick another token.'
  const n = Number(args.amountHuman)
  if (!args.amountHuman.trim() || !isFinite(n) || n <= 0) return 'Enter an amount greater than zero.'
  try {
    toBaseUnits(args.amountHuman, args.inputDecimals)
  } catch (e) {
    return (e as Error).message
  }
  if (args.balanceHuman != null && n > args.balanceHuman) {
    return `Insufficient balance — wallet has ${args.balanceHuman.toFixed(4)}.`
  }
  return null
}

/* ---------- Jupiter error mapping (match router + code, never message text) ---------- */
export function mapOrderError(order: OrderResponse): string {
  const router = (order.router ?? 'jupiter').toLowerCase()
  const code = order.errorCode
  const detail = order.errorMessage || order.error || ''
  if (router === 'jupiterz') {
    if (code === 1) return 'Insufficient balance to fund the swap — lower the amount or top up.'
    if (code === 2) return 'Missing token account — the wallet needs the input token account first (try a smaller amount or another pair).'
    if (code === 3) return 'Jupiter quoted a price but could not build this swap — try again or pick another pair.'
    return `JupiterZ could not build the swap${detail ? ': ' + detail : '.'}`
  }
  if (code === 1) return 'Insufficient funds — the wallet lacks the input token balance.'
  if (code === 2) return 'Insufficient SOL for gas — keep a little SOL for fees (do not send MAX).'
  if (code === 3) return 'Swap below minimum for gasless — raise the amount slightly.'
  return detail ? `Jupiter could not build the swap: ${detail}` : 'Jupiter could not build the swap.'
}

export function mapExecuteError(code: number, fallback?: string): string {
  switch (code) {
    case 0: return ''
    case -1: return 'Quote expired — re-quote and sign immediately (requestId not found).'
    case -2: return 'Invalid signed transaction — re-quote and sign again without modifying it.'
    case -3: return 'Invalid message bytes — re-quote and sign again.'
    case -1000: return 'Jupiter could not land the transaction — retry; check Solscan for status.'
    case -1001: return 'Aggregator unknown error — retry with a fresh quote.'
    case -1002: return 'Invalid transaction — the swap was modified or went stale. Re-quote.'
    case -1003: return 'Transaction not fully signed — approve the full signature in your wallet.'
    case -1004: return 'Quote expired (block height passed) — re-quote and sign immediately.'
    case -2000: return 'Market maker could not land the quote — retry; RFQ quotes are short-lived.'
    case -2001: return 'RFQ unknown error — retry with a fresh quote.'
    case -2002: return 'Invalid RFQ payload — re-quote and sign again.'
    case -2003: return 'RFQ quote expired — re-quote and sign immediately.'
    case -2004: return 'Swap rejected by market maker (price moved) — re-quote and try again.'
    default: return fallback ? fallback.slice(0, 300) : `Swap failed (code ${code}) — check Solscan for the receipt.`
  }
}

export function isWalletRejection(msg: string): boolean {
  return /reject|denied|cancel|user rejected|user cancelled|user canceled/i.test(msg)
}

/* ---------- quote parsing (display only — never fabricate) ---------- */
export function parseOrder(order: OrderResponse, inputDecimals: number, outputDecimals: number): ParsedQuote {
  const outHuman = Number.isFinite(Number(order.outAmount)) ? fromBaseUnits(order.outAmount || '0', outputDecimals) : 0
  const inHuman = Number.isFinite(Number(order.inAmount)) ? fromBaseUnits(order.inAmount || '0', inputDecimals) : 0
  const rate = inHuman > 0 && outHuman >= 0 ? outHuman / inHuman : 0
  const priceImpactPct = typeof order.priceImpact === 'number' && isFinite(order.priceImpact) ? order.priceImpact : null
  const routeLabels = (order.routePlan ?? [])
    .map((s) => s.swapInfo?.label)
    .filter((l): l is string => typeof l === 'string' && l.length > 0)
  const minOutHuman =
    order.otherAmountThreshold != null && order.otherAmountThreshold !== ''
      ? fromBaseUnits(order.otherAmountThreshold, outputDecimals)
      : null
  return {
    outHuman,
    rate,
    priceImpactPct,
    usdIn: typeof order.inUsdValue === 'number' ? order.inUsdValue : null,
    usdOut: typeof order.outUsdValue === 'number' ? order.outUsdValue : null,
    routerLabel: (order.router ?? 'metis').toUpperCase(),
    routeLabels,
    feeBps: typeof order.feeBps === 'number' ? order.feeBps : null,
    feeMint: order.feeMint ?? order.platformFee?.feeMint ?? null,
    minOutHuman,
    slippageBps: typeof order.slippageBps === 'number' ? order.slippageBps : null,
    mode: order.mode ?? null,
    gasless: order.gasless === true,
    expireAtMs: order.expireAt ? Date.parse(order.expireAt) : null,
    fetchedAt: Date.now(),
  }
}

/** Quotes go stale fast (RFQ especially) — warn past this age. */
export const QUOTE_STALE_AFTER_MS = 30_000

export function isQuoteStale(fetchedAt: number, expireAtMs: number | null): boolean {
  if (expireAtMs != null && isFinite(expireAtMs)) return Date.now() >= expireAtMs
  return Date.now() - fetchedAt > QUOTE_STALE_AFTER_MS
}

/* ---------- transport: proxy-first, direct fallback ---------- */
async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: unknown }> {
  const r = await fetch(url, init)
  const json = await r.json().catch(() => null)
  return { ok: r.ok, status: r.status, json }
}

function proxyAvailable(): boolean {
  // Same-origin proxy exists in prod (Vercel) and in vite dev (middleware).
  // On static hosts without /api it 404s — then we fall back to direct.
  return typeof window !== 'undefined'
}

export async function fetchOrder(args: {
  inputMint: string
  outputMint: string
  amountBase: string
  taker: string
  slippageBps?: number | null
}): Promise<OrderResponse> {
  const params = new URLSearchParams({
    inputMint: args.inputMint,
    outputMint: args.outputMint,
    amount: args.amountBase,
    taker: args.taker,
  })
  if (args.slippageBps != null) params.set('slippageBps', String(args.slippageBps))

  // 1) Same-origin proxy (server injects x-api-key — key never touches the bundle)
  if (proxyAvailable()) {
    try {
      const r = await fetchJson(`/api/jup?op=order&${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      })
      if (r.ok) return r.json as OrderResponse
      // 404 = no function on this host → fall through to direct.
      // 4xx/5xx from Jupiter via proxy are real errors — surface them.
      if (r.status !== 404) {
        const msg = (r.json as { error?: string; message?: string } | null)?.error
          ?? (r.json as { message?: string } | null)?.message
          ?? `Quote request failed (HTTP ${r.status})`
        throw new Error(msg)
      }
    } catch (e) {
      const m = String((e as Error).message ?? e)
      // Only fall through on proxy-missing / network-to-proxy failures.
      if (!/404|Failed to fetch|Load failed|NetworkError|network/i.test(m)) throw e
    }
  }

  // 2) Direct fallback (local dev without vercel dev — uses VITE_ key if set)
  const r = await fetch(`${JUP_SWAP_BASE}/order?${params.toString()}`, {
    headers: { Accept: 'application/json', ...jupHeaders() },
    signal: AbortSignal.timeout(20_000),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) {
    const msg = (j as { error?: string } | null)?.error ?? `Jupiter quote HTTP ${r.status}`
    throw new Error(msg)
  }
  return j as OrderResponse
}

export async function executeOrder(args: {
  signedTransaction: string
  requestId: string
}): Promise<ExecuteResponse> {
  if (proxyAvailable()) {
    try {
      const r = await fetchJson('/api/jup?op=execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ signedTransaction: args.signedTransaction, requestId: args.requestId }),
        signal: AbortSignal.timeout(60_000),
      })
      if (r.ok) return r.json as ExecuteResponse
      if (r.status !== 404) {
        const msg = (r.json as { error?: string; message?: string } | null)?.error
          ?? (r.json as { message?: string } | null)?.message
          ?? `Execute failed (HTTP ${r.status})`
        throw new Error(msg)
      }
    } catch (e) {
      const m = String((e as Error).message ?? e)
      if (!/404|Failed to fetch|Load failed|NetworkError|network/i.test(m)) throw e
    }
  }
  const r = await fetch(`${JUP_SWAP_BASE}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...jupHeaders() },
    body: JSON.stringify({ signedTransaction: args.signedTransaction, requestId: args.requestId }),
    signal: AbortSignal.timeout(60_000),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) {
    const msg = (j as { error?: string } | null)?.error ?? `Jupiter execute HTTP ${r.status}`
    throw new Error(msg)
  }
  return j as ExecuteResponse
}

/* ---------- tokens: search + metadata ---------- */
interface TokenSearchItem {
  id?: string
  symbol?: string
  name?: string
  decimals?: number
  icon?: string | null
  isVerified?: boolean
  organicScore?: number | null
  usdPrice?: number | null
}

function toDexToken(t: TokenSearchItem): DexToken | null {
  if (!t.id || !t.symbol) return null
  return {
    mint: t.id,
    symbol: t.symbol,
    name: t.name ?? t.symbol,
    decimals: typeof t.decimals === 'number' ? t.decimals : 6,
    icon: t.icon ?? null,
    isVerified: t.isVerified,
    organicScore: t.organicScore ?? null,
    usdPrice: typeof t.usdPrice === 'number' ? t.usdPrice : null,
  }
}

export async function searchTokens(query: string): Promise<DexToken[]> {
  const q = query.trim()
  if (!q) return []
  const params = new URLSearchParams({ query: q })
  if (proxyAvailable()) {
    try {
      const r = await fetchJson(`/api/jup?op=search&${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      })
      if (r.ok && Array.isArray(r.json)) {
        return (r.json as TokenSearchItem[]).map(toDexToken).filter((t): t is DexToken => t != null).slice(0, 20)
      }
      if (!r.ok && r.status !== 404) {
        throw new Error(`Token search HTTP ${r.status}`)
      }
    } catch (e) {
      const m = String((e as Error).message ?? e)
      if (!/404|Failed to fetch|Load failed|NetworkError|network/i.test(m)) throw e
    }
  }
  const r = await fetch(`${JUP_TOKENS_BASE}/search?${params.toString()}`, {
    headers: { Accept: 'application/json', ...jupHeaders() },
    signal: AbortSignal.timeout(15_000),
  })
  if (!r.ok) throw new Error(`Token search HTTP ${r.status}`)
  const j = (await r.json().catch(() => [])) as TokenSearchItem[]
  if (!Array.isArray(j)) return []
  return j.map(toDexToken).filter((t): t is DexToken => t != null).slice(0, 20)
}

/** Resolve decimals/symbol for arbitrary mints (popular list first, Jupiter second). */
export async function resolveTokens(mints: string[]): Promise<Map<string, DexToken>> {
  const out = new Map<string, DexToken>()
  for (const m of mints) {
    const p = POPULAR_TOKENS.find((t) => t.mint === m)
    if (p) out.set(m, { mint: p.mint, symbol: p.symbol, name: p.name, decimals: p.decimals })
  }
  const missing = mints.filter((m) => !out.has(m))
  if (missing.length === 0) return out
  try {
    const found = await searchTokens(missing.join(','))
    for (const t of found) out.set(t.mint, t)
  } catch {
    /* keep popular-only — caller surfaces honest unknown-decimals state */
  }
  return out
}

/* ---------- prices (v3) ---------- */
export async function fetchPrices(mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = [...new Set(mints)].filter(Boolean)
  if (ids.length === 0) return out
  const params = new URLSearchParams({ ids: ids.slice(0, 50).join(',') })
  const apply = (j: unknown) => {
    if (j && typeof j === 'object') {
      for (const [mint, v] of Object.entries(j as Record<string, { usdPrice?: number }>)) {
        const p = (v as { usdPrice?: number } | null)?.usdPrice
        if (typeof p === 'number' && isFinite(p) && p > 0) out.set(mint, p)
      }
    }
  }
  if (proxyAvailable()) {
    try {
      const r = await fetchJson(`/api/jup?op=price&${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      })
      if (r.ok) {
        apply(r.json)
        return out
      }
      if (r.status !== 404) return out // price missing = omit, not error
    } catch {
      /* fall through to direct */
    }
  }
  try {
    const r = await fetch(`${JUP_PRICE_BASE}?${params.toString()}`, {
      headers: { Accept: 'application/json', ...jupHeaders() },
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) return out
    apply(await r.json().catch(() => null))
  } catch {
    /* price is best-effort */
  }
  return out
}

/* ---------- balances (existing RPC convention, no new infra) ---------- */
export async function getTokenBalanceHuman(ownerBase58: string, mint: string): Promise<number | null> {
  for (const url of dexRpcCandidates()) {
    try {
      const { Connection, PublicKey } = await import('@solana/web3.js')
      const conn = new Connection(url, 'confirmed')
      const owner = new PublicKey(ownerBase58)
      if (mint === MINT_SOL) {
        const lamports = await conn.getBalance(owner)
        return lamports / 1e9
      }
      const mintPk = new PublicKey(mint)
      // Parsed accounts give uiAmount directly — no manual decimal math.
      const res = await conn.getParsedTokenAccountsByOwner(owner, { mint: mintPk })
      let total = 0
      for (const acc of res.value) {
        const info = (acc.account.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } })?.parsed?.info?.tokenAmount
        if (typeof info?.uiAmount === 'number') total += info.uiAmount
      }
      return total
    } catch {
      /* next RPC */
    }
  }
  return null
}
