import { describe, it, expect } from 'vitest'
import {
  isExecutableRouting,
  parseApiQuoteResponse,
  parseApiSwapResponse,
} from './uniswapApi'

const classicBody = {
  chainId: 56,
  input: { amount: '1000000000000000000', token: '0x0000000000000000000000000000000000000000' },
  output: { amount: '612345678901234567890', token: '0x55d398326f99059fF775485246999027B3197955' },
  routeString: '[V3] 100% = BNB -- 0.30% USDT',
  priceImpact: 0.12,
  gasFeeUSD: '0.05',
  txFailureReasons: [],
}

describe('uniswap api routing gate', () => {
  it('executes CLASSIC only', () => {
    expect(isExecutableRouting('CLASSIC')).toBe(true)
    expect(isExecutableRouting('classic')).toBe(true)
    for (const r of ['DUTCH_V2', 'DUTCH_V3', 'PRIORITY', 'BRIDGE', 'WRAP', 'UNWRAP', 'CHAINED', '']) {
      expect(isExecutableRouting(r)).toBe(false)
    }
  })
})

describe('uniswap api quote parsing', () => {
  it('parses a CLASSIC quote without fabricating', () => {
    const q = parseApiQuoteResponse({ routing: 'CLASSIC', quote: classicBody, permitData: null })
    expect(q.routing).toBe('CLASSIC')
    expect(q.classic!.amountOut).toBe(612345678901234567890n)
    expect(q.classic!.routeString).toMatch(/V3/)
    expect(q.permitData).toBeNull()
  })

  it('keeps valid permitData for the gasless path', () => {
    const permitData = {
      domain: { name: 'Permit2', chainId: 56, verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3' },
      types: { PermitSingle: [{ name: 'details', type: 'PermitDetails' }] },
      values: { details: {}, spender: '0x000000000022D473030F116dDEE9F6B43aC78BA3', sigDeadline: '999' },
    }
    const q = parseApiQuoteResponse({ routing: 'CLASSIC', quote: classicBody, permitData })
    expect(q.permitData).not.toBeNull()
  })

  it('rejects non-CLASSIC routing so the provider falls back on-chain', () => {
    expect(() => parseApiQuoteResponse({ routing: 'DUTCH_V2', quote: classicBody })).toThrow(/off-chain order flow/i)
  })

  it('rejects zero-output and failed simulations honestly', () => {
    expect(() => parseApiQuoteResponse({ routing: 'CLASSIC', quote: { ...classicBody, output: { amount: '0' } } })).toThrow(
      /zero output/i,
    )
    expect(() =>
      parseApiQuoteResponse({
        routing: 'CLASSIC',
        quote: { ...classicBody, output: { amount: '0' }, txFailureReasons: ['insufficient liquidity'] },
      }),
    ).toThrow(/insufficient liquidity/i)
  })

  it('rejects empty/missing bodies', () => {
    expect(() => parseApiQuoteResponse(null)).toThrow()
    expect(() => parseApiQuoteResponse({})).toThrow()
    expect(() => parseApiQuoteResponse({ routing: 'CLASSIC' })).toThrow(/missing quote body/i)
  })
})

describe('uniswap api swap parsing', () => {
  it('parses a swap tx without fabricating', () => {
    const s = parseApiSwapResponse({
      requestId: 'req-1',
      swap: {
        to: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2',
        data: '0x1234abcd',
        value: '1000000000000000000',
      },
    })
    expect(s.to).toBe('0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2')
    expect(s.data).toBe('0x1234abcd')
    expect(s.value).toBe('0xde0b6b3a7640000')
  })

  it('omits zero value', () => {
    const s = parseApiSwapResponse({
      swap: { to: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2', data: '0x1234abcd', value: '0' },
    })
    expect(s.value).toBeUndefined()
  })

  it('rejects bad targets and calldata', () => {
    expect(() => parseApiSwapResponse({ swap: { to: 'nope', data: '0x1234' } })).toThrow(/invalid swap target/i)
    expect(() =>
      parseApiSwapResponse({ swap: { to: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2', data: '0x' } }),
    ).toThrow(/invalid swap calldata/i)
    expect(() => parseApiSwapResponse({})).toThrow()
  })
})
