import { describe, it, expect } from 'vitest'
import {
  fromBaseUnits,
  isQuoteStale,
  isWalletRejection,
  mapExecuteError,
  mapOrderError,
  parseOrder,
  toBaseUnits,
  validateSwapInput,
  type OrderResponse,
} from './api'

const order = (o: Partial<OrderResponse>): OrderResponse =>
  ({
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    inAmount: '1000000000',
    outAmount: '150000000',
    requestId: 'req-1',
    transaction: 'tx-b64',
    ...o,
  }) as OrderResponse

describe('dex amount math', () => {
  it('converts human to base units exactly', () => {
    expect(toBaseUnits('1', 9)).toBe('1000000000')
    expect(toBaseUnits('0.5', 6)).toBe('500000')
    expect(toBaseUnits('1.234567', 6)).toBe('1234567')
  })

  it('rejects zero, empty and over-precision amounts', () => {
    expect(() => toBaseUnits('0', 6)).toThrow()
    expect(() => toBaseUnits('', 6)).toThrow()
    expect(() => toBaseUnits('1.1234567', 6)).toThrow(/decimals/i)
    expect(() => toBaseUnits('abc', 6)).toThrow(/invalid amount/i)
  })

  it('converts base units back to human', () => {
    expect(fromBaseUnits('1000000000', 9)).toBeCloseTo(1, 9)
    expect(fromBaseUnits('150000000', 6)).toBeCloseTo(150, 9)
  })
})

describe('dex input validation', () => {
  const base = {
    inputDecimals: 9,
    balanceHuman: 5,
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    walletConnected: true,
  }
  it('requires wallet', () => {
    expect(validateSwapInput({ ...base, amountHuman: '1', walletConnected: false })).toMatch(/not connected/i)
  })
  it('rejects same-mint pairs', () => {
    expect(
      validateSwapInput({ ...base, amountHuman: '1', outputMint: base.inputMint }),
    ).toMatch(/must differ/i)
  })
  it('rejects zero and bad amounts', () => {
    expect(validateSwapInput({ ...base, amountHuman: '0' })).toMatch(/greater than zero/i)
    expect(validateSwapInput({ ...base, amountHuman: '' })).toMatch(/greater than zero/i)
  })
  it('rejects insufficient balance', () => {
    expect(validateSwapInput({ ...base, amountHuman: '99' })).toMatch(/insufficient balance/i)
  })
  it('accepts a valid input', () => {
    expect(validateSwapInput({ ...base, amountHuman: '1.5' })).toBeNull()
  })
})

describe('dex jupiter errors', () => {
  it('maps aggregator insufficient-funds code', () => {
    expect(mapOrderError(order({ router: 'metis', errorCode: 1 })) ).toMatch(/insufficient funds/i)
  })
  it('maps aggregator no-gas code', () => {
    expect(mapOrderError(order({ router: 'metis', errorCode: 2 }))).toMatch(/SOL for gas/i)
  })
  it('maps jupiterz codes separately', () => {
    expect(mapOrderError(order({ router: 'jupiterz', errorCode: 2 }))).toMatch(/token account/i)
  })
  it('maps execute expiry codes', () => {
    expect(mapExecuteError(-1)).toMatch(/expired|re-quote/i)
    expect(mapExecuteError(-2003)).toMatch(/expired/i)
    expect(mapExecuteError(0)).toBe('')
  })
  it('detects wallet rejection', () => {
    expect(isWalletRejection('User rejected the request')).toBe(true)
    expect(isWalletRejection('Transaction failed on-chain')).toBe(false)
  })
})

describe('dex quote parsing', () => {
  it('derives rate and router without fabricating', () => {
    const p = parseOrder(
      order({ inAmount: '1000000000', outAmount: '150000000', router: 'jupiterz', priceImpact: -0.05 }),
      9,
      6,
    )
    expect(p.outHuman).toBeCloseTo(150, 9)
    expect(p.rate).toBeCloseTo(150, 9)
    expect(p.routerLabel).toBe('JUPITERZ')
    expect(p.priceImpactPct).toBeCloseTo(-0.05, 9)
  })

  it('extracts route labels when present', () => {
    const p = parseOrder(
      order({ routePlan: [{ swapInfo: { label: 'Raydium' }, percent: 100 }] }),
      9,
      6,
    )
    expect(p.routeLabels).toEqual(['Raydium'])
  })

  it('flags stale quotes by age', () => {
    expect(isQuoteStale(Date.now() - 60_000, null)).toBe(true)
    expect(isQuoteStale(Date.now(), null)).toBe(false)
  })

  it('honours RFQ expiry timestamps', () => {
    expect(isQuoteStale(Date.now(), Date.now() - 1_000)).toBe(true)
    expect(isQuoteStale(Date.now(), Date.now() + 60_000)).toBe(false)
  })
})
