/* ============================================================
   Relay.link bridge client — multichain EVM bridging for BRIDGE.EXE
   Docs: https://docs.relay.link/references/api/quickstart
   Browser CORS supported. API key optional (rate limits apply without).
   ============================================================ */

export const RELAY_BASE = 'https://api.relay.link'
/** zero address = chain's native currency */
export const NATIVE = '0x0000000000000000000000000000000000000000'

/** Relay dashboard API key — sent as x-api-key on every request (optional, rate-limited without). */
const RELAY_API_KEY = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_RELAY_API_KEY?.trim() ?? ''

function relayHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (RELAY_API_KEY) h['x-api-key'] = RELAY_API_KEY
  return h
}

/** Relay's chain id for Solana */
export const SOLANA_CHAIN_ID = 792703809
/** native SOL mint on Solana */
export const SOL_MINT = '11111111111111111111111111111111'

/** Robinhood Chain — destination supported by Relay (vmType evm) */
export const RH_CHAIN: BridgeChain = {
  id: 4663,
  name: 'RH-CHAIN',
  symbol: 'ETH',
  hex: '0x1237',
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://explorehub.routescan.io/4663',
}

export interface BridgeChain {
  id: number
  name: string
  symbol: string
  hex: string
  rpc: string
  explorer: string
}

/** popular EVM chains Relay supports — native currency only for v1 */
export const BRIDGE_CHAINS: BridgeChain[] = [
  { id: 1, name: 'ETHEREUM', symbol: 'ETH', hex: '0x1', rpc: 'https://eth.llamarpc.com', explorer: 'https://etherscan.io' },
  { id: 8453, name: 'BASE', symbol: 'ETH', hex: '0x2105', rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org' },
  { id: 42161, name: 'ARBITRUM', symbol: 'ETH', hex: '0xa4b1', rpc: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io' },
  { id: 10, name: 'OPTIMISM', symbol: 'ETH', hex: '0xa', rpc: 'https://mainnet.optimism.io', explorer: 'https://optimistic.etherscan.io' },
  { id: 137, name: 'POLYGON', symbol: 'POL', hex: '0x89', rpc: 'https://polygon-rpc.com', explorer: 'https://polygonscan.com' },
  { id: 56, name: 'BSC', symbol: 'BNB', hex: '0x38', rpc: 'https://bsc-dataseed.binance.org', explorer: 'https://bscscan.com' },
  { id: 43114, name: 'AVALANCHE', symbol: 'AVAX', hex: '0xa86a', rpc: 'https://api.avax.network/ext/bc/C/rpc', explorer: 'https://snowtrace.io' },
]

export interface RelayQuoteStep {
  kind?: string
  requestId?: string
  items?: {
    check?: { endpoint?: string }
    data?: {
      to?: string
      data?: string
      value?: string
      chainId?: number
      gas?: string
      maxFeePerGas?: string
      maxPriorityFeePerGas?: string
    }
  }[]
}

export interface RelayQuote {
  steps?: RelayQuoteStep[]
  fees?: {
    gas?: { amount?: string; usd?: string }
    relayer?: { amount?: string; usd?: string }
    [k: string]: unknown
  }
  details?: {
    operation?: string
    timeEstimate?: number
    rate?: string
    currencyIn?: { amount?: string; amountFormatted?: string; decimals?: number; currency?: { symbol?: string; address?: string; decimals?: number } }
    currencyOut?: { amount?: string; amountFormatted?: string; decimals?: number; currency?: { symbol?: string; address?: string; decimals?: number } }
    [k: string]: unknown
  }
  [k: string]: unknown
}

export async function getRelayQuote(args: {
  user: string
  originChainId: number
  destinationChainId: number
  amount: string // base units as string
  /** required when destination is Solana (SVM) — the Solana address that receives funds */
  recipient?: string
  originCurrency?: string
  destinationCurrency?: string
}): Promise<RelayQuote> {
  const r = await fetch(`${RELAY_BASE}/quote/v2`, {
    method: 'POST',
    headers: relayHeaders(),
    body: JSON.stringify({
      user: args.user,
      originChainId: args.originChainId,
      destinationChainId: args.destinationChainId,
      originCurrency: args.originCurrency ?? NATIVE,
      destinationCurrency: args.destinationCurrency ?? NATIVE,
      ...(args.recipient ? { recipient: args.recipient } : {}),
      amount: args.amount,
      tradeType: 'EXACT_INPUT',
      ...(args.originChainId === SOLANA_CHAIN_ID ? { includeComputeUnitLimit: true } : {}),
    }),
    signal: AbortSignal.timeout(25_000),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok || !j?.steps) throw new Error(j?.message ?? j?.error ?? `Relay quote HTTP ${r.status}`)
  return j as RelayQuote
}

export function relayRequestId(q: RelayQuote): string {
  const root = (q as { requestId?: string }).requestId
  return String(root || q.steps?.find((s) => s.requestId)?.requestId || '')
}

export async function getRelayStatus(requestId: string): Promise<{ status?: string; inTxHashes?: string[]; txHashes?: string[]; failReason?: string; [k: string]: unknown }> {
  const headers: Record<string, string> = {}
  if (RELAY_API_KEY) headers['x-api-key'] = RELAY_API_KEY
  const r = await fetch(`${RELAY_BASE}/intents/status/v3?requestId=${encodeURIComponent(requestId)}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  })
  if (!r.ok) throw new Error(`Relay status HTTP ${r.status}`)
  return r.json()
}

/** Tell Relay to index the origin tx — required or the fill stays on WAITING. */
export async function indexRelayTx(args: { txHash: string; chainId: number; requestId?: string }): Promise<void> {
  const r = await fetch(`${RELAY_BASE}/transactions/index`, {
    method: 'POST',
    headers: relayHeaders(),
    body: JSON.stringify({
      txHash: args.txHash,
      chainId: String(args.chainId),
      ...(args.requestId ? { requestId: args.requestId } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (r.ok || r.status === 404) return
  const j = await r.json().catch(() => null)
  throw new Error(j?.message ?? `Relay index HTTP ${r.status}`)
}

export async function waitForRelayFill(args: {
  requestId: string
  originChainId: number
  originTx: string
  log: (line: string) => void
}): Promise<{ destTx?: string }> {
  let last = ''
  for (let i = 0; i < 100; i++) {
    if (i === 0 || i % 5 === 0) {
      try {
        await indexRelayTx({ txHash: args.originTx, chainId: args.originChainId, requestId: args.requestId })
        if (i === 0) args.log('RELAY INDEXED ORIGIN TX')
      } catch (e) {
        args.log('INDEX WARN: ' + String((e as Error).message ?? e).slice(0, 80))
      }
    }
    const st = await getRelayStatus(args.requestId).catch(() => null)
    const ststr = String(st?.status ?? '').toLowerCase()
    if (ststr && ststr !== last) {
      last = ststr
      args.log('STATUS: ' + ststr.toUpperCase())
      if (st?.failReason && st.failReason !== 'N/A') args.log('REASON: ' + st.failReason)
      if (st?.inTxHashes?.[0]) args.log('ORIGIN SEEN ' + String(st.inTxHashes[0]).slice(0, 18) + '…')
      if (st?.txHashes?.[0]) args.log('DEST TX ' + String(st.txHashes[0]).slice(0, 18) + '…')
    } else if (ststr === 'waiting' && i > 0 && i % 10 === 0) {
      args.log('STILL WAITING — Relay has not seen the deposit yet')
    }
    if (ststr === 'success') return { destTx: st?.txHashes?.[0] }
    if (ststr === 'refund' || ststr === 'failure' || ststr === 'failed' || ststr === 'error') {
      const why = st?.failReason && st.failReason !== 'N/A' ? ': ' + st.failReason : ''
      throw new Error('Bridge failed (' + ststr + why + ') — funds auto-refund to source.')
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error('Tracking timed out — Relay may still fill. Check Solscan and the recipient wallet.')
}

/** Relay v2 nests decimals under `currencyOut.currency.decimals` — the old
 *  code read top-level `currencyOut.decimals` (usually absent) and fell back
 *  to 18. That is accidentally right for 18-decimal EVM outputs but divides
 *  9-decimal SOL by 1e18, rendering quotes like 0.00038 ETH → "0.00000 SOL".
 *  This helper reads both shapes and falls back by asset (SOL → 9). */
export function currencyOutHuman(q: RelayQuote): { outHuman: number; outDecimals: number; outSymbol: string } {
  const out = q.details?.currencyOut
  const outSymbol = out?.currency?.symbol ?? ''
  const outAddr = out?.currency?.address ?? ''
  const isSol = outSymbol === 'SOL' || outAddr === SOL_MINT
  const outDecimals = out?.decimals ?? out?.currency?.decimals ?? (isSol ? 9 : 18)
  let outHuman = Number(out?.amount ?? '0') / 10 ** outDecimals
  if ((!isFinite(outHuman) || outHuman <= 0) && out?.amountFormatted != null) {
    const f = Number(out.amountFormatted)
    if (isFinite(f) && f > 0) outHuman = f
  }
  if (!isFinite(outHuman) || outHuman < 0) outHuman = 0
  return { outHuman, outDecimals, outSymbol }
}

/** defensive extraction of the display/execution fields from a quote */
export function extractQuote(q: RelayQuote) {
  const txStep = q.steps?.find((s) => s.kind === 'transaction' && s.items?.[0]?.data)
  const sigStep = q.steps?.find((s) => s.kind === 'signature')
  const txData = txStep?.items?.[0]?.data
  const requestId = relayRequestId(q)
  const { outHuman, outSymbol } = currencyOutHuman(q)
  const inRaw = q.details?.currencyIn
  const inDecimals = inRaw?.decimals ?? inRaw?.currency?.decimals ?? 18
  const inHuman = Number(inRaw?.amount ?? '0') / 10 ** inDecimals
  const inSymbol = inRaw?.currency?.symbol ?? ''
  let rate = Number(q.details?.rate ?? 0)
  if (!(rate > 0) && inHuman > 0 && outHuman > 0) rate = outHuman / inHuman
  const timeEstimate = Number(q.details?.timeEstimate ?? 0)
  const gasUsd = Number(q.fees?.gas?.usd ?? 0)
  const relayerUsd = Number(q.fees?.relayer?.usd ?? 0)
  return {
    requestId,
    txStepKind: txStep?.kind ?? null,
    signatureKind: sigStep?.kind ?? null,
    tx: txData ?? null,
    outHuman: isFinite(outHuman) ? outHuman : 0,
    outSymbol,
    inSymbol,
    rate,
    timeEstimate,
    gasUsd: isFinite(gasUsd) ? gasUsd : 0,
    relayerUsd: isFinite(relayerUsd) ? relayerUsd : 0,
  }
}
