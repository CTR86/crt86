/* PERP.EXE — transaction builder
   V1 builds a best-effort "open position" request transaction
   and a close-position transaction using the Jupiter Perps Anchor
   IDL. The keeper model means open/close is a two-step: the
   user's tx creates a PositionRequest, the keeper fulfills it.
   If the IDL/program version drifts, the tx will fail simulation
   and we surface the simulation logs honestly — no fake success.
*/

import { JUP_PERPS_PROGRAM_ID, perpRpcCandidates } from './config'
import type { PerpMarket } from './config'
import { PerpError } from './types'

export interface BuildOpenArgs {
  market: PerpMarket
  ownerBase58: string
  collateralHuman: number
  leverage: number
  entryPrice: number // used to derive sizeUsd when not passed directly
  sizeUsd: number
  collateralUsd: number
}

export interface BuiltTx {
  tx: import('@solana/web3.js').VersionedTransaction
  blockhash: string
  description: string
  warnings: string[]
}

/* Anchor discriminator helpers */
function disc(name: string): Uint8Array {
  // anchor discriminator: first 8 bytes of sha256("global:<name>")
  // For v1 we hardcode the two discriminators we need, derived once
  // and committed so we don't need a sha256 dep at runtime.
  const map: Record<string, Uint8Array> = {
    createIncreasePositionMarketRequest: new Uint8Array([39, 6, 213, 45, 112, 2, 99, 35]),
    createDecreasePositionMarketRequest: new Uint8Array([7, 121, 115, 140, 83, 101, 188, 234]),
  }
  const d = map[name]
  if (!d) throw new Error(`Unknown discriminator ${name}`)
  return d
}

function encodeU64LE(n: bigint): Uint8Array {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, n, true)
  return out
}

function toAtomicUsd(usd: number): bigint {
  // Perps uses 6-decimal USD atomic (see Position.price comment)
  return BigInt(Math.round(usd * 1e6))
}

function toCollateralAtomic(human: number, decimals: number): bigint {
  return BigInt(Math.round(human * 10 ** decimals))
}

/* Minimal custody + pool lookups.
   Pool pubkey is deterministic for Jupiter Perps mainnet — fetched from
   the on-chain Pool account. For v1 we store the known mainnet pool and
   allow override via env VITE_JUP_POOL_PUBKEY.
*/
function envPool(): string {
  const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_JUP_POOL_PUBKEY?.trim()
  return v || '5BUwFW4nRbftYTDMbgSyAoCjRmVdJiuPACx2A9GPeDCW'
}
function envCustodyFor(market: PerpMarket): string {
  const key = `VITE_JUP_CUSTODY_${market.asset}`
  const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key]?.trim()
  if (v) return v
  // hardcoded mainnet fallbacks so fresh clones work without .env
  const fallback: Record<string, string> = {
    SOL: '7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz',
    ETH: 'AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn',
    WBTC: '5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm',
  }
  return fallback[market.asset] ?? ''
}

export async function buildOpenPositionTx(args: BuildOpenArgs): Promise<BuiltTx> {
  const { market, ownerBase58, collateralHuman, sizeUsd } = args
  if (!ownerBase58) throw new PerpError('wallet', 'Wallet not connected.')
  if (!isFinite(collateralHuman) || collateralHuman <= 0) throw new PerpError('input', 'Collateral must be > 0.')
  if (!isFinite(sizeUsd) || sizeUsd <= 0) throw new PerpError('input', 'Position size must be > 0.')
  const warnings: string[] = []
  const poolStr = envPool()
  const custodyStr = envCustodyFor(market)
  // fallback map above guarantees a value; keep warnings for observability if env missing
  if (!custodyStr) throw new PerpError('config', 'Perps custody not configured. Set VITE_JUP_CUSTODY_SOL / ETH / WBTC to the on-chain custody pubkeys to enable trading. Read-only mode is active.')

  const { Connection, PublicKey, TransactionMessage, VersionedTransaction, SystemProgram } = await import('@solana/web3.js')

  // Build a minimal open-request instruction. The exact IDL args for
  // createIncreasePositionMarketRequest are:
  //   sizeUsdDelta (u64 atomic), collateralDelta (u64 atomic), side (u8), priceSlippage (u64), jupiterMinimumOut (u64), preSwapAmount (u64)
  // We use priceSlippage = 1% (100 bps) expressed as atomic price slippage scaled 1e6.
  // Jupiter's keeper validates against oracle; tighter slippage may reject on volatility.
  const sizeDelta = toAtomicUsd(sizeUsd)
  const collDelta = toCollateralAtomic(collateralHuman, market.collateralDecimals)
  const sideByte = market.side === 'long' ? 1 : 2 // per IDL: 1 long, 2 short
  const priceSlippage = BigInt(1_000_000) // placeholder 1% * 1e6 scaling; keeper re-prices from oracle
  const data = new Uint8Array(8 + 8 + 8 + 1 + 8 + 8 + 8)
  let o = 0
  data.set(disc('createIncreasePositionMarketRequest'), o); o += 8
  data.set(encodeU64LE(sizeDelta), o); o += 8
  data.set(encodeU64LE(collDelta), o); o += 8
  data[o] = sideByte; o += 1
  data.set(encodeU64LE(priceSlippage), o); o += 8
  data.set(encodeU64LE(0n), o); o += 8 // jupiterMinimumOut
  data.set(encodeU64LE(collDelta), o); o += 8 // preSwapAmount = collateral (long deposits directly)

  // Derive PDAs (Position + PositionRequest) — seeds per IDL/position-account doc:
  // Position: ["position", owner, custody, collateralCustody]
  // PositionRequest: ["position_request", owner, custody, collateralCustody, request_counter]
  // For v1 we fetch the owner's current request counter from the PositionRequestCounter PDA
  // or default to 0 and let simulation tell us if the PDA is taken (honest error path).
  const programId = new PublicKey(JUP_PERPS_PROGRAM_ID)
  const owner = new PublicKey(ownerBase58)
  const custody = new PublicKey(custodyStr)
  const pool = new PublicKey(poolStr)
  // Collateral custody == custody for longs, USDC custody for shorts
  // Short USDC custody pubkey: G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa (solscan: USDC custody)
  const collCustodyStr = market.side === 'long' ? custodyStr : (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_JUP_COLLATERAL_CUSTODY_USDC?.trim() || 'G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'
  const collateralCustody = new PublicKey(collCustodyStr)

  // We need 2+ RPC candidates for blockhash + simulation
  let conn: InstanceType<typeof Connection> | null = null
  let blockhash = ''
  for (const url of perpRpcCandidates()) {
    try {
      const c = new Connection(url, 'confirmed')
      const bh = (await c.getLatestBlockhash()).blockhash
      conn = c; blockhash = bh; break
    } catch { /* next */ }
  }
  if (!conn || !blockhash) throw new PerpError('rpc', 'No Solana RPC reachable — cannot build transaction.', true)

  // Try to read request counter; default 0 if unavailable
  let counter = 0
  try {
    const [counterPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('position_request_counter'), owner.toBytes(), custody.toBytes(), collateralCustody.toBytes()],
      programId,
    )
    const acc = await conn.getAccountInfo(counterPda)
    if (acc && acc.data.length >= 8) counter = Number(new DataView(acc.data.buffer, acc.data.byteOffset, 8).getBigUint64(0, true))
    void counter
  } catch { /* keep 0 */ }

  const [positionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), owner.toBytes(), custody.toBytes(), collateralCustody.toBytes()],
    programId,
  )
  const [positionRequestPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('position_request'), owner.toBytes(), custody.toBytes(), collateralCustody.toBytes(), Buffer.from([counter])],
    programId,
  )

  const keys = [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: pool, isSigner: false, isWritable: false },
    { pubkey: custody, isSigner: false, isWritable: true },
    { pubkey: collateralCustody, isSigner: false, isWritable: true },
    { pubkey: positionPda, isSigner: false, isWritable: true },
    { pubkey: positionRequestPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]

  const ix = { programId, keys, data }

  const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: [ix as never] }).compileToV0Message()
  const tx = new VersionedTransaction(msg)

  return {
    tx,
    blockhash,
    description: `${market.side.toUpperCase()} ${market.asset} — ${collateralHuman} ${market.collateralSymbol} @ ${args.leverage}× → $${sizeUsd.toFixed(2)} size`,
    warnings,
  }
}

export async function buildClosePositionTx(args: { market: PerpMarket; ownerBase58: string; sizeUsd: number }): Promise<BuiltTx> {
  if (!args.ownerBase58) throw new PerpError('wallet', 'Wallet not connected.')
  if (!isFinite(args.sizeUsd) || args.sizeUsd <= 0) throw new PerpError('input', 'Position size must be > 0 to close.')
  const custodyStr = envCustodyFor(args.market)
  if (!custodyStr) throw new PerpError('config', 'Custody not configured — close requires VITE_JUP_CUSTODY_* to be set.')
  const poolStr = envPool()
  const { Connection, PublicKey, TransactionMessage, VersionedTransaction, SystemProgram } = await import('@solana/web3.js')
  const programId = new PublicKey(JUP_PERPS_PROGRAM_ID)
  const owner = new PublicKey(args.ownerBase58)
  const custody = new PublicKey(custodyStr)
  const pool = new PublicKey(poolStr)
  const collCustodyStr = args.market.side === 'long' ? custodyStr : (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_JUP_COLLATERAL_CUSTODY_USDC?.trim() || 'G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'
  const collateralCustody = new PublicKey(collCustodyStr)

  let conn: InstanceType<typeof Connection> | null = null
  let blockhash = ''
  for (const url of perpRpcCandidates()) {
    try {
      const c = new Connection(url, 'confirmed')
      const bh = (await c.getLatestBlockhash()).blockhash
      conn = c; blockhash = bh; break
    } catch { /* next */ }
  }
  if (!conn || !blockhash) throw new PerpError('rpc', 'No Solana RPC reachable.', true)

  const sizeDelta = toAtomicUsd(args.sizeUsd)
  const data = new Uint8Array(8 + 8 + 1 + 8 + 8 + 8)
  let o = 0
  data.set(disc('createDecreasePositionMarketRequest'), o); o += 8
  data.set(encodeU64LE(sizeDelta), o); o += 8
  data[o] = args.market.side === 'long' ? 1 : 2; o += 1
  data.set(encodeU64LE(BigInt(1_000_000)), o); o += 8 // priceSlippage
  data.set(encodeU64LE(0n), o); o += 8
  data.set(encodeU64LE(0n), o); o += 8

  const [positionPda] = PublicKey.findProgramAddressSync([Buffer.from('position'), owner.toBytes(), custody.toBytes(), collateralCustody.toBytes()], programId)
  const [positionRequestPda] = PublicKey.findProgramAddressSync([Buffer.from('position_request'), owner.toBytes(), custody.toBytes(), collateralCustody.toBytes(), Buffer.from([0])], programId)

  const keys = [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: pool, isSigner: false, isWritable: false },
    { pubkey: custody, isSigner: false, isWritable: true },
    { pubkey: collateralCustody, isSigner: false, isWritable: true },
    { pubkey: positionPda, isSigner: false, isWritable: true },
    { pubkey: positionRequestPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]
  const ix = { programId, keys, data }
  const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: [ix as never] }).compileToV0Message()
  const tx = new VersionedTransaction(msg)
  return { tx, blockhash, description: `CLOSE ${args.market.side.toUpperCase()} ${args.market.asset} — $${args.sizeUsd.toFixed(2)}`, warnings: [] }
}

export async function simulateTx(tx: import('@solana/web3.js').VersionedTransaction): Promise<{ ok: boolean; logs: string[]; err: unknown | null }> {
  for (const url of perpRpcCandidates()) {
    try {
      const { Connection } = await import('@solana/web3.js')
      const conn = new Connection(url, 'confirmed')
      const res = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true })
      const err = (res.value as { err?: unknown }).err ?? null
      const logs = (res.value as { logs?: string[] }).logs ?? []
      return { ok: !err, logs, err }
    } catch { /* next rpc */ }
  }
  return { ok: false, logs: [], err: 'No RPC reachable for simulation.' }
}

export async function sendSignedTx(signed: import('@solana/web3.js').VersionedTransaction): Promise<string> {
  const { Connection } = await import('@solana/web3.js')
  const raw = signed.serialize()
  let lastErr: string | null = null
  for (const url of perpRpcCandidates()) {
    try {
      const conn = new Connection(url, 'confirmed')
      const sig = await conn.sendRawTransaction(raw as Uint8Array, { skipPreflight: false, maxRetries: 3 })
      return sig
    } catch (e) {
      lastErr = String((e as Error).message ?? e)
      if (/already been processed/i.test(lastErr)) {
        // Phantom's signAndSend path may have already landed it
        const sig = extractSig(signed)
        if (sig) return sig
      }
    }
  }
  throw new PerpError('send', lastErr ?? 'Failed to broadcast transaction.', true)
}

function extractSig(tx: import('@solana/web3.js').VersionedTransaction): string | null {
  try {
    const b = tx.signatures?.[0]
    if (!b || b.length === 0) return null
    // bs58 encode
    // avoid dynamic import inside sync path — caller already has bs58 via wallet
    return null
  } catch { return null }
}
