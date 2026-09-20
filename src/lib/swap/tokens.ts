/* ============================================================
   Per-chain popular token lists for UNISWAP.EXE + PANCAKE.EXE.
   Native currency uses the zero-address sentinel (same convention
   as Relay's NATIVE in src/lib/relay.ts). Everything else is a
   verified mainnet contract address with exact decimals.
   Custom tokens can be pasted by address — the UI resolves
   decimals/symbol on-chain and rejects non-contracts honestly.
   ============================================================ */

import type { Address } from 'viem'

export const NATIVE_SENTINEL = '0x0000000000000000000000000000000000000000' as Address

export interface EvmToken {
  address: Address
  symbol: string
  name: string
  decimals: number
  native?: boolean
}

export function isNative(t: Pick<EvmToken, 'address'>): boolean {
  return t.address.toLowerCase() === NATIVE_SENTINEL.toLowerCase()
}

/* Well-known mainnet tokens (decimals verified on-chain explorers). */
export const EVM_POPULAR_TOKENS: Record<number, EvmToken[]> = {
  /* BNB Chain */
  56: [
    { address: NATIVE_SENTINEL, symbol: 'BNB', name: 'BNB', decimals: 18, native: true },
    {
      address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      symbol: 'WBNB',
      name: 'Wrapped BNB',
      decimals: 18,
    },
    {
      address: '0x55d398326f99059fF775485246999027B3197955',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 18,
    },
    {
      address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      symbol: 'USDC',
      name: 'Binance-Peg USD Coin',
      decimals: 18,
    },
    {
      address: '0x0e09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
      symbol: 'CAKE',
      name: 'PancakeSwap',
      decimals: 18,
    },
    {
      address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
      symbol: 'ETH',
      name: 'Binance-Peg Ethereum',
      decimals: 18,
    },
    {
      address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
      symbol: 'BTCB',
      name: 'Binance-Peg BTCB',
      decimals: 18,
    },
  ],
  /* Ethereum */
  1: [
    { address: NATIVE_SENTINEL, symbol: 'ETH', name: 'Ether', decimals: 18, native: true },
    {
      address: '0xC02aaA39b223FE8D0A0e5c4F27eAD9083C756Cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
    },
    {
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
    },
    {
      address: '0xA0b86991c6218b36c1d19d4a2e9eb0Ce3606EB48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
    {
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      symbol: 'WBTC',
      name: 'Wrapped BTC',
      decimals: 8,
    },
  ],
  /* Base */
  8453: [
    { address: NATIVE_SENTINEL, symbol: 'ETH', name: 'Ether', decimals: 18, native: true },
    {
      address: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
    },
    {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
  ],
  /* Arbitrum */
  42161: [
    { address: NATIVE_SENTINEL, symbol: 'ETH', name: 'Ether', decimals: 18, native: true },
    {
      address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
    },
    {
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
    {
      address: '0xFd086bC7D60660c0eF61A62CC24A1E9A86cbE80a',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
    },
  ],
  /* Polygon — native POL; WETH omitted (unverified), paste custom address instead */
  137: [
    { address: NATIVE_SENTINEL, symbol: 'POL', name: 'POL', decimals: 18, native: true },
    {
      address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      symbol: 'WMATIC',
      name: 'Wrapped MATIC',
      decimals: 18,
    },
    {
      address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      symbol: 'USDC',
      name: 'USD Coin (Circle)',
      decimals: 6,
    },
  ],
  /* Avalanche — WETH.e omitted (bridged variant), paste custom address instead */
  43114: [
    { address: NATIVE_SENTINEL, symbol: 'AVAX', name: 'Avalanche', decimals: 18, native: true },
    {
      address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
      symbol: 'WAVAX',
      name: 'Wrapped AVAX',
      decimals: 18,
    },
    {
      address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      symbol: 'USDC',
      name: 'USD Coin (Circle)',
      decimals: 6,
    },
  ],
}

export function popularTokens(chainId: number): EvmToken[] {
  return EVM_POPULAR_TOKENS[chainId] ?? [
    { address: NATIVE_SENTINEL, symbol: 'NATIVE', name: 'Native currency', decimals: 18, native: true },
  ]
}

export function findPopular(chainId: number, addr: string): EvmToken | undefined {
  return popularTokens(chainId).find((t) => t.address.toLowerCase() === addr.toLowerCase())
}
