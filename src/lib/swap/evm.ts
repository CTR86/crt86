/* ============================================================
   Shared EVM transport for UNISWAP.EXE + PANCAKE.EXE.
   One viem public-client factory (fallback across the chain's
   RPC list), minimal ABIs, balance/allowance/approve helpers,
   wallet-send + receipt polling over the existing EIP-1193
   wallet (useEvmWallet().ethRequest — no new wallet infra).
   Provider modules (uniswap.ts / pancakeswap.ts) own quoting and
   calldata; this file owns everything they share.
   ============================================================ */

import {
  createPublicClient,
  fallback,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { evmChain } from './chains'
import { isNative } from './tokens'
import type { EvmToken } from './tokens'

const clients = new Map<number, PublicClient>()

export function publicClient(chainId: number): PublicClient {
  const hit = clients.get(chainId)
  if (hit) return hit
  const c = evmChain(chainId)
  const client = createPublicClient({
    transport: fallback(
      c.rpcs.map((url) => http(url, { timeout: 12_000 })),
      { rank: true },
    ),
  })
  clients.set(chainId, client)
  return client
}

/* ---------- minimal ABIs ---------- */

export const ERC20_ABI = [
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const

export const QUOTER_V2_ABI = [
  {
    name: 'quoteExactInputSingle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const

export const SWAP_ROUTER_02_ABI = [
  {
    name: 'exactInputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'unwrapWETH9',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountMinimum', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'refundETH',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'multicall',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'data', type: 'bytes[]' }],
    outputs: [{ name: 'results', type: 'bytes[]' }],
  },
] as const

export const PANCAKE_V2_ROUTER_ABI = [
  {
    name: 'getAmountsOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactETHForTokens',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactTokensForETH',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactTokensForTokens',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const

/* ---------- token metadata / balances ---------- */

/** Resolve decimals + symbol for an arbitrary ERC20 (native short-circuits). */
export async function readTokenMeta(
  chainId: number,
  token: EvmToken,
): Promise<{ decimals: number; symbol: string }> {
  if (isNative(token)) return { decimals: token.decimals, symbol: token.symbol }
  const pc = publicClient(chainId)
  const [decimals, symbol] = await Promise.all([
    pc.readContract({ address: token.address, abi: ERC20_ABI, functionName: 'decimals' }) as Promise<number>,
    pc
      .readContract({ address: token.address, abi: ERC20_ABI, functionName: 'symbol' })
      .catch(() => token.symbol) as Promise<string>,
  ])
  return { decimals: Number(decimals), symbol: String(symbol) }
}

/** Human balance (native or ERC20). Null = RPC unreachable, not zero. */
export async function getEvmBalanceHuman(
  chainId: number,
  owner: Address,
  token: EvmToken,
): Promise<number | null> {
  try {
    const pc = publicClient(chainId)
    if (isNative(token)) {
      const wei = await pc.getBalance({ address: owner })
      return Number(wei) / 1e18
    }
    const [raw, meta] = await Promise.all([
      pc.readContract({ address: token.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] }),
      readTokenMeta(chainId, token).catch(() => ({ decimals: token.decimals, symbol: token.symbol })),
    ])
    return Number(raw as bigint) / 10 ** meta.decimals
  } catch {
    return null
  }
}

export async function getAllowance(chainId: number, token: Address, owner: Address, spender: Address): Promise<bigint> {
  const pc = publicClient(chainId)
  const v = (await pc.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, spender],
  })) as bigint
  return v
}

/* ---------- wallet send + receipt ---------- */

export type EthRequest = <T = unknown>(method: string, params?: unknown[]) => Promise<T>

export interface EvmTxRequest {
  from: Address
  to: Address
  data?: Hex
  value?: Hex
}

const hexVal = (v: bigint): Hex => `0x${v.toString(16)}` as Hex

export function toHexValue(v: bigint): Hex {
  return hexVal(v)
}

/** Send via the connected EIP-1193 wallet. The wallet simulates, signs and broadcasts. */
export async function walletSendTx(ethRequest: EthRequest, tx: EvmTxRequest): Promise<string> {
  const hash = await ethRequest<string>('eth_sendTransaction', [
    {
      from: tx.from,
      to: tx.to,
      ...(tx.data ? { data: tx.data } : {}),
      ...(tx.value != null ? { value: tx.value } : {}),
    },
  ])
  if (!hash || typeof hash !== 'string') throw new Error('Wallet did not return a transaction hash.')
  return hash
}

interface Receipt {
  status?: string
  blockNumber?: string
}

/** Poll eth_getTransactionReceipt until mined or timeout. Throws on revert. */
export async function waitForEvmReceipt(
  ethRequest: EthRequest,
  hash: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeout = opts?.timeoutMs ?? 180_000
  const interval = opts?.intervalMs ?? 2_500
  const start = Date.now()
  for (;;) {
    const r = (await ethRequest<Receipt | null>('eth_getTransactionReceipt', [hash]).catch(() => null)) ?? null
    if (r?.blockNumber) {
      if (r.status === '0x0') throw new Error('Transaction reverted on-chain — check the explorer for the revert reason.')
      return
    }
    if (Date.now() - start > timeout) {
      throw new Error('Confirmation timed out — the tx may still land. Check the explorer before retrying.')
    }
    await new Promise((res) => setTimeout(res, interval))
  }
}

/** Poll the public RPC (not the wallet) for a receipt — survives page-refresh gaps. */
export async function pollReceiptPublic(chainId: number, hash: Hex): Promise<'ok' | 'reverted' | 'pending'> {
  try {
    const pc = publicClient(chainId)
    const r = await pc.getTransactionReceipt({ hash })
    if (!r) return 'pending'
    return r.status === 'success' ? 'ok' : 'reverted'
  } catch {
    return 'pending'
  }
}
