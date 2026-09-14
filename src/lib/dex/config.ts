/* ============================================================
   DEX.EXE — Jupiter Swap configuration.
   Current architecture (source of truth: https://developers.jup.ag/):
   - Developer Platform gateway: https://api.jup.ag
   - Swap v2 Meta-Aggregator: GET /swap/v2/order + POST /swap/v2/execute
   - Tokens v2: GET /tokens/v2/search
   - Price v3: GET /price/v3?ids=
   - Auth: x-api-key (server-side via /api/jup proxy, VITE_ fallback
     for local dev only — see src/lib/dex/api.ts).
   No secrets are logged or committed. No mock data.
   ============================================================ */

function envStr(key: string): string {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key]
    return (v ?? '').trim()
  } catch {
    return ''
  }
}

/* ---------- Jupiter endpoints ---------- */
export const JUP_SWAP_BASE = envStr('VITE_JUP_SWAP_API_URL') || 'https://api.jup.ag/swap/v2'
export const JUP_TOKENS_BASE = envStr('VITE_JUP_TOKENS_API_URL') || 'https://api.jup.ag/tokens/v2'
export const JUP_PRICE_BASE = envStr('VITE_JUP_PRICE_API_URL') || 'https://api.jup.ag/price/v3'
/** Browser fallback key for local dev. Production uses /api/jup (server key). */
export const JUP_API_KEY = envStr('VITE_JUPITER_API_KEY')

export function jupHeaders(): Record<string, string> {
  const h: Record<string, string> = {}
  if (JUP_API_KEY) h['x-api-key'] = JUP_API_KEY
  return h
}

/* ---------- Solana RPC (reuse CRT86's existing RPC convention) ---------- */
export const DEX_RPC_FALLBACKS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']

export function dexRpcCandidates(): string[] {
  const list = [envStr('VITE_PERP_RPC_URL'), envStr('VITE_SOLANA_RPC_URL'), ...DEX_RPC_FALLBACKS]
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set(list)]
}

/* ---------- Popular tokens (hardcoded mints — Jupiter resolves decimals) ---------- */
export interface PopularToken {
  mint: string
  symbol: string
  name: string
  decimals: number
}

export const MINT_SOL = 'So11111111111111111111111111111111111111112'
export const MINT_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const MINT_USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
export const MINT_JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
export const MINT_JUPSOL = 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v'
export const MINT_WETH = '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'
export const MINT_WBTC = '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh'

export const POPULAR_TOKENS: PopularToken[] = [
  { mint: MINT_SOL, symbol: 'SOL', name: 'Solana', decimals: 9 },
  { mint: MINT_USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  { mint: MINT_USDT, symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  { mint: MINT_JUP, symbol: 'JUP', name: 'Jupiter', decimals: 6 },
  { mint: MINT_JUPSOL, symbol: 'JUPSOL', name: 'Jupiter Staked SOL', decimals: 9 },
  { mint: MINT_WETH, symbol: 'wETH', name: 'Wrapped ETH (Portal)', decimals: 8 },
  { mint: MINT_WBTC, symbol: 'wBTC', name: 'Wrapped BTC (Portal)', decimals: 8 },
]

export function popularByMint(mint: string): PopularToken | undefined {
  return POPULAR_TOKENS.find((t) => t.mint === mint)
}

/* ---------- misc ---------- */
/** Keep a little SOL back on MAX so the fee payer doesn't empty the wallet. */
export const SOL_FEE_RESERVE = 0.002

export function explorerTxUrl(sig: string): string {
  return `https://solscan.io/tx/${sig}`
}
