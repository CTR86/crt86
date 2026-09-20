/* ============================================================
   Shared swap core — single source of truth for amount math and
   quote helpers used by every SwapProvider (Jupiter / Uniswap /
   PancakeSwap). Re-exports the proven Jupiter-tested helpers from
   src/lib/dex/api.ts so there is exactly one implementation, plus
   bigint-native helpers for EVM providers (viem works in wei).
   No mock data. No fabricated quotes.
   ============================================================ */

export {
  toBaseUnits,
  fromBaseUnits,
  formatTokenAmount,
  isWalletRejection,
  friendlyQuoteError,
  isTransientFetchError,
  shouldFallbackStatus,
  QUOTE_STALE_AFTER_MS,
  isQuoteStale,
} from '../dex/api'

/** Quotes go stale fast on every provider — re-quote before sign. */
export const EVM_QUOTE_STALE_AFTER_MS = 30_000

export function isEvmQuoteStale(fetchedAt: number): boolean {
  return Date.now() - fetchedAt > EVM_QUOTE_STALE_AFTER_MS
}

/** amountOutMinimum = amountOut * (10000 - slippageBps) / 10000, rounded down. */
export function applySlippageBps(amountOut: bigint, slippageBps: number): bigint {
  if (amountOut <= 0n) return 0n
  const bps = Math.max(0, Math.min(10_000, Math.floor(slippageBps)))
  return (amountOut * BigInt(10_000 - bps)) / 10_000n
}

/** Human string (validated digits) → base-unit bigint for the token's decimals. */
export function humanToBase(human: string, decimals: number): bigint {
  const s = human.trim()
  if (!s) throw new Error('Enter an amount.')
  if (!/^\d*\.?\d*$/.test(s) || s === '.' || s === '') throw new Error('Invalid amount — digits and one dot only.')
  const [wholeRaw, fracRaw = ''] = s.split('.')
  const whole = wholeRaw === '' ? '0' : wholeRaw
  if (fracRaw.length > decimals) throw new Error(`Too many decimals — this token supports ${decimals}.`)
  const frac = fracRaw.padEnd(decimals, '0')
  const base = BigInt(whole === '0' ? '0' : whole) * 10n ** BigInt(decimals) + (frac === '' ? 0n : BigInt(frac))
  if (base <= 0n) throw new Error('Amount must be greater than zero.')
  return base
}

/** Base-unit bigint → human number (display only). */
export function baseToHuman(base: bigint, decimals: number): number {
  const denom = 10n ** BigInt(decimals)
  return Number(base / denom) + Number(base % denom) / Number(denom)
}

/** Classify raw EVM/wallet/RPC failures into actionable CRT one-liners. */
export function mapEvmTxError(msg: string): string {
  const m = msg.slice(0, 500)
  if (/user rejected|user denied|user cancelled|user canceled|rejected the request|denied transaction|action_rejected|4001/i.test(m)) {
    return 'You rejected the request in your wallet.'
  }
  if (/insufficient funds|insufficient balance|exceeds balance|transfer amount exceeds/i.test(m)) {
    return 'Insufficient balance — lower the amount or top up.'
  }
  if (/insufficient.*gas|gas required exceeds|intrinsic gas too low/i.test(m)) {
    return 'Insufficient native token for gas — keep a little BNB/ETH for fees (do not send MAX).'
  }
  if (/no liquidity|insufficient_liquidity|INSUFFICIENT_LIQUIDITY|no pool|pool does not exist/i.test(m)) {
    return 'No liquidity for this pair on this router — try another pair or provider.'
  }
  if (/expired|deadline/i.test(m)) {
    return 'Quote expired — re-quote and sign immediately.'
  }
  if (/allowance|approval|ERC20: transfer amount exceeds allowance/i.test(m)) {
    return 'Token approval missing or too low — approve the router first, then swap.'
  }
  if (/slippage|amountOutMin|too little received|TooLittleReceived|excessive input/i.test(m)) {
    return 'Price moved past your slippage — re-quote or raise slippage.'
  }
  if (/timed out|timeout|failed to fetch|network error|econnreset|socket hang|429|50[0-4]/i.test(m)) {
    return 'Network hiccup reaching RPC. Tap RE-QUOTE to retry.'
  }
  if (/unsupported chain|wrong network|chain mismatch|chainId/i.test(m)) {
    return 'Wallet is on the wrong network — switch chains and retry.'
  }
  return m.length > 300 ? m.slice(0, 300) : m
}

/** EVM swap input validation — mirrors Jupiter's validateSwapInput shape. */
export function validateEvmSwapInput(args: {
  amountHuman: string
  inputDecimals: number
  balanceHuman: number | null
  inputAddr: string
  outputAddr: string
  walletConnected: boolean
  chainOk: boolean
}): string | null {
  if (!args.walletConnected) return 'Wallet not connected — connect an EVM wallet to trade.'
  if (!args.chainOk) return 'Wrong network — switch your wallet to the selected chain.'
  if (!args.inputAddr || !args.outputAddr) return 'Pick two tokens first.'
  if (args.inputAddr.toLowerCase() === args.outputAddr.toLowerCase()) {
    return 'Input and output tokens must differ — pick another token.'
  }
  const n = Number(args.amountHuman)
  if (!args.amountHuman.trim() || !isFinite(n) || n <= 0) return 'Enter an amount greater than zero.'
  try {
    humanToBase(args.amountHuman, args.inputDecimals)
  } catch (e) {
    return (e as Error).message
  }
  if (args.balanceHuman != null && n > args.balanceHuman) {
    return `Insufficient balance — wallet has ${args.balanceHuman.toFixed(4)}.`
  }
  return null
}
