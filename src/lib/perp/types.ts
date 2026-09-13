/* PERP.EXE — shared types */

import type { PerpMarket, PerpSide } from './config'

export interface PerpPrice {
  id: string // SOL / ETH / BTC
  price: number // USD
  updatedAt: number // epoch ms
  source: 'jup' | 'coingecko' | 'binance'
}

export interface PerpPosition {
  marketId: string
  market: PerpMarket
  side: PerpSide
  owner: string
  // raw on-chain decoded (atomic USD, 6 decimals)
  price: number // entry price USD (human)
  sizeUsd: number // leveraged size USD (human)
  collateralUsd: number // collateral USD (human)
  realisedPnlUsd: number
  openTime: number // unix seconds
  updateTime: number // unix seconds
  // derived (computed client-side from live price)
  markPrice?: number
  liqPrice?: number | null
  pnlUsd?: number | null
  pnlPct?: number | null
  leverage?: number
  // account address (PDA)
  address: string
  // raw payload for debug
  raw?: unknown
}

export interface JlpInfo {
  aumUsd: number
  jlpPriceUsd: number
  jlpApyPct: number
  jlpAprPct: number
  updatedAt: number
  custodies: Array<{
    symbol: string
    aumUsd: number
    utilizationPct: number
    currentWeightagePct: number
    targetWeightagePct: number
    shortPnlDelta?: number
  }>
  raw: unknown
}

export interface PerpCustodyInfo {
  pubkey: string
  symbol: string
  mint: string
  aumUsd: number
  utilizationPct: number
}

export interface PerpQuote {
  market: PerpMarket
  side: PerpSide
  collateral: number // human units of collateral token
  collateralUsd: number
  leverage: number
  sizeUsd: number
  entryPrice: number // USD
  liqPrice: number | null // estimated
  openFeeUsd: number // estimated
  closeFeeUsd: number
  priceImpactBps: number
  totalFeesUsd: number
  stale: boolean // true if price is > 60s old
  warnings: string[]
}

export type PerpTxPhase = 'idle' | 'preview' | 'signing' | 'sending' | 'confirming' | 'success' | 'error'

export interface PerpOrderHistoryItem {
  signature: string
  marketId?: string
  side?: PerpSide
  sizeUsd?: number
  collateralUsd?: number
  status: 'success' | 'failed' | 'pending'
  slot?: number
  blockTime?: number
  err?: string
}

export class PerpError extends Error {
  code: string
  retryable: boolean
  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.code = code
    this.retryable = retryable
  }
}
