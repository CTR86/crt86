/* ============================================================
   PERP.EXE — Jupiter Perps configuration
   All secrets via env, no hardcoding. Perps API is WIP,
   so config degrades gracefully to honest NOT-CONFIGURED
   states instead of fake data.
   ============================================================ */

function envStr(key: string): string {
  const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key]
  return (v ?? '').trim()
}

function _envNum(key: string, fallback: number): number {
  const raw = envStr(key)
  const n = Number(raw)
  return raw !== '' && isFinite(n) ? n : fallback
}
void _envNum

/* ---------- Jupiter Perps program (mainnet) ---------- */
// Official perps program on Solana mainnet-beta.
// Custody/pool/position PDAs all derive from this.
export const JUP_PERPS_PROGRAM_ID = envStr('VITE_JUP_PERPS_PROGRAM_ID') || 'PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu'

// Public read endpoints. No auth required today; if Jupiter adds
// an API key, set VITE_JUPITER_API_KEY and route through /api/jup
// to keep it server-side (see api.ts).
export const JUP_PERPS_API_BASE = envStr('VITE_JUPITER_PERPS_API_URL') || 'https://perps-api.jup.ag'
export const JUP_PRICE_API_BASE = envStr('VITE_JUP_PRICE_API_URL') || 'https://price.jup.ag'
// Fallback price if JUP price fails (CoinGecko still works)
export const JUP_API_KEY = envStr('VITE_JUPITER_API_KEY')

export function jupHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (JUP_API_KEY) h['x-api-key'] = JUP_API_KEY
  return h
}

/* ---------- RPC ---------- */
export const PERP_RPC_URL = envStr('VITE_PERP_RPC_URL') || envStr('VITE_SOLANA_RPC_URL') || ''
export const PERP_RPC_FALLBACKS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']

export function perpRpcCandidates(): string[] {
  const list = [PERP_RPC_URL, ...PERP_RPC_FALLBACKS].map((s) => s.trim()).filter(Boolean)
  return [...new Set(list)]
}

/* ---------- Markets ---------- */
// Jupiter Perps supports SOL / ETH / WBTC. Each long uses the asset itself
// as collateral; each short uses USDC (also USDT but we surface USDC only
// for v1). That gives 6 slots, 3 of them long, 3 short with USDC.
export type PerpSide = 'long' | 'short'
export type PerpAsset = 'SOL' | 'ETH' | 'WBTC'

export interface PerpMarket {
  id: string          // e.g. SOL-PERP
  asset: PerpAsset
  side: PerpSide
  label: string       // e.g. SOL / LONG
  symbol: string      // e.g. SOL-PERP LONG
  collateralMint: string
  collateralSymbol: string
  collateralDecimals: number
  custodyMint: string // underlying custody mint (same as collateral for long, asset mint for short)
  maxLeverage: number // Jupiter caps at 250×; UI caps lower for safety
  priceId: string     // JUP price id (SOL, ETH, BTC)
  decimals: number    // price decimals
}

// Custody mints (mainnet)
export const MINT_SOL = 'So11111111111111111111111111111111111111112'
export const MINT_WETH = '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'
export const MINT_WBTC = '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh'
export const MINT_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

// Custody *account* pubkeys (mainnet JLP custodies — public, from perps-api.jup.ag/v1/jlp-info)
export const CUSTODY_PUBKEY_SOL = '7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz'
export const CUSTODY_PUBKEY_ETH = 'AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn'
export const CUSTODY_PUBKEY_WBTC = '5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm'
export const CUSTODY_PUBKEY_USDC = 'G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa'
export const JLP_POOL_PUBKEY_DEFAULT = '5BUwFW4nRbftYTDMbgSyAoCjRmVdJiuPACx2A9GPeDCW'

export const PERP_MARKETS: PerpMarket[] = [
  { id: 'SOL-LONG',  asset: 'SOL',  side: 'long',  label: 'SOL · LONG',  symbol: 'SOL-PERP LONG',  collateralMint: MINT_SOL,  collateralSymbol: 'SOL',  collateralDecimals: 9, custodyMint: MINT_SOL,  maxLeverage: 250, priceId: 'SOL', decimals: 9 },
  { id: 'SOL-SHORT', asset: 'SOL',  side: 'short', label: 'SOL · SHORT', symbol: 'SOL-PERP SHORT', collateralMint: MINT_USDC, collateralSymbol: 'USDC', collateralDecimals: 6, custodyMint: MINT_SOL,  maxLeverage: 250, priceId: 'SOL', decimals: 9 },
  { id: 'ETH-LONG',  asset: 'ETH',  side: 'long',  label: 'ETH · LONG',  symbol: 'ETH-PERP LONG',  collateralMint: MINT_WETH, collateralSymbol: 'wETH', collateralDecimals: 8, custodyMint: MINT_WETH, maxLeverage: 250, priceId: 'ETH', decimals: 8 },
  { id: 'ETH-SHORT', asset: 'ETH',  side: 'short', label: 'ETH · SHORT', symbol: 'ETH-PERP SHORT', collateralMint: MINT_USDC, collateralSymbol: 'USDC', collateralDecimals: 6, custodyMint: MINT_WETH, maxLeverage: 250, priceId: 'ETH', decimals: 8 },
  { id: 'WBTC-LONG', asset: 'WBTC', side: 'long',  label: 'WBTC · LONG', symbol: 'WBTC-PERP LONG', collateralMint: MINT_WBTC, collateralSymbol: 'wBTC', collateralDecimals: 8, custodyMint: MINT_WBTC, maxLeverage: 250, priceId: 'BTC', decimals: 8 },
  { id: 'WBTC-SHORT',asset: 'WBTC', side: 'short', label: 'WBTC · SHORT',symbol: 'WBTC-PERP SHORT',collateralMint: MINT_USDC, collateralSymbol: 'USDC', collateralDecimals: 6, custodyMint: MINT_WBTC, maxLeverage: 250, priceId: 'BTC', decimals: 8 },
]

export function marketById(id: string): PerpMarket | undefined {
  return PERP_MARKETS.find((m) => m.id === id)
}

/* ---------- trading params ---------- */
export const PERP_MIN_LEVERAGE = 1.1
export const PERP_MAX_LEVERAGE_UI = 100 // slider caps at 100 for safety; protocol allows 250
export const PERP_DEFAULT_LEVERAGE = 5
export const PERP_DEFAULT_MARKET_ID = 'SOL-LONG'
// Fees as seen on custody (approx; exact fetched from on-chain custody when available)
export const PERP_EST_OPEN_FEE_BPS = 6   // ~0.06 % open/close
export const PERP_EST_PRICE_IMPACT_BPS = 0 // oracle-priced, no orderbook slippage; impact fee varies with pool imbalance

export function isPerpConfigured(): boolean {
  // Perps read layer works with public APIs + RPC. Nothing is strictly
  // required beyond RPC — programId has a default. So "configured" really
  // means RPC is reachable. Still expose a flag for the UI badge.
  return perpRpcCandidates().length > 0
}

export function explorerTxUrl(sig: string): string {
  return `https://solscan.io/tx/${sig}`
}
export function explorerAccountUrl(addr: string): string {
  return `https://solscan.io/account/${addr}`
}
