/* ============================================================
   LEND.EXE — Jupiter Lend REST layer (Earn + Borrow).
   Official docs: https://developers.jup.ag/docs/lend
     Earn API : /docs/lend/earn/api
     Borrow API: /docs/lend/borrow/api
   Flow (both sides return UNSIGNED base64 VersionedTransaction):
     Earn   POST /earn/deposit|withdraw { asset, amount, signer }
     Borrow POST /borrow/operate { vaultId, positionId, signer,
            colAmount, debtAmount, positionOwner? } (+ ?market=)
   Browser flow everywhere (mirrors DEX.EXE):
     validate → build via /api/lend proxy → simulate → SystemDialog
     confirm → wallet signs ONCE → multi-RPC broadcast → confirm → refresh.
   No mock data, no fabricated APY/positions/hashes.
   ============================================================ */

import { LEND_API_BASE, lendHeaders, lendRpcCandidates } from './config'

/* ---------- Earn types (per /docs/api-reference/lend/earn/*) ---------- */
export interface EarnAssetInfo {
  address: string
  chain_id?: string
  name: string
  symbol: string
  decimals: number
  logo_url?: string
  price?: string
  coingecko_id?: string
}

export interface EarnToken {
  id: number
  address: string
  name: string
  symbol: string
  decimals: number
  assetAddress: string
  asset: EarnAssetInfo
  totalAssets: string
  totalSupply: string
  convertToShares: string
  convertToAssets: string
  rewardsRate: string
  supplyRate: string
  totalRate: string
  rebalanceDifference?: string
  liquiditySupplyData?: {
    withdrawable?: string
    withdrawalLimit?: string
    supply?: string
    modeWithInterest?: boolean
  }
}

export interface EarnPosition {
  token: EarnToken
  ownerAddress: string
  shares: string
  underlyingAssets: string
  underlyingBalance: string
  allowance: string
}

export interface EarnEarnings {
  address: string
  ownerAddress: string
  earnings: number
  slot: number
}

export interface EarnTxResponse {
  transaction: string
}

/* ---------- Borrow types (per /docs/api-reference/lend/borrow/*) ---------- */
export interface BorrowTokenInfo {
  address: string
  chainId?: string
  name: string
  symbol: string
  uiSymbol?: string
  decimals: number
  price?: string
  logoUrl?: string
}

export interface BorrowVault {
  id: number
  address: string
  supplyToken: BorrowTokenInfo
  borrowToken: BorrowTokenInfo
  totalSupply?: string
  totalBorrow?: string
  collateralFactor?: string
  liquidationThreshold?: string
  liquidationPenalty?: string
  borrowFee?: string
  borrowRate?: string
  supplyRate?: string
  borrowable?: string
  withdrawable?: string
  minimumBorrowing?: string
  totalPositions?: number
  oraclePrice?: string
  rewards?: Array<{ apr?: string; side?: string }>
}

export interface BorrowPosition {
  id: number
  vaultId: number
  address: string
  supply: string
  beforeSupply?: string
  borrow: string
  beforeBorrow?: string
  dustBorrow?: string
  isLiquidated?: boolean
  isSupplyPosition?: boolean
  tick?: number
  tickId?: number
  ownerAddress: string
  vault?: BorrowVault
}

export interface OperateTxResponse {
  nftId: number
  transaction: string
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

/* ---------- display conversions (real API values only) ----------
   Earn rates arrive as bps-style integer strings on the live gateway
   (verified 2026-09: totalRate "488" → 4.88% APY) while docs examples
   show fraction style ("0.06" → 6%). Both are accepted: values > 10
   are treated as basis points, smaller values as fractions.
   Borrow risk params arrive as per-mille strings ("800" → 80.0%).
   Borrow rates arrive bps-style ("471" → 4.71%). Each formatter
   returns null when the wire value is missing/garbage so the UI
   prints "—" instead of inventing a number. */
export function earnRatePct(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!isFinite(n)) return null
  if (n > 10) return n / 100
  return n * 100
}

export function formatRatePct(raw: string | null | undefined): string {
  const p = earnRatePct(raw)
  return p == null ? '—' : `${p.toFixed(2)}%`
}

/** "800" → 80.0 (percent). Null when unparseable. */
export function factorPct(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!isFinite(n)) return null
  return n / 10
}

export function formatFactorPct(raw: string | null | undefined): string {
  const p = factorPct(raw)
  return p == null ? '—' : `${p.toFixed(1)}%`
}

/** Borrow rate: bps-style ("471" → 4.71%) or fraction-style ("0.0471"). */
export function borrowRatePct(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!isFinite(n)) return null
  if (n > 10) return n / 100
  return n * 100
}

export function formatBorrowRate(raw: string | null | undefined): string {
  const p = borrowRatePct(raw)
  return p == null ? '—' : `${p.toFixed(2)}%`
}

export function tokenPriceUsd(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!isFinite(n) || n <= 0) return null
  return n
}

/* ---------- LTV / health (computed from real vault + position data) ---------- */
export interface LtvInfo {
  collateralUsd: number | null
  debtUsd: number | null
  ltvPct: number | null
  maxLtvPct: number | null
  liqThresholdPct: number | null
  health: 'SAFE' | 'WARNING' | 'DANGER' | 'UNKNOWN'
}

/** fromBaseUnits that returns null instead of throwing (bad input = unknown, not zero). */
function tryBaseUnits(base: string, decimals: number): number | null {
  try {
    return fromBaseUnits(base, decimals)
  } catch {
    return null
  }
}

export function computeLtv(vault: BorrowVault, supplyBase: string, borrowBase: string): LtvInfo {  const supDec = vault.supplyToken.decimals
  const borDec = vault.borrowToken.decimals
  const supHuman = tryBaseUnits(supplyBase || '0', supDec)
  const borHuman = tryBaseUnits(borrowBase || '0', borDec)
  const supPrice = tokenPriceUsd(vault.supplyToken.price)
  const borPrice = tokenPriceUsd(vault.borrowToken.price)
  const collateralUsd = supHuman != null && supPrice != null ? supHuman * supPrice : null
  const debtUsd = borHuman != null && borPrice != null ? borHuman * borPrice : null
  const ltvPct = collateralUsd != null && debtUsd != null && collateralUsd > 0 ? (debtUsd / collateralUsd) * 100 : borHuman === 0 || borrowBase === '0' ? 0 : null
  const maxLtvPct = factorPct(vault.collateralFactor)
  const liqThresholdPct = factorPct(vault.liquidationThreshold)
  let health: LtvInfo['health'] = 'UNKNOWN'
  if (ltvPct != null && liqThresholdPct != null && maxLtvPct != null) {
    if (ltvPct >= liqThresholdPct) health = 'DANGER'
    else if (ltvPct >= maxLtvPct) health = 'WARNING'
    else health = 'SAFE'
  } else if (ltvPct === 0) {
    health = 'SAFE'
  }
  return { collateralUsd, debtUsd, ltvPct, maxLtvPct, liqThresholdPct, health }
}

/* ---------- validation ---------- */
export function validateEarnInput(args: {
  amountHuman: string
  decimals: number
  balanceHuman: number | null
  walletConnected: boolean
}): string | null {
  if (!args.walletConnected) return 'Wallet not connected — connect Phantom to lend.'
  const n = Number(args.amountHuman)
  if (!args.amountHuman.trim() || !isFinite(n) || n <= 0) return 'Enter an amount greater than zero.'
  try {
    toBaseUnits(args.amountHuman, args.decimals)
  } catch (e) {
    return (e as Error).message
  }
  if (args.balanceHuman != null && n > args.balanceHuman) {
    return `Insufficient balance — wallet has ${args.balanceHuman.toFixed(4)}.`
  }
  return null
}

export function validateWithdrawInput(args: {
  amountHuman: string
  decimals: number
  suppliedHuman: number | null
  walletConnected: boolean
}): string | null {
  if (!args.walletConnected) return 'Wallet not connected — connect Phantom to withdraw.'
  const n = Number(args.amountHuman)
  if (!args.amountHuman.trim() || !isFinite(n) || n <= 0) return 'Enter an amount greater than zero.'
  try {
    toBaseUnits(args.amountHuman, args.decimals)
  } catch (e) {
    return (e as Error).message
  }
  if (args.suppliedHuman != null && n > args.suppliedHuman + 1e-12) {
    return `Exceeds supplied balance — you supplied ${args.suppliedHuman.toFixed(6)}.`
  }
  return null
}

export function validateOperateInput(args: {
  vault: BorrowVault
  colHuman: string
  debtHuman: string
  mode: 'deposit' | 'borrow' | 'repay' | 'withdraw' | 'deposit-borrow'
  walletConnected: boolean
  positionSupplyBase: string | null
  positionBorrowBase: string | null
}): string | null {
  if (!args.walletConnected) return 'Wallet not connected — connect Phantom to borrow.'
  const col = args.colHuman.trim() === '' ? 0 : Number(args.colHuman)
  const debt = args.debtHuman.trim() === '' ? 0 : Number(args.debtHuman)
  if (!isFinite(col) || !isFinite(debt)) return 'Invalid amount — digits and one dot only.'
  if (col < 0 || debt < 0) return 'Amounts must be positive — direction comes from the action button.'
  if (col === 0 && debt === 0) return 'Enter a collateral or borrow amount.'
  try {
    if (col > 0) toBaseUnits(String(col), args.vault.supplyToken.decimals)
    if (debt > 0) toBaseUnits(String(debt), args.vault.borrowToken.decimals)
  } catch (e) {
    return (e as Error).message
  }
  // Repay cannot exceed current debt (API accepts MIN_I128 for max — UI offers MAX separately).
  if ((args.mode === 'repay') && args.positionBorrowBase != null && debt > 0) {
    try {
      const owed = fromBaseUnits(args.positionBorrowBase, args.vault.borrowToken.decimals)
      if (debt > owed + 1e-12) return `Repay exceeds debt — you owe ${owed.toFixed(6)} ${args.vault.borrowToken.uiSymbol ?? args.vault.borrowToken.symbol}. Use MAX to clear dust.`
    } catch {
      /* fall through — chain is truth */
    }
  }
  if (args.mode === 'withdraw' && args.positionSupplyBase != null && col > 0) {
    try {
      const locked = fromBaseUnits(args.positionSupplyBase, args.vault.supplyToken.decimals)
      if (col > locked + 1e-12) return `Withdraw exceeds collateral — position holds ${locked.toFixed(6)}.`
    } catch {
      /* fall through */
    }
  }
  // Borrow minimum (dust guard from vault config).
  if ((args.mode === 'borrow' || args.mode === 'deposit-borrow') && debt > 0 && args.vault.minimumBorrowing) {
    try {
      const min = fromBaseUnits(args.vault.minimumBorrowing, args.vault.borrowToken.decimals)
      if (min > 0 && debt < min) {
        return `Below vault minimum — borrow at least ${min.toFixed(6)} ${args.vault.borrowToken.uiSymbol ?? args.vault.borrowToken.symbol}.`
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

/** Projected LTV guard: block obviously-invalid borrows client-side. */
export function validateProjectedLtv(vault: BorrowVault, projectedSupplyBase: string, projectedBorrowBase: string): string | null {
  const info = computeLtv(vault, projectedSupplyBase, projectedBorrowBase)
  if (info.ltvPct == null) return null // prices missing — let the chain decide, show honest note in UI
  if (info.liqThresholdPct != null && info.ltvPct >= info.liqThresholdPct) {
    return `Excessive LTV — projected ${info.ltvPct.toFixed(1)}% hits the liquidation threshold ${info.liqThresholdPct.toFixed(1)}%. Add collateral or borrow less.`
  }
  if (info.maxLtvPct != null && info.ltvPct > info.maxLtvPct) {
    return `Above max LTV — projected ${info.ltvPct.toFixed(1)}% exceeds ${info.maxLtvPct.toFixed(1)}% collateral factor. Add collateral or borrow less.`
  }
  return null
}

export function isWalletRejection(msg: string): boolean {
  return /reject|denied|cancel|user rejected|user cancelled|user canceled/i.test(msg)
}

/* ---------- transport: proxy-first, direct fallback ---------- */
export function isTransientFetchError(msg: string): boolean {
  return /timed out|timeout|abort|failed to fetch|load failed|networkerror|network error|econnreset|socket hang up|429|50[0-4]|gateway|temporarily|try again/i.test(msg)
}

export function shouldFallbackStatus(status: number): boolean {
  return status === 404 || status === 408 || status === 425 || status === 429 || status >= 500
}

export function friendlyLendError(msg: string): string {
  if (/timed out|timeout/i.test(msg)) return 'Request timed out — Jupiter Lend is slow right now. Tap REFRESH to retry.'
  if (/failed to fetch|load failed|networkerror|network error|econnreset|socket hang/i.test(msg)) {
    return 'Network hiccup reaching Jupiter Lend. Tap REFRESH to retry.'
  }
  return msg.length > 420 ? msg.slice(0, 420) : msg
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: unknown }> {
  const r = await fetch(url, init)
  const json = await r.json().catch(() => null)
  return { ok: r.ok, status: r.status, json }
}

function proxyErrorMessage(json: unknown, status: number, what: string): string {
  return (json as { error?: string; message?: string } | null)?.error
    ?? (json as { message?: string } | null)?.message
    ?? `${what} failed (HTTP ${status})`
}

async function proxyGet(path: string, timeoutMs: number): Promise<unknown> {
  const r = await fetchJson(`/api/lend?op=${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (r.ok) return r.json
  throw Object.assign(new Error(proxyErrorMessage(r.json, r.status, 'Jupiter Lend request')), { status: r.status })
}

async function proxyPost(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const r = await fetchJson(`/api/lend?op=${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (r.ok) return r.json
  throw Object.assign(new Error(proxyErrorMessage(r.json, r.status, 'Jupiter Lend request')), { status: r.status })
}

async function directGet(path: string, timeoutMs: number): Promise<unknown> {
  const r = await fetch(`${LEND_API_BASE}${path}`, {
    headers: { Accept: 'application/json', ...lendHeaders() },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) {
    throw Object.assign(
      new Error((j as { error?: string; message?: string } | null)?.error ?? (j as { message?: string } | null)?.message ?? `Jupiter Lend HTTP ${r.status}`),
      { status: r.status },
    )
  }
  return j
}

async function directPost(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const r = await fetch(`${LEND_API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...lendHeaders() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) {
    throw Object.assign(
      new Error((j as { error?: string; message?: string } | null)?.error ?? (j as { message?: string } | null)?.message ?? `Jupiter Lend HTTP ${r.status}`),
      { status: r.status },
    )
  }
  return j
}

/** GET with proxy-first, direct fallback on transient/proxy-missing statuses. */
async function lendGet(path: string, timeoutMs = 20_000): Promise<unknown> {
  try {
    return await proxyGet(path, timeoutMs)
  } catch (e) {
    const err = e as Error & { status?: number }
    const m = String(err.message ?? e)
    const retryable = (err.status != null && shouldFallbackStatus(err.status)) || isTransientFetchError(m)
    if (!retryable) throw e
  }
  return directGet(path, timeoutMs)
}

async function lendPost(path: string, body: unknown, timeoutMs = 30_000): Promise<unknown> {
  try {
    return await proxyPost(path, body, timeoutMs)
  } catch (e) {
    const err = e as Error & { status?: number }
    const m = String(err.message ?? e)
    const retryable = (err.status != null && shouldFallbackStatus(err.status)) || isTransientFetchError(m)
    if (!retryable) throw e
  }
  return directPost(path, body, timeoutMs)
}

/* ---------- Earn reads ---------- */
export async function fetchEarnTokens(): Promise<EarnToken[]> {
  const j = (await lendGet('/earn/tokens', 20_000)) as EarnToken[]
  if (!Array.isArray(j)) throw new Error('Jupiter Lend returned an unexpected token list — retry in a moment.')
  return j
}

export async function fetchEarnPositions(users: string[]): Promise<EarnPosition[]> {
  const list = users.map((u) => u.trim()).filter(Boolean)
  if (list.length === 0) return []
  const j = (await lendGet(`/earn/positions?users=${encodeURIComponent(list.join(','))}`, 20_000)) as EarnPosition[]
  if (!Array.isArray(j)) throw new Error('Jupiter Lend returned unexpected position data — retry in a moment.')
  return j
}

export async function fetchEarnEarnings(user: string, positions: string[]): Promise<EarnEarnings[]> {
  if (!user || positions.length === 0) return []
  const j = (await lendGet(
    `/earn/earnings?user=${encodeURIComponent(user)}&positions=${encodeURIComponent(positions.join(','))}`,
    20_000,
  )) as EarnEarnings[]
  if (!Array.isArray(j)) return []
  return j
}

/* ---------- Borrow reads ---------- */
export async function fetchBorrowVaults(market = 'main'): Promise<BorrowVault[]> {
  const j = (await lendGet(`/borrow/vaults?market=${encodeURIComponent(market)}`, 20_000)) as BorrowVault[]
  if (!Array.isArray(j)) throw new Error('Jupiter Lend returned an unexpected vault list — retry in a moment.')
  return j
}

export async function fetchBorrowPositions(users: string[], market = 'main'): Promise<BorrowPosition[]> {
  const list = users.map((u) => u.trim()).filter(Boolean)
  if (list.length === 0) return []
  const j = (await lendGet(
    `/borrow/positions?users=${encodeURIComponent(list.join(','))}&market=${encodeURIComponent(market)}`,
    20_000,
  )) as BorrowPosition[]
  if (!Array.isArray(j)) throw new Error('Jupiter Lend returned unexpected position data — retry in a moment.')
  return j
}

/* ---------- Earn transactions (unsigned base64) ---------- */
export async function buildEarnDepositTx(args: { asset: string; amountBase: string; signer: string }): Promise<EarnTxResponse> {
  const j = (await lendPost('/earn/deposit', { asset: args.asset, amount: args.amountBase, signer: args.signer }, 30_000)) as EarnTxResponse
  if (!j || typeof j.transaction !== 'string' || !j.transaction) throw new Error('Jupiter Lend returned no deposit transaction — retry with a fresh amount.')
  return j
}

export async function buildEarnWithdrawTx(args: { asset: string; amountBase: string; signer: string }): Promise<EarnTxResponse> {
  const j = (await lendPost('/earn/withdraw', { asset: args.asset, amount: args.amountBase, signer: args.signer }, 30_000)) as EarnTxResponse
  if (!j || typeof j.transaction !== 'string' || !j.transaction) throw new Error('Jupiter Lend returned no withdraw transaction — retry with a fresh amount.')
  return j
}

/* ---------- Borrow operate (unsigned base64) ---------- */
export interface OperateArgs {
  vaultId: number
  positionId: number
  signer: string
  colAmount: string
  debtAmount: string
  positionOwner?: string
  market?: string
}

export async function buildBorrowOperateTx(args: OperateArgs): Promise<OperateTxResponse> {
  const market = (args.market ?? 'main').trim() || 'main'
  const body: Record<string, unknown> = {
    vaultId: args.vaultId,
    positionId: args.positionId,
    signer: args.signer,
    colAmount: args.colAmount,
    debtAmount: args.debtAmount,
  }
  if (args.positionOwner) body.positionOwner = args.positionOwner
  const j = (await lendPost(`/borrow/operate?market=${encodeURIComponent(market)}`, body, 30_000)) as OperateTxResponse
  if (!j || typeof j.transaction !== 'string' || !j.transaction) throw new Error('Jupiter Lend returned no operate transaction — check amounts and retry.')
  if (typeof j.nftId !== 'number') throw new Error('Jupiter Lend returned a malformed operate response — retry in a moment.')
  return j
}

/* ---------- broadcast helpers (reuse CRT86 multi-RPC convention) ---------- */
export async function deserializeVersionedTx(b64: string): Promise<import('@solana/web3.js').VersionedTransaction> {
  const { VersionedTransaction } = await import('@solana/web3.js')
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  try {
    return VersionedTransaction.deserialize(raw)
  } catch {
    throw new Error('Jupiter Lend returned a transaction this wallet cannot read — retry in a moment.')
  }
}

export async function simulateVersionedTx(tx: import('@solana/web3.js').VersionedTransaction): Promise<{ ok: boolean; logs: string[]; err: unknown | null }> {
  for (const url of lendRpcCandidates()) {
    try {
      const { Connection } = await import('@solana/web3.js')
      const conn = new Connection(url, 'confirmed')
      const res = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true })
      const err = (res.value as { err?: unknown }).err ?? null
      const logs = (res.value as { logs?: string[] }).logs ?? []
      return { ok: !err, logs, err }
    } catch {
      /* next RPC */
    }
  }
  return { ok: false, logs: [], err: 'No Solana RPC reachable for simulation.' }
}

export async function broadcastSignedTx(signed: import('@solana/web3.js').VersionedTransaction): Promise<string> {
  const { Connection } = await import('@solana/web3.js')
  const raw = signed.serialize()
  let lastErr: string | null = null
  for (const url of lendRpcCandidates()) {
    try {
      const conn = new Connection(url, 'confirmed')
      const sig = await conn.sendRawTransaction(raw as Uint8Array, { skipPreflight: false, maxRetries: 3 })
      return sig
    } catch (e) {
      lastErr = String((e as Error).message ?? e)
    }
  }
  throw new Error(lastErr ?? 'Failed to broadcast transaction.')
}

export async function confirmSignature(sig: string): Promise<boolean> {
  const { Connection } = await import('@solana/web3.js')
  for (const url of lendRpcCandidates()) {
    try {
      const conn = new Connection(url, 'confirmed')
      const st = await conn.getSignatureStatus(sig, { searchTransactionHistory: true })
      const cs = st?.value?.confirmationStatus
      if (cs === 'confirmed' || cs === 'finalized') return true
      await conn.confirmTransaction(sig, 'confirmed').catch(() => {})
      const st2 = await conn.getSignatureStatus(sig, { searchTransactionHistory: true })
      if (st2?.value?.confirmationStatus) return true
    } catch {
      /* next */
    }
  }
  return false
}

/* ---------- wallet token balances (same RPC convention as DEX.EXE) ---------- */
export async function getTokenBalanceHuman(ownerBase58: string, mint: string): Promise<number | null> {
  for (const url of lendRpcCandidates()) {
    try {
      const { Connection, PublicKey } = await import('@solana/web3.js')
      const conn = new Connection(url, 'confirmed')
      const owner = new PublicKey(ownerBase58)
      if (mint === 'So11111111111111111111111111111111111111112') {
        const lamports = await conn.getBalance(owner)
        return lamports / 1e9
      }
      const mintPk = new PublicKey(mint)
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
