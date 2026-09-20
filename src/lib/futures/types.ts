/* ============================================================
   Shared perp types for PERP.EXE (Aster + Hyperliquid).
   Both venues are EVM-signed, browser-direct (CORS * verified),
   no API keys, no server proxy. Auth material, when needed
   (Aster agent key, HL local agent key), lives in localStorage
   and never leaves the browser.
   (Jupiter perp engine lives separately in src/lib/perp/.)
   ============================================================ */

export type PerpVenueId = 'aster' | 'hyperliquid'
export type PerpNetwork = 'mainnet' | 'testnet'

export interface PerpMarket {
  venue: PerpVenueId
  /** display symbol: 'BTCUSDT' (Aster) / 'BTC' (HL) */
  symbol: string
  mark: number | null
  /** funding rate per interval, decimal (e.g. 0.0001 = 0.01%) */
  funding: number | null
  maxLeverage: number
  /** base-asset decimals for size rounding */
  sizeDecimals: number
  /** minimum order notional in USD */
  minNotional: number
  /** venue-native market id (asset index for HL, symbol for Aster) */
  ref: number | string
}

export type PerpSide = 'LONG' | 'SHORT'

export interface PerpPosition {
  venue: PerpVenueId
  symbol: string
  side: PerpSide
  /** base-asset size (always positive) */
  size: number
  entryPx: number
  markPx: number | null
  upnl: number
  leverage: number
}

export interface PerpOpenOrder {
  venue: PerpVenueId
  symbol: string
  orderId: string
  side: 'BUY' | 'SELL'
  price: number
  size: number
  reduceOnly: boolean
}

export interface PerpAccount {
  venue: PerpVenueId
  /** total equity in USD */
  equity: number | null
  /** available to trade in USD */
  available: number | null
}

export type PerpOrderType = 'MARKET' | 'LIMIT'

export interface PerpPlaceArgs {
  market: PerpMarket
  side: PerpSide
  /** base-asset size, already rounded to sizeDecimals */
  sizeBase: number
  type: PerpOrderType
  /** required for LIMIT */
  limitPx?: number
  leverage: number
  reduceOnly?: boolean
}

/** Hyperliquid auth: connected wallet signs per action, or a local
 *  agent key (approved on-chain via ApproveAgent) signs silently. */
export interface HlAuth {
  /** main account address (position owner) */
  user: string
  /** local agent private key (0x…) or null = sign with connected wallet */
  agentKey: string | null
  ethRequest: <T = unknown>(method: string, params?: unknown[]) => Promise<T>
}

/** Aster auth: main wallet address + agent private key (Pro API agent). */
export interface AsterAuth {
  user: string
  agentKey: string
}

export interface PerpProvider<M = PerpMarket> {
  id: PerpVenueId
  label: string
  marketsLabel: string
  fetchMarkets(net: PerpNetwork): Promise<M[]>
  fetchAccount(net: PerpNetwork, auth: HlAuth | AsterAuth): Promise<PerpAccount>
  fetchPositions(net: PerpNetwork, auth: HlAuth | AsterAuth): Promise<PerpPosition[]>
  fetchOpenOrders(net: PerpNetwork, auth: HlAuth | AsterAuth): Promise<PerpOpenOrder[]>
  /** sets leverage when needed, then places the order. Returns a human receipt line. */
  placeOrder(net: PerpNetwork, auth: HlAuth | AsterAuth, args: PerpPlaceArgs, log?: (l: string) => void): Promise<string>
  cancelOrder(net: PerpNetwork, auth: HlAuth | AsterAuth, order: PerpOpenOrder): Promise<string>
  closePosition(net: PerpNetwork, auth: HlAuth | AsterAuth, pos: PerpPosition, markPx: number): Promise<string>
  /** reduce-only TP/SL triggers on an open position (either or both). Returns receipt. */
  placeTpSl(
    net: PerpNetwork,
    auth: HlAuth | AsterAuth,
    args: { market: PerpMarket; position: PerpPosition; tpPx: number | null; slPx: number | null },
  ): Promise<string>
}

/* ---------- localStorage creds (browser-only, never transmitted) ---------- */

const LS_ASTER = 'crt86.aster.creds.v1'
const LS_HL_AGENT = 'crt86.hl.agent.v1'

export interface AsterCreds {
  user: string
  agentKey: string
}

export function loadAsterCreds(): AsterCreds | null {
  try {
    const raw = localStorage.getItem(LS_ASTER)
    if (!raw) return null
    const j = JSON.parse(raw) as Partial<AsterCreds>
    if (typeof j.user === 'string' && typeof j.agentKey === 'string' && /^0x[0-9a-fA-F]{64}$/.test(j.agentKey)) {
      return { user: j.user, agentKey: j.agentKey }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function saveAsterCreds(c: AsterCreds): void {
  localStorage.setItem(LS_ASTER, JSON.stringify(c))
}

export function clearAsterCreds(): void {
  localStorage.removeItem(LS_ASTER)
}

export interface HlAgentCreds {
  /** owner (main wallet) this agent was approved for */
  owner: string
  agentKey: string
}

export function loadHlAgent(owner: string): string | null {
  try {
    const raw = localStorage.getItem(LS_HL_AGENT)
    if (!raw) return null
    const j = JSON.parse(raw) as Partial<HlAgentCreds>
    if (
      typeof j.owner === 'string' &&
      j.owner.toLowerCase() === owner.toLowerCase() &&
      typeof j.agentKey === 'string' &&
      /^0x[0-9a-fA-F]{64}$/.test(j.agentKey)
    ) {
      return j.agentKey
    }
  } catch {
    /* ignore */
  }
  return null
}

export function saveHlAgent(c: HlAgentCreds): void {
  localStorage.setItem(LS_HL_AGENT, JSON.stringify(c))
}

export function clearHlAgent(): void {
  localStorage.removeItem(LS_HL_AGENT)
}
