/* ============================================================
   Shared EVM chain registry for UNISWAP.EXE + PANCAKE.EXE.
   Source of truth for every chain both executables touch:
   chain id, RPCs, explorer, wrapped native, per-provider router
   addresses.

   Contract addresses are VERIFIED against official docs (NOT
   assumed — Uniswap warns integrators never to assume same
   addresses across chains):
   - Uniswap V3 BSC: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-bnb-deployments
     (Factory 0xdB1d…F7, QuoterV2 0x78D7…077, SwapRouter02 0xB971…85d2)
   - Uniswap V3 Ethereum: canonical deployments
     (Factory 0x1F98…F984, QuoterV2 0x61fF…21e, SwapRouter02 0x68b3…Fc45
     per @uniswap/swap-router-contracts v1.1.0 release: "deployed on
     all networks at 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45")
   - PancakeSwap V2 routers: https://developer.pancakeswap.finance/contracts/v2/addresses
     (BSC 0x10ED…24E, ETH 0xEfF9…b1c, Base/Arbitrum 0x8cFe…2Eb)

   Adding a chain later = one entry here + its tokens in
   tokens.ts. No UI rewrite. Chains whose router addresses are NOT
   verified stay OUT of the enabled lists below (see the commented
   placeholders).
   ============================================================ */

import type { Address } from 'viem'

export interface UniswapV3Deployment {
  quoterV2: Address
  swapRouter02: Address
}

export interface EvmChainDef {
  id: number
  name: string
  label: string
  symbol: string
  hex: string
  rpcs: string[]
  explorer: string
  wrappedNative: Address
  uniswapV3: UniswapV3Deployment | null
  pancakeV2Router: Address | null
}

function envRpc(key: string): string {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key]
    return (v ?? '').trim()
  } catch {
    return ''
  }
}

export const EVM_CHAINS: Record<number, EvmChainDef> = {
  56: {
    id: 56,
    name: 'BSC',
    label: 'BNB Chain',
    symbol: 'BNB',
    hex: '0x38',
    rpcs: [
      envRpc('VITE_BSC_RPC_URL'),
      'https://bsc-dataseed.binance.org',
      'https://bsc-dataseed1.binance.org',
      'https://bsc.llamarpc.com',
    ].filter(Boolean),
    explorer: 'https://bscscan.com',
    wrappedNative: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    uniswapV3: {
      quoterV2: '0x78D78E420Da98ad378D7799bE8f4AF69033EB077',
      swapRouter02: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2',
    },
    pancakeV2Router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  },
  1: {
    id: 1,
    name: 'ETHEREUM',
    label: 'Ethereum',
    symbol: 'ETH',
    hex: '0x1',
    rpcs: [
      envRpc('VITE_ETH_RPC_URL'),
      'https://eth.llamarpc.com',
      'https://ethereum-rpc.publicnode.com',
    ].filter(Boolean),
    explorer: 'https://etherscan.io',
    wrappedNative: '0xC02aaA39b223FE8D0A0e5c4F27eAD9083C756Cc2',
    uniswapV3: {
      quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    },
    pancakeV2Router: '0xEfF92A263d31888d860bD50809A8D171709b7b1c',
  },
  8453: {
    id: 8453,
    name: 'BASE',
    label: 'Base',
    symbol: 'ETH',
    hex: '0x2105',
    rpcs: [envRpc('VITE_BASE_RPC_URL'), 'https://mainnet.base.org', 'https://base.llamarpc.com'].filter(Boolean),
    explorer: 'https://basescan.org',
    wrappedNative: '0x4200000000000000000000000000000000000006',
    // Uniswap V3 IS deployed on Base, but this repo has not verified the
    // per-chain QuoterV2/SwapRouter02 addresses from
    // https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments
    // yet — verify there, then fill in to enable Base in UNISWAP.EXE.
    uniswapV3: null,
    pancakeV2Router: '0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb',
  },
  42161: {
    id: 42161,
    name: 'ARBITRUM',
    label: 'Arbitrum',
    symbol: 'ETH',
    hex: '0xa4b1',
    rpcs: [envRpc('VITE_ARBITRUM_RPC_URL'), 'https://arb1.arbitrum.io/rpc', 'https://arbitrum.llamarpc.com'].filter(
      Boolean,
    ),
    explorer: 'https://arbiscan.io',
    wrappedNative: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    // Same rule as Base — verify at
    // https://developers.uniswap.org/docs/protocols/v3/deployments first.
    uniswapV3: null,
    pancakeV2Router: '0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb',
  },
  137: {
    id: 137,
    name: 'POLYGON',
    label: 'Polygon',
    symbol: 'POL',
    hex: '0x89',
    rpcs: [envRpc('VITE_POLYGON_RPC_URL'), 'https://polygon-rpc.com', 'https://polygon.llamarpc.com'].filter(Boolean),
    explorer: 'https://polygonscan.com',
    // WMATIC — Uniswap Polygon deployments page
    // (https://developers.uniswap.org/docs/protocols/v3/deployments/v3-polygon-deployments).
    wrappedNative: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    // V3 deployment VERIFIED on the same page (canonical addresses on Polygon).
    uniswapV3: {
      quoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
      swapRouter02: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    },
    // PancakeSwap V2 has no verified Polygon router — API covers swaps here.
    pancakeV2Router: null,
  },
  43114: {
    id: 43114,
    name: 'AVALANCHE',
    label: 'Avalanche',
    symbol: 'AVAX',
    hex: '0xa86a',
    rpcs: [
      envRpc('VITE_AVALANCHE_RPC_URL'),
      'https://api.avax.network/ext/bc/C/rpc',
      'https://avalanche.llamarpc.com',
    ].filter(Boolean),
    explorer: 'https://snowtrace.io',
    // WAVAX — Snowtrace token page.
    wrappedNative: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
    // Uniswap V3 IS on Avalanche but this repo has not verified the
    // per-chain QuoterV2/SwapRouter02 addresses yet — API covers swaps.
    uniswapV3: null,
    pancakeV2Router: null,
  },
}

/* ---------- provider chain lists (only VERIFIED chains enabled) ---------- */

/** Chains UNISWAP.EXE actually supports today (live-verified Trading API list). */
export const UNISWAP_CHAIN_IDS: number[] = [56, 1, 8453, 42161, 137, 43114]

/** Chains PANCAKE.EXE actually supports today (verified V2 router). */
export const PANCAKE_CHAIN_IDS: number[] = [56, 1, 8453, 42161]

export function evmChain(id: number): EvmChainDef {
  const c = EVM_CHAINS[id]
  if (!c) throw new Error(`Unsupported chain (${id}) — pick a supported network.`)
  return c
}

export function explorerTxUrl(chainId: number, hash: string): string {
  return `${evmChain(chainId).explorer}/tx/${hash}`
}

export function explorerAddrUrl(chainId: number, addr: string): string {
  return `${evmChain(chainId).explorer}/address/${addr}`
}

/** viem-compatible chain object for wallet_addEthereumChain prompts. */
export function addChainParams(id: number): Record<string, unknown> {
  const c = evmChain(id)
  return {
    chainName: c.label,
    nativeCurrency: { name: c.symbol, symbol: c.symbol, decimals: 18 },
    rpcUrls: [c.rpcs[0]],
    blockExplorerUrls: [c.explorer],
  }
}
