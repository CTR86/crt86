import { createPublicClient, defineChain, http, type Chain, type PublicClient } from 'viem'

/* Robinhood Chain (PRM / Robinhood Premium protocol) — chain id 4663 */

export const RH_RPC = 'https://rpc.mainnet.chain.robinhood.com'

export const rhChain: Chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RH_RPC] } },
})

export const RH_CHAIN_ID_HEX = '0x1237' // 4663

export const PRM = {
  router: '0x08A59435c8359A45F4F5dC8D91DF893Cc33DaF29' as const,
  prmToken: '0xf24f8F6b08fE87CF062E833a732AD7F636064BC8' as const,
  memeFactory: '0x34fb85aF7588dB97Fd6db6508Aa387D0f088564c' as const,
  subjectFactory: '0x4cD66e38C3B4597734C6D4A6A404509fBE822D23' as const,
}

export const ZERO_SUBJECT_ID =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const

let _public: PublicClient | null = null

export function publicClient(): PublicClient {
  if (!_public) {
    _public = createPublicClient({
      chain: rhChain,
      transport: http(RH_RPC, { timeout: 15_000 }),
    })
  }
  return _public
}

/* curve phases */
export const PHASE = { TRADING: 0, GRADUATED: 1, PAUSED: 2 } as const
export function phaseName(p: number): string {
  return p === 0 ? 'TRADING' : p === 1 ? 'GRADUATED' : p === 2 ? 'PAUSED' : 'UNKNOWN'
}
