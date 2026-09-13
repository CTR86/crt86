/* Pure validation + fee helpers for the DIRECT engine.
   No network, no wallet — fully unit-testable. */

import { KEEPER_THRESHOLDS, NATIVE_SOL_MINT, PLATFORM_FEE_BPS, USDC_MINT } from './config'

export interface DirectForm {
  name: string
  symbol: string
  uri: string
  quoteMint: string
  customQuoteMint?: string
  firstBuyMode: 'none' | 'quote'
  firstBuyAmount: string
  slippageBps: number
}

export function byteLen(s: string): number {
  return new TextEncoder().encode(s).length
}

export function isValidSolanaAddress(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((s ?? '').trim())
}

export function validateName(name: string): string | null {
  const b = byteLen(name.trim())
  if (b < 1) return 'Name is required.'
  if (b > 32) return 'Name exceeds 32 bytes.'
  return null
}

export function validateSymbol(symbol: string): string | null {
  const b = byteLen(symbol.trim())
  if (b < 1) return 'Symbol is required.'
  if (b > 10) return 'Symbol exceeds 10 bytes.'
  return null
}

export function validateUri(uri: string): string | null {
  const u = uri.trim()
  if (!u) return 'Metadata URI is required.'
  if (!/^https?:\/\//i.test(u)) return 'Metadata URI must start with http(s)://.'
  if (u.length > 512) return 'Metadata URI is too long (max 512 chars).'
  return null
}

/** Effective quote mint: preset SOL/USDC or a custom SPL mint. */
export function effectiveQuoteMint(form: Pick<DirectForm, 'quoteMint' | 'customQuoteMint'>): string {
  if (form.quoteMint === 'CUSTOM') return (form.customQuoteMint ?? '').trim()
  return form.quoteMint.trim()
}

export function isKeeperSupportedQuote(mint: string): boolean {
  return KEEPER_THRESHOLDS.some((k) => k.mint === mint)
}

export function validateQuoteMint(form: Pick<DirectForm, 'quoteMint' | 'customQuoteMint'>): string | null {
  const mint = effectiveQuoteMint(form)
  if (!mint) return 'Pick a quote pair.'
  if (!isValidSolanaAddress(mint)) return 'Quote mint is not a valid Solana address.'
  return null
}

export function quoteAutoMigrationWarning(mint: string): string | null {
  if (!mint || !isValidSolanaAddress(mint)) return null
  if (isKeeperSupportedQuote(mint)) return null
  return (
    'Custom quote mint: the protocol supports it, but Meteora keepers only ' +
    'auto-migrate keeper-listed quotes (SOL 10 / USDC 750 + equivalents). ' +
    'Graduation may require manual migration.'
  )
}

export function validateFirstBuy(mode: DirectForm['firstBuyMode'], amount: string): string | null {
  if (mode === 'none') return null
  const n = Number(amount)
  if (!isFinite(n) || n <= 0) return 'First-buy amount must be > 0.'
  if (n > 1_000_000) return 'First-buy amount looks unrealistic.'
  return null
}

export function validateSlippage(bps: number): string | null {
  if (!isFinite(bps) || bps < 1 || bps > 5000) return 'Slippage must be 1–5000 bps.'
  return null
}

export function validateDirectForm(form: DirectForm): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const n = validateName(form.name)
  if (n) errors.name = n
  const s = validateSymbol(form.symbol)
  if (s) errors.symbol = s
  const u = validateUri(form.uri)
  if (u) errors.uri = u
  const q = validateQuoteMint(form)
  if (q) errors.quoteMint = q
  const f = validateFirstBuy(form.firstBuyMode, form.firstBuyAmount)
  if (f) errors.firstBuy = f
  const sl = validateSlippage(form.slippageBps)
  if (sl) errors.slippage = sl
  return { ok: Object.keys(errors).length === 0, errors }
}

/** Stage-1 gate: name + symbol + uri (mirrors LaunchDeck stage1Ok). */
export function stage1OkDirect(form: Pick<DirectForm, 'name' | 'symbol' | 'uri'>): boolean {
  return !validateName(form.name) && !validateSymbol(form.symbol) && !validateUri(form.uri)
}

/** Platform fee in quote units. Policy: launchers pay ZERO to us, so this
 *  stays 0 while VITE_PLATFORM_FEE_BPS=0. Kept as a helper only. */
export function platformFeeOnAmount(amountQuote: number): number {
  if (!isFinite(amountQuote) || amountQuote <= 0) return 0
  return (amountQuote * PLATFORM_FEE_BPS) / 10_000
}

/** Quote decimals for UI formatting (SOL 9, USDC 6, custom defaults 9). */
export function quoteDecimals(mint: string): number {
  if (mint === NATIVE_SOL_MINT) return 9
  if (mint === USDC_MINT) return 6
  return 9
}

/** Graduation threshold label for a quote mint, or null when custom/manual. */
export function graduationLabelFor(mint: string): string | null {
  const k = KEEPER_THRESHOLDS.find((t) => t.mint === mint)
  return k ? k.thresholdLabel : null
}
