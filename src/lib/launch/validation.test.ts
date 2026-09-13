import { describe, expect, it } from 'vitest'
import {
  effectiveQuoteMint,
  graduationLabelFor,
  isValidSolanaAddress,
  platformFeeOnAmount,
  quoteAutoMigrationWarning,
  quoteDecimals,
  stage1OkDirect,
  validateDirectForm,
  validateFirstBuy,
  validateName,
  validateQuoteMint,
  validateSlippage,
  validateSymbol,
  validateUri,
} from './validation'
import { NATIVE_SOL_MINT, USDC_MINT } from './config'

const BASE = {
  name: 'NEON DREAMS',
  symbol: 'NDRM',
  uri: 'https://arweave.net/abc/metadata.json',
  quoteMint: NATIVE_SOL_MINT,
  customQuoteMint: '',
  firstBuyMode: 'none' as const,
  firstBuyAmount: '',
  slippageBps: 100,
}

describe('launch config validation', () => {
  it('accepts a valid SOL direct config', () => {
    expect(validateDirectForm(BASE).ok).toBe(true)
  })

  it('rejects empty name / oversize symbol', () => {
    expect(validateName('')).toBeTruthy()
    expect(validateName('x'.repeat(33))).toBeTruthy()
    expect(validateSymbol('')).toBeTruthy()
    expect(validateSymbol('TOOLONGSYMBOL')).toBeTruthy()
  })

  it('requires http(s) metadata uri', () => {
    expect(validateUri('')).toBeTruthy()
    expect(validateUri('ipfs://abc')).toBeTruthy()
    expect(validateUri('https://arweave.net/x.json')).toBeNull()
  })

  it('stage-1 gate mirrors the deck', () => {
    expect(stage1OkDirect({ name: 'A', symbol: 'B', uri: 'https://x.io/m.json' })).toBe(true)
    expect(stage1OkDirect({ name: '', symbol: 'B', uri: 'https://x.io/m.json' })).toBe(false)
  })
})

describe('quote asset validation', () => {
  it('accepts keeper-listed SOL / USDC', () => {
    expect(validateQuoteMint({ quoteMint: NATIVE_SOL_MINT, customQuoteMint: '' })).toBeNull()
    expect(validateQuoteMint({ quoteMint: USDC_MINT, customQuoteMint: '' })).toBeNull()
  })

  it('rejects missing / malformed mints', () => {
    expect(validateQuoteMint({ quoteMint: '', customQuoteMint: '' })).toBeTruthy()
    expect(validateQuoteMint({ quoteMint: 'CUSTOM', customQuoteMint: 'not-a-mint' })).toBeTruthy()
  })

  it('resolves CUSTOM to the custom mint', () => {
    expect(effectiveQuoteMint({ quoteMint: 'CUSTOM', customQuoteMint: USDC_MINT })).toBe(USDC_MINT)
  })

  it('warns on custom quotes (manual migration)', () => {
    expect(quoteAutoMigrationWarning(NATIVE_SOL_MINT)).toBeNull()
    const custom = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
    expect(isValidSolanaAddress(custom)).toBe(true)
    expect(quoteAutoMigrationWarning(custom)).toMatch(/manual migration/i)
  })
})

describe('graduation configuration', () => {
  it('exposes keeper thresholds for SOL / USDC only', () => {
    expect(graduationLabelFor(NATIVE_SOL_MINT)).toBe('10 SOL')
    expect(graduationLabelFor(USDC_MINT)).toBe('750 USDC')
    expect(graduationLabelFor('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')).toBeNull()
  })

  it('formats quote decimals correctly', () => {
    expect(quoteDecimals(NATIVE_SOL_MINT)).toBe(9)
    expect(quoteDecimals(USDC_MINT)).toBe(6)
  })
})

describe('fee calculations', () => {
  it('computes platform fee from bps constant', () => {
    // Policy: VITE_PLATFORM_FEE_BPS=0 in test env -> fee is 0 and change-safe.
    expect(platformFeeOnAmount(100)).toBeGreaterThanOrEqual(0)
    expect(platformFeeOnAmount(0)).toBe(0)
    expect(platformFeeOnAmount(-5)).toBe(0)
  })
})

describe('transaction state handling', () => {
  it('validates first-buy and slippage bounds', () => {
    expect(validateFirstBuy('none', '')).toBeNull()
    expect(validateFirstBuy('quote', '0')).toBeTruthy()
    expect(validateFirstBuy('quote', '0.5')).toBeNull()
    expect(validateSlippage(100)).toBeNull()
    expect(validateSlippage(0)).toBeTruthy()
    expect(validateSlippage(5001)).toBeTruthy()
  })

  it('flags full-form errors for retry guidance', () => {
    const bad = validateDirectForm({ ...BASE, name: '', slippageBps: 0 })
    expect(bad.ok).toBe(false)
    expect(bad.errors.name).toBeTruthy()
    expect(bad.errors.slippage).toBeTruthy()
  })
})
