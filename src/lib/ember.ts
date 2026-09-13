/* ============================================================
   Ember (embercurve.fun) engine client — Meteora DBC launches
   paired with stocks / SOL / USDC. Sign in your wallet, the
   platform registers the coin. CORS: open (*).
   ============================================================ */

/* Ember's API does NOT send CORS headers on responses (only on preflight),
   so third-party origins can't read it. We proxy it through our own origin:
   - prod: Vercel rewrite /ember/:path* -> https://embercurve.fun/:path* (vercel.json)
   - dev:  Vite proxy /ember -> https://embercurve.fun (vite.config.ts) */
const BASE = '/ember/api/solana'

export interface EmberQuote {
  mint: string
  ticker: string
  name: string
  decimals: number
  tokenProgram: string
  engines: string[]
  /** current USD price of 1 pair token — used to size the opening liquidity */
  usdPrice?: number
}

export interface EmberEconomics {
  openUsd: number
  graduateUsd: number
  graduateOptions: number[]
  feeModes: { bps: number; label: string; default: boolean }[]
  creatorFeePct: number
  totalSupply: number
  baseDecimals: number
  [k: string]: unknown
}

export async function getEmberQuotes(): Promise<{ economics: EmberEconomics; quotes: EmberQuote[] }> {
  const r = await fetch(`${BASE}/quotes`, { signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`Ember quotes HTTP ${r.status}`)
  return r.json()
}

export interface EmberPrepareParams {
  creatorWallet: string
  name: string
  symbol: string
  uri: string
  quoteMint: string
  feeBps: number
  graduateUsd: number
  mode: 'keep' | 'split' | 'holders'
  holdersBps?: number
  payInQuote?: boolean
}

export interface EmberPrepare {
  launchId: string
  engine: string
  transaction: string
  transactions: { versioned: boolean; transaction: string }[]
  mint: string
  pool: string
  config: string
  quoteUsd: number
  openQuote: number
  graduateQuote: number
  graduateUsd: number
  feeBps: number
  mode: string
  expiresAt: number
  [k: string]: unknown
}

export async function prepareEmberLaunch(params: EmberPrepareParams): Promise<EmberPrepare> {
  const r = await fetch(`${BASE}/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'prepare', ...params }),
    signal: AbortSignal.timeout(20_000),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok || !j?.launchId) throw new Error(j?.error ?? `Ember prepare HTTP ${r.status}`)
  return j as EmberPrepare
}

export async function submitEmberLaunch(launchId: string, signedTransaction: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'submit', launchId, signedTransaction }),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(j?.error ?? `Ember submit HTTP ${r.status}`)
  return j ?? {}
}
