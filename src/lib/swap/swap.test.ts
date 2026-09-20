import { describe, it, expect } from 'vitest'
import {
  applySlippageBps,
  baseToHuman,
  humanToBase,
  isEvmQuoteStale,
  mapEvmTxError,
  validateEvmSwapInput,
  EVM_QUOTE_STALE_AFTER_MS,
} from './amount'
import { EVM_CHAINS, PANCAKE_CHAIN_IDS, UNISWAP_CHAIN_IDS, addChainParams, evmChain } from './chains'
import { NATIVE_SENTINEL, popularTokens } from './tokens'
import { pancakePathCandidates } from './pancakeswap'
import { UNISWAP_FEE_TIERS } from './uniswap'

const HEX40 = /^0x[0-9a-fA-F]{40}$/

describe('swap slippage math', () => {
  it('applies bps exactly in bigint (no float drift)', () => {
    expect(applySlippageBps(1000n, 50)).toBe(995n)
    expect(applySlippageBps(1000n, 0)).toBe(1000n)
    expect(applySlippageBps(0n, 50)).toBe(0n)
    // rounds down — min-receive never overpromises
    expect(applySlippageBps(999n, 50)).toBe(994n)
  })

  it('round-trips human <-> base units', () => {
    expect(humanToBase('1', 18)).toBe(10n ** 18n)
    expect(humanToBase('0.5', 6)).toBe(500000n)
    expect(baseToHuman(10n ** 18n, 18)).toBeCloseTo(1, 9)
    expect(() => humanToBase('0', 18)).toThrow()
    expect(() => humanToBase('1.1234567', 6)).toThrow(/decimals/i)
  })
})

describe('swap chain registry', () => {
  it('enables only chains with a verified execution path (on-chain deployment and/or API)', () => {
    // API-covered chains (live-verified via GET /v1/supported_chains).
    const API_CHAINS = [56, 1, 8453, 42161, 137, 43114]
    for (const id of UNISWAP_CHAIN_IDS) {
      expect(API_CHAINS, `chain ${id} not covered by the Trading API`).toContain(id)
      const c = evmChain(id)
      // Where an on-chain deployment is registered, its addresses must be exact.
      if (c.uniswapV3) {
        expect(c.uniswapV3.quoterV2).toMatch(HEX40)
        expect(c.uniswapV3.swapRouter02).toMatch(HEX40)
      }
    }
    for (const id of PANCAKE_CHAIN_IDS) {
      const c = evmChain(id)
      expect(c.pancakeV2Router, `chain ${id} missing verified Pancake router`).not.toBeNull()
      expect(c.pancakeV2Router!).toMatch(HEX40)
    }
  })

  it('BNB Chain is supported by both providers', () => {
    expect(UNISWAP_CHAIN_IDS).toContain(56)
    expect(PANCAKE_CHAIN_IDS).toContain(56)
  })

  it('wallet chain-id hex matches the numeric id', () => {
    for (const [id, c] of Object.entries(EVM_CHAINS)) {
      expect(c.hex.toLowerCase()).toBe(`0x${Number(id).toString(16)}`)
      expect(c.rpcs.length).toBeGreaterThan(0)
      expect(c.wrappedNative).toMatch(HEX40)
    }
  })

  it('builds wallet_addEthereumChain params from the registry', () => {
    const p = addChainParams(56) as { chainName: string; rpcUrls: string[] }
    expect(p.chainName).toBe('BNB Chain')
    expect(p.rpcUrls[0]).toMatch(/^https?:/)
  })

  it('rejects unknown chains instead of guessing', () => {
    expect(() => evmChain(999_999)).toThrow(/unsupported chain/i)
  })
})

describe('swap token lists', () => {
  it('lists native first with exact decimals on every enabled chain', () => {
    const ids = [...new Set([...UNISWAP_CHAIN_IDS, ...PANCAKE_CHAIN_IDS])]
    for (const id of ids) {
      const list = popularTokens(id)
      expect(list.length).toBeGreaterThan(1)
      expect(list[0].address).toBe(NATIVE_SENTINEL)
      for (const t of list.slice(1)) {
        expect(t.address).toMatch(HEX40)
        expect(t.decimals).toBeGreaterThan(0)
      }
    }
  })
})

describe('uniswap fee tiers', () => {
  it('probes standard V3 tiers', () => {
    expect(UNISWAP_FEE_TIERS).toEqual([500, 3000, 10_000])
  })
})

describe('pancake path candidates', () => {
  const bnb = { address: NATIVE_SENTINEL, symbol: 'BNB', name: 'BNB', decimals: 18, native: true }
  const usdt = {
    address: '0x55d398326f99059fF775485246999027B3197955' as `0x${string}`,
    symbol: 'USDT',
    name: 'Tether',
    decimals: 18,
  }
  const cake = {
    address: '0x0e09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82' as `0x${string}`,
    symbol: 'CAKE',
    name: 'CAKE',
    decimals: 18,
  }

  it('quotes native pairs direct', () => {
    expect(pancakePathCandidates(56, bnb, usdt)).toHaveLength(1)
  })

  it('falls back via WBNB for token-to-token pairs', () => {
    const paths = pancakePathCandidates(56, usdt, cake)
    expect(paths).toHaveLength(2)
    expect(paths[0]).toHaveLength(2)
    expect(paths[1]).toHaveLength(3)
    expect(paths[1][1].toLowerCase()).toBe(evmChain(56).wrappedNative.toLowerCase())
  })
})

describe('evm error mapping', () => {
  it('maps rejection, funds, gas, expiry to actionable lines', () => {
    expect(mapEvmTxError('User rejected the request')).toMatch(/rejected/i)
    expect(mapEvmTxError('insufficient funds for gas * price + value')).toMatch(/Insufficient/)
    expect(mapEvmTxError('INSUFFICIENT_LIQUIDITY')).toMatch(/No liquidity/i)
    expect(mapEvmTxError('Transaction expired, deadline passed')).toMatch(/expired/i)
  })
})

describe('evm input validation', () => {
  const base = {
    inputDecimals: 18,
    balanceHuman: 5 as number | null,
    inputAddr: NATIVE_SENTINEL,
    outputAddr: '0x55d398326f99059fF775485246999027B3197955',
    walletConnected: true,
    chainOk: true,
  }
  it('requires wallet and correct chain', () => {
    expect(validateEvmSwapInput({ ...base, amountHuman: '1', walletConnected: false })).toMatch(/not connected/i)
    expect(validateEvmSwapInput({ ...base, amountHuman: '1', chainOk: false })).toMatch(/wrong network/i)
  })
  it('rejects same-token pairs and bad amounts', () => {
    expect(validateEvmSwapInput({ ...base, amountHuman: '1', outputAddr: base.inputAddr })).toMatch(/must differ/i)
    expect(validateEvmSwapInput({ ...base, amountHuman: '0' })).toMatch(/greater than zero/i)
    expect(validateEvmSwapInput({ ...base, amountHuman: '99' })).toMatch(/insufficient balance/i)
  })
  it('accepts a valid input', () => {
    expect(validateEvmSwapInput({ ...base, amountHuman: '1.5' })).toBeNull()
  })
})

describe('evm quote staleness', () => {
  it('flags quotes older than the window', () => {
    expect(EVM_QUOTE_STALE_AFTER_MS).toBe(30_000)
    expect(isEvmQuoteStale(Date.now() - 60_000)).toBe(true)
    expect(isEvmQuoteStale(Date.now())).toBe(false)
  })
})
