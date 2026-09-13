/* ============================================================
   Direct launch engine configuration — Meteora DBC (primary).

   Sources (verified Sep 2026):
   - DBC program ID (mainnet + devnet): dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN
   - Pool authority PDA: FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM
   - TS SDK: @meteora-ag/dynamic-bonding-curve-sdk / DynamicBondingCurveClient
   - Flow: partner creates config -> creator creates pool (-> optional
     first buy) -> tradeable on curve -> Meteora keepers auto-migrate to
     DAMM v2 when quote reserve >= migration_quote_threshold.
   - Migration keepers only auto-migrate keeper-supported quote mints.
     Anything else needs manual migration via the Manual Migrator UI.

   TESTING STATUS: DIRECT runs on DEVNET while StonkFun / Ember stay on
   mainnet. The UI carries a TESTNET badge on every DIRECT surface.

   Design rule for this repo: per-pool creation takes ONLY
   name / symbol / uri / baseMint / config. Supply, decimals, curve
   shape, fees, graduation threshold and migration target are all
   CONFIG-level and read-only per launch. The UI must display them as
   config facts, never as per-launch editable fields (unless the
   operator deploys a new config).
   ============================================================ */

export const DBC_PROGRAM_ID = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN'
export const DBC_POOL_AUTHORITY = 'FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM'

/** DIRECT is in testing — every DIRECT UI surface shows this badge. */
export const DIRECT_TESTNET_BADGE = 'TESTNET'

/** Fee marketing line for the DIRECT engine card. Policy: launchers pay
 *  ZERO platform fee — only Solana rent + network fees + the Meteora
 *  protocol cut. */
export const DIRECT_FEE_LINE = 'LOWEST FEES IN THE INDUSTRY · ZERO PLATFORM FEE'

export const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112'
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/** Keeper-supported auto-migration thresholds (mainnet). From DBC docs. */
export interface KeeperThreshold {
  mint: string
  ticker: string
  name: string
  decimals: number
  migrationQuoteThreshold: number
  thresholdLabel: string
}

export const KEEPER_THRESHOLDS: KeeperThreshold[] = [
  {
    mint: NATIVE_SOL_MINT,
    ticker: 'SOL',
    name: 'Wrapped SOL',
    decimals: 9,
    migrationQuoteThreshold: 10,
    thresholdLabel: '10 SOL',
  },
  {
    mint: USDC_MINT,
    ticker: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    migrationQuoteThreshold: 750,
    thresholdLabel: '750 USDC',
  },
]

/** Quote assets the DIRECT engine exposes. Custom SPL mints are allowed by
 *  the protocol but NOT auto-migrated by keepers — hence allowlist + warning. */
export interface QuoteAsset {
  mint: string
  ticker: string
  name: string
  decimals: number
  autoMigrated: boolean
  graduationNote: string
}

export const DIRECT_QUOTE_ASSETS: QuoteAsset[] = KEEPER_THRESHOLDS.map((k) => ({
  mint: k.mint,
  ticker: k.ticker,
  name: k.name,
  decimals: k.decimals,
  autoMigrated: true,
  graduationNote: `Auto-graduates at ${k.thresholdLabel} via Meteora keepers -> DAMM v2.`,
}))

/* ---------- env ---------- */

function envStr(key: string): string {
  const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key]
  return (v ?? '').trim()
}

function envNum(key: string, fallback: number): number {
  const raw = envStr(key)
  const n = Number(raw)
  return raw !== '' && isFinite(n) ? n : fallback
}

/** Solana RPC (mainnet — StonkFun / Ember / wallet). Operator-configured first. */
export const SOLANA_RPC_URL = envStr('VITE_SOLANA_RPC_URL')
export const SOLANA_RPC_FALLBACKS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']

export function rpcCandidates(): string[] {
  const list = [SOLANA_RPC_URL, ...SOLANA_RPC_FALLBACKS].map((s) => s.trim()).filter(Boolean)
  return [...new Set(list)]
}

/** Devnet RPC for DIRECT testing. Explicit var first, then a Helius-style
 *  mainnet->devnet derivation of the primary URL, then public devnet. */
export function devnetRpcCandidates(): string[] {
  const explicit = envStr('VITE_SOLANA_DEVNET_RPC_URL')
  const derived = SOLANA_RPC_URL.includes('mainnet.') ? SOLANA_RPC_URL.replace('mainnet.', 'devnet.') : ''
  const list = [explicit, derived, 'https://api.devnet.solana.com'].map((s) => s.trim()).filter(Boolean)
  return [...new Set(list)]
}

/** Existing DBC pool-config per quote mint. Empty = DIRECT engine unconfigured. */
export function dbcConfigForQuote(quoteMint: string): string {
  if (quoteMint === NATIVE_SOL_MINT) return envStr('VITE_METEORA_DBC_CONFIG_SOL')
  if (quoteMint === USDC_MINT) return envStr('VITE_METEORA_DBC_CONFIG_USDC')
  return envStr('VITE_METEORA_DBC_CONFIG_DEFAULT')
}

export function isDirectConfigured(): boolean {
  return Boolean(envStr('VITE_METEORA_DBC_CONFIG_SOL') || envStr('VITE_METEORA_DBC_CONFIG_USDC') || envStr('VITE_METEORA_DBC_CONFIG_DEFAULT'))
}

/* ---------- platform fee policy: launchers pay ZERO to us ----------
   Policy: we do NOT charge the user who deploys a coin. The launcher pays
   only Solana costs (rent + tx fees) plus the Meteora protocol cut
   (PROTOCOL_FEE_PERCENT = 20% of curve trading fees + the config's pool
   creation fee). Creator/partner split lives in the on-chain config
   (creatorTradingFeePercentage + locked-LP percentages).
   PLATFORM_FEE_BPS below therefore stays 0. It exists only as a
   change-without-rewrite constant; do NOT set it above 0 without an
   explicit policy change. */
export const PLATFORM_FEE_BPS = envNum('VITE_PLATFORM_FEE_BPS', 0)
export const PLATFORM_FEE_RECIPIENT = envStr('VITE_PLATFORM_FEE_RECIPIENT')

/** Slippage applied to the optional first-buy leg (bps). */
export const DIRECT_DEFAULT_SLIPPAGE_BPS = envNum('VITE_DIRECT_DEFAULT_SLIPPAGE_BPS', 100)

/** Network selector: mainnet-beta default, devnet for testing. */
export function solanaCluster(): 'mainnet-beta' | 'devnet' {
  return envStr('VITE_SOLANA_CLUSTER') === 'devnet' ? 'devnet' : 'mainnet-beta'
}

export function explorerTxUrl(signature: string): string {
  const cluster = solanaCluster() === 'devnet' ? '?cluster=devnet' : ''
  return `https://solscan.io/tx/${signature}${cluster}`
}

/** DIRECT launches happen on devnet while testing — explorer links pin it. */
export function devnetExplorerTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}?cluster=devnet`
}

export function devnetExplorerAccountUrl(address: string): string {
  return `https://solscan.io/account/${address}?cluster=devnet`
}
