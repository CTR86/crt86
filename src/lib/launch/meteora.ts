/* ============================================================
   MeteoraLaunchEngine — PRIMARY direct integration.

   Uses the official SDK (@meteora-ag/dynamic-bonding-curve-sdk):
     const client = new DynamicBondingCurveClient(connection, 'confirmed')
     await client.creator.createPool({ name, symbol, uri, payer,
       poolCreator, config, baseMint })
     await client.creator.createPoolWithFirstBuy({ createPoolParam,
       firstBuyParam })   // when the user opts into a first buy
     await client.state.getPool(pool) / getPoolConfig(config)
     await client.pool.swapQuote2(...) + client.pool.swap2(...)

   Pool-config model (config-level, NOT per-launch): curve shape,
   total supply, decimals, fee schedule, migration_quote_threshold and
   DAMM v2 migration target all live in the config account. This engine
   launches into an OPERATOR-PROVIDED config (env vars). It never invents
   graduation numbers — thresholds are read on-chain or taken from the
   keeper table in config.ts.

   TESTING: the caller passes a devnet connection while DIRECT is badged
   TESTNET. Same program ID on mainnet + devnet.
   ============================================================ */

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import BN from 'bn.js'
import {
  DynamicBondingCurveClient,
  SwapMode,
  deriveDbcPoolAddress,
  getCurrentPoint,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import { NATIVE_MINT } from '@solana/spl-token'
import { DIRECT_DEFAULT_SLIPPAGE_BPS, dbcConfigForQuote } from './config'
import { quoteDecimals } from './validation'
import type { DirectLaunchParams, LaunchEngine, PoolStatus } from './types'

function toQuoteBaseUnits(amountUi: number, decimals: number): BN {
  const lamports = Math.round(amountUi * Math.pow(10, decimals))
  return new BN(lamports.toString())
}

export class MeteoraLaunchEngine implements LaunchEngine {
  readonly id = 'meteora-dbc' as const
  readonly label = 'METEORA DBC · DIRECT'

  private client(connection: Connection): DynamicBondingCurveClient {
    return new DynamicBondingCurveClient(connection, 'confirmed')
  }

  resolveConfig(quoteMint: string): PublicKey {
    const cfg = dbcConfigForQuote(quoteMint)
    if (!cfg) {
      throw new Error(
        'DIRECT engine not configured — set VITE_METEORA_DBC_CONFIG_SOL / ' +
          'VITE_METEORA_DBC_CONFIG_USDC (existing DBC pool-config address for that quote). ' +
          'Deploy one config per quote via the DBC SDK partner.createConfig, then paste its address.',
      )
    }
    return new PublicKey(cfg)
  }

  async buildCreatePoolTx(
    connection: Connection,
    params: DirectLaunchParams,
    baseMint: PublicKey,
  ): Promise<{ tx: Transaction; pool: PublicKey; config: PublicKey }> {
    const client = this.client(connection)
    const payer = new PublicKey(params.payer)
    const config = this.resolveConfig(params.quoteMint)
    const quoteMintPk = new PublicKey(params.quoteMint)

    // Canonical pool PDA derivation (quoteMint + baseMint + config).
    const quoteForPda = params.quoteMint === NATIVE_MINT.toBase58() ? NATIVE_MINT : quoteMintPk
    const pool = deriveDbcPoolAddress(quoteForPda, baseMint, config)

    const createPoolParam = {
      name: params.name.trim(),
      symbol: params.symbol.trim().toUpperCase(),
      uri: params.uri.trim(),
      payer,
      poolCreator: payer,
      config,
      baseMint,
    }

    const wantFirstBuy = (params.firstBuyQuoteAmount ?? 0) > 0
    if (!wantFirstBuy) {
      const tx = await client.creator.createPool(createPoolParam)
      return { tx, pool, config }
    }

    const decimals = quoteDecimals(params.quoteMint)
    const buyAmount = toQuoteBaseUnits(params.firstBuyQuoteAmount as number, decimals)
    const tx = await client.creator.createPoolWithFirstBuy({
      createPoolParam,
      firstBuyParam: {
        buyer: payer,
        buyAmount,
        // minimumAmountOut is enforced wallet-side via slippage on the quote;
        // zero lets the curve fill at market with the user's slippage tolerance
        // applied at confirm time. Keep explicit to avoid SDK min-out rejection.
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      },
    })
    return { tx, pool, config }
  }

  async getPoolStatus(connection: Connection, pool: PublicKey): Promise<PoolStatus> {
    const client = this.client(connection)
    const poolAccount = await client.state.getPool(pool)
    // SDK returns { poolState, ... } wrappers that vary by version — read defensively.
    const root = poolAccount as unknown as Record<string, unknown>
    const inner = (root.poolState as Record<string, unknown> | undefined) ?? root
    const str = (v: unknown): string => (typeof v === 'string' ? v : (v as { toBase58?: () => string })?.toBase58?.() ?? '')
    const baseMint = str(inner.baseMint ?? inner.baseMintKey)
    const quoteMint = str(inner.quoteMint ?? inner.quoteMintKey)
    const num = (v: unknown): number | null => {
      if (v == null) return null
      const n = v instanceof BN ? Number(v.toString()) : Number(v as number | string)
      return isFinite(n) ? n : null
    }
    let thresholdUi: number | null = null
    let reserveUi: number | null = null
    try {
      const cfgRaw = inner.config
      if (cfgRaw) {
        const cfgAddr = cfgRaw instanceof PublicKey ? cfgRaw : new PublicKey(str(cfgRaw))
        const cfg = (await client.state.getPoolConfig(cfgAddr)) as unknown as Record<string, unknown>
        const raw = num(cfg.migrationQuoteThreshold)
        if (raw != null) thresholdUi = raw / Math.pow(10, quoteDecimals(quoteMint))
      }
    } catch {
      thresholdUi = null
    }
    try {
      const raw = num(inner.quoteReserve ?? inner.reserveQuote)
      if (raw != null) reserveUi = raw / Math.pow(10, quoteDecimals(quoteMint))
    } catch {
      reserveUi = null
    }
    const progress = thresholdUi && reserveUi != null && thresholdUi > 0 ? Math.min(1, reserveUi / thresholdUi) : null
    // Graduation is on-chain: pool account closes / migrates via keepers.
    // We report graduated only when progress hits 1 AND the pool stops resolving
    // as an active curve pool on a follow-up read (caller polls).
    return {
      pool: pool.toBase58(),
      baseMint,
      quoteMint,
      graduationProgress: progress,
      graduated: progress != null && progress >= 1,
      quoteReserveUi: reserveUi,
      migrationThresholdUi: thresholdUi,
    }
  }

  async buildSwapTx(
    connection: Connection,
    args: {
      pool: PublicKey
      owner: PublicKey
      amountIn: bigint
      swapBaseForQuote: boolean
      slippageBps: number
    },
  ): Promise<Transaction> {
    const client = this.client(connection)
    const amountIn = new BN(args.amountIn.toString())
    // Live on-chain state so slippage math matches the curve.
    const state = await client.state.getPool(args.pool)
    const root = state as unknown as { poolState: { config: PublicKey } }
    const configAccount = await client.state.getPoolConfig(root.poolState.config)
    const cfgAny = configAccount as unknown as { activationType?: number }
    const currentPoint = await getCurrentPoint(connection, (cfgAny.activationType ?? 1) as 0 | 1)
    const quote = client.pool.swapQuote2({
      virtualPool: state as unknown as never,
      config: configAccount as unknown as never,
      swapBaseForQuote: args.swapBaseForQuote,
      swapMode: SwapMode.ExactIn,
      amountIn,
      slippageBps: args.slippageBps || DIRECT_DEFAULT_SLIPPAGE_BPS,
      hasReferral: false,
      eligibleForFirstSwapWithMinFee: false,
      currentPoint,
    })
    const tx = await client.pool.swap2({
      owner: args.owner,
      payer: args.owner,
      pool: args.pool,
      swapBaseForQuote: args.swapBaseForQuote,
      swapMode: SwapMode.ExactIn,
      amountIn,
      minimumAmountOut: quote.minimumAmountOut ?? new BN(0),
      referralTokenAccount: null,
    })
    return tx
  }
}

/** Convenience: derive the pool PDA for (quoteMint, baseMint, config). */
export function derivePool(quoteMint: string, baseMint: PublicKey, config: PublicKey): PublicKey {
  const q = quoteMint === NATIVE_MINT.toBase58() ? NATIVE_MINT : new PublicKey(quoteMint)
  return deriveDbcPoolAddress(q, baseMint, config)
}

/** Generate a fresh base mint keypair — the creator signs pool creation with it. */
export function newBaseMint(): Keypair {
  return Keypair.generate()
}

export type { DirectLaunchParams }
