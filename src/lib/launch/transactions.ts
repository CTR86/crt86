/* Transaction safety helpers for the DIRECT engine.
   Rules: never report SUCCESS before on-chain confirmation; map every
   failure to a retryable / non-retryable message; verify mint + pool.

   TESTING: DIRECT broadcasts on DEVNET while StonkFun / Ember stay on
   mainnet. getConnection() is the mainnet helper; DIRECT uses
   getDevnetConnection(). */

import { Connection, PublicKey } from '@solana/web3.js'
import { devnetRpcCandidates, rpcCandidates, solanaCluster } from './config'

export function getConnection(commitment: 'confirmed' | 'finalized' = 'confirmed'): Connection {
  return new Connection(rpcCandidates()[0], commitment)
}

/** Devnet connection for DIRECT (TESTNET) launches. */
export function getDevnetConnection(commitment: 'confirmed' | 'finalized' = 'confirmed'): Connection {
  return new Connection(devnetRpcCandidates()[0], commitment)
}

export function allRpcUrls(): string[] {
  return rpcCandidates()
}

export interface ConfirmOutcome {
  signature: string
  confirmed: boolean
  slot: number | null
}

/** Confirm via the primary RPC, retrying read errors across fallbacks. */
export async function confirmSignature(
  connection: Connection,
  signature: string,
  timeoutMs = 60_000,
): Promise<ConfirmOutcome> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const st = await connection.getSignatureStatus(signature, { searchTransactionHistory: true })
      const v = st?.value
      if (v?.confirmationStatus === 'confirmed' || v?.confirmationStatus === 'finalized') {
        return { signature, confirmed: !v.err, slot: v.slot ?? null }
      }
      if (v?.err) return { signature, confirmed: false, slot: v.slot ?? null }
    } catch {
      /* RPC blip — keep polling until timeout */
    }
    await new Promise((r) => setTimeout(r, 2_000))
  }
  throw new Error('Confirmation timeout — signature not confirmed within 60s. Check the explorer link, then retry polling (do NOT re-pay).')
}

export async function mintExists(connection: Connection, mint: PublicKey): Promise<boolean> {
  try {
    const info = await connection.getAccountInfo(mint)
    return !!info
  } catch {
    return false
  }
}

export async function poolExists(connection: Connection, pool: PublicKey): Promise<boolean> {
  try {
    const info = await connection.getAccountInfo(pool)
    return !!info
  } catch {
    return false
  }
}

export interface LaunchVerification {
  signatureOk: boolean
  mintOk: boolean
  poolOk: boolean
}

/** Post-launch verification: signature confirmed + mint + pool accounts exist. */
export async function verifyLaunch(
  connection: Connection,
  args: { signature: string; baseMint: PublicKey; pool: PublicKey },
): Promise<LaunchVerification> {
  const [sig, mintOk, poolOk] = await Promise.all([
    connection.getSignatureStatus(args.signature, { searchTransactionHistory: true }).catch(() => null),
    mintExists(connection, args.baseMint),
    poolExists(connection, args.pool),
  ])
  const ok = sig?.value?.confirmationStatus === 'confirmed' || sig?.value?.confirmationStatus === 'finalized'
  return { signatureOk: !!ok && !sig?.value?.err, mintOk, poolOk }
}

/** Map raw errors to user-facing messages with retry guidance. */
export function mapTxError(e: unknown): { message: string; retryable: boolean } {
  const msg = String((e as Error)?.message ?? e ?? 'Unknown error')
  const lower = msg.toLowerCase()
  if (lower.includes('user rejected') || lower.includes('rejected the request') || lower.includes('denied')) {
    return { message: 'Wallet rejected the signature — no transaction was sent. Retry when ready.', retryable: true }
  }
  if (lower.includes('insufficient') || (lower.includes('0x1') && lower.includes('lamport'))) {
    return { message: 'Insufficient SOL for rent + fees. Top up the creator wallet and retry.', retryable: true }
  }
  if (lower.includes('simulation failed') || lower.includes('simulate')) {
    return { message: `Simulation failed: ${msg.slice(0, 280)} — fix the config/params, then retry.`, retryable: false }
  }
  if (lower.includes('already in use') || lower.includes('already exists') || lower.includes('already-created')) {
    return { message: 'Pool/mint already exists for this base mint — generate a fresh mint, do not re-submit.', retryable: false }
  }
  if (lower.includes('blockhash') || lower.includes('timeout') || lower.includes('rate limit') || lower.includes('429') || lower.includes('fetch failed') || lower.includes('network')) {
    return { message: `Network/RPC issue: ${msg.slice(0, 220)} — retry shortly.`, retryable: true }
  }
  if (lower.includes('invalid') || lower.includes('not configured')) {
    return { message: msg.slice(0, 320), retryable: false }
  }
  if (lower.includes('raydium') && lower.includes('not enabled')) {
    return { message: msg.slice(0, 320), retryable: false }
  }
  return { message: msg.slice(0, 320), retryable: true }
}

export function clusterLabel(): string {
  return solanaCluster()
}
