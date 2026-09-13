/* ============================================================
   RaydiumLaunchEngine — SECONDARY / OPTIONAL adapter (stub).

   Official surface (verified Sep 2026):
   - SDK: @raydium-io/raydium-sdk-v2 — raydium.launchpad.createLaunchpad({
       name, symbol, uri, decimals, curveType, supply,
       graduationFractionBps, initialK, quoteMint, openTime, fees {...},
       postGraduationLpPolicy })
   - Curves: constant-product (virtual reserves), linear-price, fixed-price.
   - Graduation migrates remaining curve supply + collected quote into a
     Raydium AMM pool (CPMM); JustSendIt-mode reference threshold is 85 SOL.
   - Program ID: see Raydium docs reference/program-addresses (pinned per
     SDK version — do NOT hardcode a guess here).

   This stub keeps the LaunchEngine abstraction honest: the interface is
   implemented so the UI can list Raydium as "PLANNED", but every method
   throws until the SDK is installed and a program ID + launch config are
   provided. No fake transactions, no fake graduation.
   ============================================================ */

import type { Connection, PublicKey, Transaction } from '@solana/web3.js'
import type { DirectLaunchParams, LaunchEngine, PoolStatus } from './types'

export const RAYDIUM_LAUNCHLAB_ENABLED = false

function notEnabled(): Error {
  return new Error(
    'Raydium LaunchLab adapter is not enabled in this build. ' +
      'Install @raydium-io/raydium-sdk-v2, pin the program ID from ' +
      'docs.raydium.io reference/program-addresses, then implement ' +
      'createLaunchpad / buy / sell / graduate per the LaunchLab code demos.',
  )
}

export class RaydiumLaunchEngine implements LaunchEngine {
  readonly id = 'raydium-launchlab' as const
  readonly label = 'RAYDIUM LAUNCHLAB · PLANNED'

  async buildCreatePoolTx(
    _connection: Connection,
    _params: DirectLaunchParams,
    _baseMint: PublicKey,
  ): Promise<{ tx: Transaction; pool: PublicKey; config: PublicKey }> {
    throw notEnabled()
  }

  async getPoolStatus(_connection: Connection, _pool: PublicKey): Promise<PoolStatus> {
    throw notEnabled()
  }

  async buildSwapTx(): Promise<Transaction> {
    throw notEnabled()
  }
}
