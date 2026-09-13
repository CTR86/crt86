/* ============================================================
   LaunchEngine abstraction — keeps the product extensible.

   Production today: MeteoraLaunchEngine (direct DBC SDK, devnet testing).
   Secondary / optional: RaydiumLaunchEngine (LaunchLab, stubbed —
   interface-compatible, throws until enabled).

   Existing third-party engines (StonkFun API, Ember API) stay untouched
   in src/lib/stonkfun.ts + src/lib/ember.ts.
   ============================================================ */

import type { Connection, PublicKey, Transaction } from '@solana/web3.js'

export type EngineId = 'meteora-dbc' | 'raydium-launchlab'

/** UI transaction lifecycle — every blockchain op surfaces these states
 *  through the EXISTING Panel/Readout/telemetry components. */
export type TxState =
  | 'IDLE'
  | 'LOADING'
  | 'AWAITING_WALLET'
  | 'SIGNING'
  | 'SUBMITTING'
  | 'CONFIRMING'
  | 'SUCCESS'
  | 'ERROR'

export interface DirectLaunchParams {
  name: string
  symbol: string
  uri: string
  quoteMint: string
  /** payer == poolCreator in the default flow (creator launches + pays). */
  payer: string
  /** optional first buy, denominated in quote units (e.g. SOL). */
  firstBuyQuoteAmount?: number
  slippageBps?: number
}

export interface DirectLaunchResult {
  engine: EngineId
  baseMint: string
  pool: string
  config: string
  signature: string
  quoteMint: string
}

export interface PoolStatus {
  pool: string
  baseMint: string
  quoteMint: string
  /** 0..1 curve progress (quote reserve / migration threshold). Null when unknown. */
  graduationProgress: number | null
  graduated: boolean
  quoteReserveUi: number | null
  migrationThresholdUi: number | null
}

export interface LaunchEngine {
  readonly id: EngineId
  readonly label: string
  /** Build the unsigned pool-creation (+optional first-buy) transaction. */
  buildCreatePoolTx(
    connection: Connection,
    params: DirectLaunchParams,
    baseMint: PublicKey,
  ): Promise<{ tx: Transaction; pool: PublicKey; config: PublicKey }>
  /** Read live graduation / reserve status for a pool. */
  getPoolStatus(connection: Connection, pool: PublicKey): Promise<PoolStatus>
  /** Build a buy/sell swap transaction on an existing curve pool. */
  buildSwapTx(
    connection: Connection,
    args: {
      pool: PublicKey
      owner: PublicKey
      amountIn: bigint
      swapBaseForQuote: boolean
      slippageBps: number
    },
  ): Promise<Transaction>
}
