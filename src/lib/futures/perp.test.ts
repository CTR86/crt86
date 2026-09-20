import { describe, it, expect } from 'vitest'
import {
  buildApproveAgentAction,
  buildCancelAction,
  buildLeverageAction,
  buildOrderAction,
  buildOrderWire,
  floatToWire,
  floorToDecimals,
  formatLimitPx,
  parseOrderStatuses,
  randomCloid,
} from './hlWire'
import { roundDownToStep, roundToTick } from './aster'

describe('hl float_to_wire (mirrors Python SDK)', () => {
  it('normalizes without trailing zeros', () => {
    expect(floatToWire(1891.4)).toBe('1891.4')
    expect(floatToWire(1)).toBe('1')
    expect(floatToWire(0.0000125)).toBe('0.0000125')
  })
  it('rejects over-precision and non-numbers', () => {
    expect(() => floatToWire(0.123456789)).toThrow(/8 decimals/i)
    expect(() => floatToWire(NaN)).toThrow()
    expect(() => floatToWire(Infinity)).toThrow()
  })
})

describe('hl size and price formatting', () => {
  it('floors size to lot step, never overbuys', () => {
    expect(floorToDecimals(1.234, 2)).toBe(1.23)
    expect(floorToDecimals(1.9, 0)).toBe(1)
    expect(() => floorToDecimals(0.001, 2)).toThrow(/minimum lot/i)
  })
  it('caps limit price decimals', () => {
    expect(formatLimitPx(80731.5432109)).toBe('80731.54321')
    expect(() => formatLimitPx(0)).toThrow()
  })
  it('builds order wires in SDK key order a,b,p,s,r,t', () => {
    const w = buildOrderWire({ asset: 0, isBuy: true, limitPx: 80000, size: 0.01, reduceOnly: false, tif: 'Gtc' })
    expect(Object.keys(w)).toEqual(['a', 'b', 'p', 's', 'r', 't'])
    expect(w).toMatchObject({ a: 0, b: true, p: '80000', s: '0.01', r: false, t: { limit: { tif: 'Gtc' } } })
  })
  it('wraps wires in a na-grouped order action', () => {
    const w = buildOrderWire({ asset: 3, isBuy: false, limitPx: 100, size: 0.5, reduceOnly: true, tif: 'Ioc' })
    expect(buildOrderAction([w])).toEqual({ type: 'order', orders: [w], grouping: 'na' })
    expect(() => buildOrderAction([])).toThrow()
  })
  it('generates valid cloids', () => {
    expect(randomCloid()).toMatch(/^0x[0-9a-f]{32}$/)
  })
  it('builds cancel and leverage actions', () => {
    expect(buildCancelAction(3, 123)).toEqual({ type: 'cancel', cancels: [{ a: 3, o: 123 }] })
    expect(buildLeverageAction(3, 10)).toEqual({ type: 'updateLeverage', asset: 3, isCross: true, leverage: 10 })
    expect(() => buildLeverageAction(3, 0)).toThrow()
  })
  it('builds approve-agent with lowercase address', () => {
    const a = buildApproveAgentAction({
      testnet: true,
      agentAddress: '0xABCDEF0000000000000000000000000000000001',
      agentName: 'crt',
      nonce: 1,
    })
    expect(a.hyperliquidChain).toBe('Testnet')
    expect(a.agentAddress).toBe('0xabcdef0000000000000000000000000000000001')
    expect(a.signatureChainId).toBe('0x66eee')
  })
})

describe('hl order status parsing', () => {
  it('parses filled, resting and error honestly', () => {
    const [f] = parseOrderStatuses({ status: 'ok', response: { type: 'order', data: { statuses: [{ filled: { oid: 1, avgPx: '5', totalSz: '2' } }] } } })
    expect(f.kind).toBe('filled')
    const [r] = parseOrderStatuses({ status: 'ok', response: { type: 'order', data: { statuses: [{ resting: { oid: 2 } }] } } })
    expect(r.kind).toBe('resting')
    const [e] = parseOrderStatuses({ status: 'ok', response: { type: 'order', data: { statuses: [{ error: 'Order must have minimum value of $10.' }] } } })
    expect(e.kind).toBe('error')
  })
  it('throws on missing statuses', () => {
    expect(() => parseOrderStatuses({ status: 'err', response: 'nope' })).toThrow()
  })
})

describe('aster rounding (filter-exact)', () => {
  it('floors qty to stepSize', () => {
    expect(roundDownToStep(1.234, 0.01)).toBe(1.23)
    expect(roundDownToStep(10, 1)).toBe(10)
    expect(() => roundDownToStep(0.001, 0.01)).toThrow(/minimum lot/i)
  })
  it('rounds price to tickSize', () => {
    expect(roundToTick(80731.546, 0.1)).toBe(80731.5)
    expect(roundToTick(0.51234, 0.0001)).toBe(0.5123)
  })
})
