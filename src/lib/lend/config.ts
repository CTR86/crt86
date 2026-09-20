/* ============================================================
   LEND.EXE — Jupiter Lend configuration.
   Source of truth: https://developers.jup.ag/docs/lend
     - Gateway: https://api.jup.ag/lend/v1
     - Earn: GET /earn/tokens, GET /earn/positions?users=,
             GET /earn/earnings?user=&positions=,
             POST /earn/deposit|withdraw|mint|redeem
     - Borrow: GET /borrow/vaults?market=main, GET /borrow/positions?users=,
               POST /borrow/operate|operate-instructions
     - Auth: x-api-key (Developer Platform portal). Server-side via
       /api/lend proxy; VITE_ fallback for local dev only.
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

/* ---------- Jupiter Lend endpoints ---------- */
export const LEND_API_BASE = envStr('VITE_JUPITER_LEND_API_URL') || 'https://api.jup.ag/lend/v1'
/** Browser fallback key for local dev. Production uses /api/lend (server key). */
export const LEND_API_KEY = envStr('VITE_JUPITER_API_KEY')

export function lendHeaders(): Record<string, string> {
  const h: Record<string, string> = {}
  if (LEND_API_KEY) h['x-api-key'] = LEND_API_KEY
  return h
}

/* ---------- Solana RPC (reuse CRT86's existing RPC convention) ---------- */
export const LEND_RPC_FALLBACKS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']

export function lendRpcCandidates(): string[] {
  const list = [envStr('VITE_PERP_RPC_URL'), envStr('VITE_SOLANA_RPC_URL'), ...LEND_RPC_FALLBACKS]
    .map((s) => s.trim())
    .filter(Boolean)
  return [...new Set(list)]
}

/* ---------- Borrow operate sentinels (per Borrow API docs) ---------- */
export const MIN_I128 = '-170141183460469231731687303715884105728'
export const WSOL_MINT = 'So11111111111111111111111111111111111111112'

export function explorerTxUrl(sig: string): string {
  return `https://solscan.io/tx/${sig}`
}
