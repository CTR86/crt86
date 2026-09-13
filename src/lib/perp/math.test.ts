import { describe, it, expect } from 'vitest'
import { estimateLiqPrice, buildQuote, validateLeverage, validateCollateral, unrealizedPnlUsd, sizeUsdFrom, pnlPctFrom } from './math'
import { PERP_MARKETS } from './config'

describe('perp math', () => {
  it('estimates liquidation long below entry, short above', () => {
    const long = estimateLiqPrice(100, 'long', 10)
    const short = estimateLiqPrice(100, 'short', 10)
    expect(long!).toBeLessThan(100)
    expect(short!).toBeGreaterThan(100)
    expect(long).toBeCloseTo(91, 0) // 100 * (1 - 0.9/10)
    expect(short).toBeCloseTo(109, 0)
  })

  it('higher leverage is closer to entry', () => {
    const low = estimateLiqPrice(200, 'long', 5)!
    const high = estimateLiqPrice(200, 'long', 50)!
    expect(high).toBeGreaterThan(low)
    expect(high).toBeCloseTo(200 * (1 - 0.9 / 50), 5)
  })

  it('rejects invalid leverage', () => {
    expect(validateLeverage(0.5)).toMatch(/too low/i)
    expect(validateLeverage(251)).toMatch(/too high/i)
    expect(validateLeverage(5)).toBeNull()
    expect(validateLeverage(120)).toMatch(/high risk/i) // above UI guard but still allowed with warning
  })

  it('validates collateral', () => {
    const m = PERP_MARKETS[0]
    expect(validateCollateral(m, '')).toMatch(/>/)
    expect(validateCollateral(m, '0')).toMatch(/>/)
    expect(validateCollateral(m, '1')).toBeNull()
    expect(validateCollateral(undefined, '1')).toMatch(/Pick a market/)
  })

  it('computes sizeUsd', () => {
    expect(sizeUsdFrom(2, 150, 5)).toBe(1500) // 2 SOL * $150 * 5x
    expect(sizeUsdFrom(100, 1, 10)).toBe(1000) // USDC short
  })

  it('unrealized PnL long profits when mark > entry', () => {
    expect(unrealizedPnlUsd(100, 110, 'long', 1000)).toBeCloseTo(100, 5)
    expect(unrealizedPnlUsd(100, 90, 'long', 1000)).toBeCloseTo(-100, 5)
    expect(unrealizedPnlUsd(100, 90, 'short', 1000)).toBeCloseTo(100, 5)
  })

  it('pnl pct', () => {
    expect(pnlPctFrom(50, 100)).toBe(50)
    expect(pnlPctFrom(-20, 100)).toBe(-20)
    expect(pnlPctFrom(10, 0)).toBeNull()
  })

  it('buildQuote derives fields', () => {
    const market = PERP_MARKETS[0] // SOL LONG
    const q = buildQuote({
      market, side: 'long', collateralHuman: 1, collateralPriceUsd: 150, leverage: 5, entryPrice: 150, priceUpdatedAt: Date.now(),
    })
    expect(q.sizeUsd).toBe(750)
    expect(q.collateralUsd).toBe(150)
    expect(q.liqPrice!).toBeLessThan(150)
    expect(q.openFeeUsd).toBeCloseTo(750 * 0.0006, 5)
    expect(q.stale).toBe(false)
  })

  it('flags stale price', () => {
    const market = PERP_MARKETS[0]
    const q = buildQuote({
      market, side: 'long', collateralHuman: 1, collateralPriceUsd: 150, leverage: 5, entryPrice: 150, priceUpdatedAt: Date.now() - 70_000,
    })
    expect(q.stale).toBe(true)
    expect(q.warnings.join(' ')).toMatch(/stale/i)
  })
})
