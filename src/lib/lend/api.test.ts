import { describe, it, expect } from 'vitest'
import {
  borrowRatePct,
  computeLtv,
  earnRatePct,
  factorPct,
  formatBorrowRate,
  formatFactorPct,
  formatRatePct,
  fromBaseUnits,
  toBaseUnits,
  validateEarnInput,
  validateOperateInput,
  validateProjectedLtv,
  validateWithdrawInput,
  type BorrowVault,
} from './api'

const vault = (o: Partial<BorrowVault> = {}): BorrowVault =>
  ({
    id: 1,
    address: 'vault-addr',
    supplyToken: { address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'WSOL', uiSymbol: 'SOL', decimals: 9, price: '170' },
    borrowToken: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USD Coin', symbol: 'USDC', uiSymbol: 'USDC', decimals: 6, price: '1' },
    collateralFactor: '800',
    liquidationThreshold: '850',
    borrowRate: '471',
    minimumBorrowing: '1000000',
    ...o,
  }) as BorrowVault

describe('lend amount math', () => {
  it('converts human to base units exactly', () => {
    expect(toBaseUnits('1', 9)).toBe('1000000000')
    expect(toBaseUnits('1.5', 6)).toBe('1500000')
  })
  it('rejects zero and over-precision', () => {
    expect(() => toBaseUnits('0', 6)).toThrow()
    expect(() => toBaseUnits('1.1234567', 6)).toThrow(/decimals/i)
  })
  it('converts base units back', () => {
    expect(fromBaseUnits('1000000000', 9)).toBeCloseTo(1, 9)
  })
})

describe('lend rate formatting (real API values only)', () => {
  it('formats earn rates as percent (fraction and live bps style)', () => {
    expect(earnRatePct('0.06')).toBeCloseTo(6, 9)
    expect(formatRatePct('0.06')).toBe('6.00%')
    expect(earnRatePct('488')).toBeCloseTo(4.88, 9)
    expect(formatRatePct('488')).toBe('4.88%')
    expect(formatRatePct(null)).toBe('—')
    expect(formatRatePct('garbage')).toBe('—')
  })
  it('formats per-mille factors', () => {
    expect(factorPct('800')).toBeCloseTo(80, 9)
    expect(formatFactorPct('850')).toBe('85.0%')
  })
  it('formats bps-style borrow rates', () => {
    expect(borrowRatePct('471')).toBeCloseTo(4.71, 9)
    expect(formatBorrowRate('471')).toBe('4.71%')
  })
})

describe('lend earn validation', () => {
  it('requires wallet', () => {
    expect(validateEarnInput({ amountHuman: '1', decimals: 6, balanceHuman: 5, walletConnected: false })).toMatch(/not connected/i)
  })
  it('rejects insufficient balance', () => {
    expect(validateEarnInput({ amountHuman: '99', decimals: 6, balanceHuman: 5, walletConnected: true })).toMatch(/insufficient balance/i)
  })
  it('rejects withdraw above supplied', () => {
    expect(validateWithdrawInput({ amountHuman: '99', decimals: 6, suppliedHuman: 1, walletConnected: true })).toMatch(/exceeds supplied/i)
  })
  it('accepts valid earn input', () => {
    expect(validateEarnInput({ amountHuman: '1.5', decimals: 6, balanceHuman: 5, walletConnected: true })).toBeNull()
  })
})

describe('lend borrow validation', () => {
  const base = { vault: vault(), walletConnected: true, positionSupplyBase: null, positionBorrowBase: null }
  it('rejects empty amounts', () => {
    expect(validateOperateInput({ ...base, colHuman: '', debtHuman: '', mode: 'deposit' })).toMatch(/enter/i)
  })
  it('enforces vault minimum borrowing', () => {
    expect(validateOperateInput({ ...base, colHuman: '', debtHuman: '0.5', mode: 'borrow' })).toMatch(/minimum/i)
  })
  it('rejects repay above debt', () => {
    expect(
      validateOperateInput({ ...base, colHuman: '', debtHuman: '50', mode: 'repay', positionBorrowBase: '10000000' }),
    ).toMatch(/exceeds debt/i)
  })
  it('accepts a valid deposit', () => {
    expect(validateOperateInput({ ...base, colHuman: '0.5', debtHuman: '', mode: 'deposit' })).toBeNull()
  })
})

describe('lend LTV guards', () => {
  it('computes LTV from real prices', () => {
    // 1 SOL ($170) collateral, 100 USDC ($100) debt → ~58.8% LTV
    const info = computeLtv(vault(), '1000000000', '100000000')
    expect(info.ltvPct).toBeCloseTo(58.82, 1)
    expect(info.maxLtvPct).toBeCloseTo(80, 9)
    expect(info.health).toBe('SAFE')
  })
  it('blocks excessive LTV client-side', () => {
    // 1 SOL ($170) vs 160 USDC ($160) → ~94% ≥ liq 85%
    const err = validateProjectedLtv(vault(), '1000000000', '160000000')
    expect(err).toMatch(/liquidation|excessive/i)
  })
  it('returns unknown when prices are missing (chain is truth)', () => {
    const v = vault({ supplyToken: { ...vault().supplyToken, price: undefined }, borrowToken: { ...vault().borrowToken, price: undefined } })
    const info = computeLtv(v, '1000000000', '100000000')
    expect(info.ltvPct).toBeNull()
    expect(validateProjectedLtv(v, '1000000000', '100000000')).toBeNull()
  })
})
