/* ============================================================
   StonkFun public API client (Solana launchpad)
   Base: https://www.stonkfun.xyz/api/public/v1  — keyless, CORS *
   ============================================================ */

export const SF_BASE = 'https://www.stonkfun.xyz/api/public/v1'

export class SfError extends Error {
  code: string
  status: number
  retryable: boolean
  constructor(code: string, message: string, status: number, retryable = false) {
    super(message)
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

async function sf<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(SF_BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* non-JSON */
  }
  const b = body as { data?: T; error?: { code: string; message?: string; retryable?: boolean } }
  if (!res.ok) {
    throw new SfError(
      b?.error?.code ?? 'internal',
      b?.error?.message ?? `HTTP ${res.status}`,
      res.status,
      b?.error?.retryable ?? res.status >= 500,
    )
  }
  return b?.data as T
}

/* ---------------- types ---------------- */

export interface QuoteInfo {
  mint: string
  symbol: string
  name: string
  logoUrl?: string
  category?: string
  categoryLabel?: string
}

export interface MarketData {
  priceUsd: number
  marketCapUsd: number
  fdvUsd: number
  volume24hUsd: number
  liquidityUsd: number
  peakMarketCapUsd: number
}

export interface SfToken {
  mint: string
  pool: string
  name: string
  symbol: string
  quote: QuoteInfo
  launchpad: string
  mode: 'standard' | 'reward'
  quoteOnlyFees?: boolean
  transferFee?: { bps: number }
  imageUrl?: string
  links?: { website?: string; twitter?: string; telegram?: string }
  market: MarketData
  status: 'new' | 'aboutToGraduate' | 'graduated'
  graduationProgress: number
  createdAt: string
}

export interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface TokensData {
  tokens: SfToken[]
  pagination: Pagination
  network?: string
}

export interface SfPair {
  mint: string
  symbol: string
  name: string
  decimals: number
  logoUrl?: string
  category?: string
  categoryLabel?: string
  tokenProgram?: string
  launchable: boolean
  launchLabReady?: boolean
}

export interface SfStats {
  network: string
  tokens: {
    poolsAvailable: boolean
    total: number
    graduated: number
    aboutToGraduate: number
    rewardLaunches: number
    totalMarketCapUsd: number
    totalVolume24hUsd: number
  }
  revenue: { totalRevenueUsd: number; totalBuybackUsd: number }
  burns: { totalValueUsdAtBurn: number; burnCount: number }
  config: Record<string, boolean | number | string>
}

export interface LaunchRecord {
  mint?: string
  paymentSignature?: string
  status?: string
  name?: string
  symbol?: string
  createdAt?: string
  [k: string]: unknown
}

export interface PrepareLaunchBody {
  creatorWallet: string
  quoteMint: string
  name: string
  symbol: string
  logo: string // data:image/(png|jpeg|webp);base64,...
  mode?: 'standard' | 'reward'
  rewardTaxBps?: string // reward mode: "100" | "300"
  feeTier?: string // standard mode: "1%" | "2%"
  website?: string
  twitter?: string
  telegram?: string
  devBuyPercent?: string // max 50, mutually exclusive with devBuySol
  devBuySol?: string
  airdropPercent?: string // reward mode only, max 50
  airdropTier?: string // top100..top5000
  airdropSource?: string
}

/* The prepare/submit/status payloads are intentionally loose on the wire —
   keep the fields the UI consumes and tolerate the rest. */
export interface PrepareResult {
  signedQuote?: string
  paymentTransaction?: string
  payment?: { lamports?: string | number; [k: string]: unknown }
  devBuy?: { tokens?: string; netTokens?: string; sol?: string | number; [k: string]: unknown }
  airdrop?: { recipients?: number; [k: string]: unknown }
  poolFeePercent?: string | number
  transferFee?: { bps: number }
  [k: string]: unknown
}

export interface FeesData {
  mint: string
  creator?: string | null
  claimable?: { [quoteOrSol: string]: string | number | Record<string, unknown> } | null
  reason?: string
  [k: string]: unknown
}

/* ---------------- reads ---------------- */

export function getTokens(params: {
  q?: string
  sort?: 'marketCap' | 'newest' | 'volume'
  mode?: 'standard' | 'reward'
  status?: 'new' | 'aboutToGraduate' | 'graduated'
  quoteMint?: string
  category?: string
  page?: number
  pageSize?: number
}): Promise<TokensData> {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') p.set(k, String(v))
  return sf<TokensData>(`/tokens?${p.toString()}`)
}

/** /tokens/{mint} nests the payload: { token, launch, network } — flatten it */
export function getToken(mint: string): Promise<SfToken & { launch?: LaunchRecord; network?: string }> {
  return sf<{ token: SfToken; launch?: LaunchRecord; network?: string }>(`/tokens/${mint}`).then((d) => ({
    ...d.token,
    launch: d.launch,
    network: d.network,
  }))
}

export function getPairs(params?: { launchable?: boolean; launchLabReady?: boolean }): Promise<{ pairs: SfPair[] }> {
  const p = new URLSearchParams()
  if (params?.launchable != null) p.set('launchable', String(params.launchable))
  if (params?.launchLabReady != null) p.set('launchLabReady', String(params.launchLabReady))
  return sf(`/pairs?${p.toString()}`)
}

export function getStats(): Promise<SfStats> {
  return sf('/stats')
}

export function getLaunches(params: {
  creator?: string
  mode?: 'standard' | 'reward'
  since?: string
  page?: number
  pageSize?: number
}): Promise<{ launches: LaunchRecord[]; pagination?: Pagination }> {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') p.set(k, String(v))
  return sf(`/launches?${p.toString()}`)
}

export function getBurns(mint: string, limit = 10): Promise<Record<string, unknown>> {
  return sf(`/tokens/${mint}/burns?limit=${limit}`)
}

export function getTokenFees(mint: string): Promise<FeesData> {
  return sf(`/tokens/${mint}/fees`)
}

/* ---------------- launch flow (sign -> submit -> poll) ---------------- */

export function prepareLaunch(body: PrepareLaunchBody): Promise<PrepareResult> {
  return sf('/launches/prepare', { method: 'POST', body: JSON.stringify(body) })
}

export function submitLaunch(body: {
  signedQuote: string
  signedTransaction: string
  logo: string
}): Promise<{ paymentSignature?: string; [k: string]: unknown }> {
  return sf('/launches/submit', { method: 'POST', body: JSON.stringify(body) })
}

export function getLaunchStatus(paymentSignature: string): Promise<LaunchRecord> {
  return sf(`/launches/${paymentSignature}`)
}

/* ---------------- fee claiming ---------------- */

export function prepareFeeClaim(mint: string, creatorWallet: string): Promise<{ intentId?: string; transaction?: string; unsignedTransaction?: string; [k: string]: unknown }> {
  return sf(`/tokens/${mint}/fees/claim/prepare`, {
    method: 'POST',
    body: JSON.stringify({ creatorWallet }),
  })
}

export function submitFeeClaim(mint: string, body: { creatorWallet: string; intentId: string; signedTransaction: string }): Promise<Record<string, unknown>> {
  return sf(`/tokens/${mint}/fees/claim/submit`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/* asset URLs on the API are relative (logos) */
export function sfAssetUrl(path: string | undefined): string | undefined {
  if (!path) return undefined
  if (path.startsWith('http')) return path
  return 'https://www.stonkfun.xyz' + path
}
