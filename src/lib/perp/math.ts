/* PERP.EXE — pure math / validation helpers (no wallet, no network).
   Every value that touches the chain is double-checked here first. */

import { PERP_EST_OPEN_FEE_BPS, PERP_MAX_LEVERAGE_UI, PERP_MIN_LEVERAGE } from './config'
import type { PerpMarket, PerpSide } from './config'
import type { PerpQuote } from './types'

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function validateLeverage(n: number): string | null {
  if (!isFinite(n)) return 'Leverage must be a number.'
  if (n < PERP_MIN_LEVERAGE) return `Leverage too low — minimum ${PERP_MIN_LEVERAGE}×.`
  if (n > 250) return 'Leverage too high — maximum 250×.'
  if (n > PERP_MAX_LEVERAGE_UI) return `Leverage above ${PERP_MAX_LEVERAGE_UI}× is high risk — confirm you intend to exceed the UI guard.`
  return null
}

export function validateCollateral(market: PerpMarket | undefined, amount: string): string | null {
  if (!market) return 'Pick a market.'
  const n = Number(amount)
  if (!amount.trim() || !isFinite(n) || n <= 0) return `Collateral must be > 0 ${market.collateralSymbol}.`
  if (n > 1_000_000_000) return 'Collateral looks unrealistic.'
  return null
}

export function sizeUsdFrom(collateralHuman: number, collateralPriceUsd: number, leverage: number): number {
  if (!isFinite(collateralHuman) || !isFinite(collateralPriceUsd) || !isFinite(leverage)) return 0
  return collateralHuman * collateralPriceUsd * leverage
}

// Estimated liquidation price — not keeper-exact. Jupiter custody uses
// a maintenance margin fraction + borrow spread baked into the Position
// account; this estimate uses a 90% buffer so displayed liq is slightly
// conservative (obvious in UI text). Never present as on-chain truth.
export function estimateLiqPrice(entry: number, side: PerpSide, leverage: number): number | null {
  if (!isFinite(entry) || entry <= 0 || !isFinite(leverage) || leverage < PERP_MIN_LEVERAGE) return null
  const buffer = 0.9 // 90 % of collateral-to-size ratio
  const distance = buffer / leverage
  if (side === 'long') return entry * (1 - distance)
  return entry * (1 + distance)
}

export function estimateOpenFeeUsd(sizeUsd: number): number {
  return (sizeUsd * PERP_EST_OPEN_FEE_BPS) / 10_000
}

// Unrealized PnL in USD (collateral-settled, no funding/borrow included —
// those shave a bit off real PnL and we label it "ex-funding" in UI).
export function unrealizedPnlUsd(entry: number, mark: number, side: PerpSide, sizeUsd: number): number | null {
  if (!isFinite(entry) || entry <= 0 || !isFinite(mark) || mark <= 0 || !isFinite(sizeUsd) || sizeUsd <= 0) return null
  const ret = side === 'long' ? (mark - entry) / entry : (entry - mark) / entry
  return ret * sizeUsd
}

export function pnlPctFrom(pnlUsd: number, collateralUsd: number): number | null {
  if (!isFinite(pnlUsd) || !isFinite(collateralUsd) || collateralUsd <= 0) return null
  return (pnlUsd / collateralUsd) * 100
}

// Builds a quote preview from user inputs + live price. Never touches wallet.
export function buildQuote(args: {
  market: PerpMarket
  side: PerpSide
  collateralHuman: number
  collateralPriceUsd: number
  leverage: number
  entryPrice: number
  priceUpdatedAt: number
}): PerpQuote {
  const { market, side, collateralHuman, collateralPriceUsd, leverage, entryPrice, priceUpdatedAt } = args
  const collateralUsd = collateralHuman * collateralPriceUsd
  const sizeUsd = collateralUsd * leverage
  const liqPrice = estimateLiqPrice(entryPrice, side, leverage)
  const openFeeUsd = estimateOpenFeeUsd(sizeUsd)
  const closeFeeUsd = openFeeUsd
  const totalFeesUsd = openFeeUsd + closeFeeUsd
  const stale = Date.now() - priceUpdatedAt > 60_000
  const warnings: string[] = []
  if (stale) warnings.push('Price is stale (> 60s) — re-quote before signing.')
  if (leverage > 50) warnings.push('High leverage — liquidation is close. Reduce collateral risk.')
  if (collateralUsd < 5) warnings.push('Collateral below $5 may be rejected by the keeper (dust).')
  return {
    market,
    side,
    collateral: collateralHuman,
    collateralUsd,
    leverage,
    sizeUsd,
    entryPrice,
    liqPrice,
    openFeeUsd,
    closeFeeUsd,
    priceImpactBps: 0,
    totalFeesUsd,
    stale,
    warnings,
  }
}

export function fmtLeverage(n: number): string {
  return `${n.toFixed(n >= 10 ? 0 : 1)}×`
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  if (Math.abs(n) >= 10_000) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n !== 0 && Math.abs(n) < 0.01) return '$' + n.toPrecision(3)
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtPrice(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(4)
  return n.toFixed(6)
}
