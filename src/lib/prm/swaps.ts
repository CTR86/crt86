import {
  createWalletClient,
  custom,
  type WalletClient,
  type Address,
} from 'viem'
import { readContract, waitForTransactionReceipt, writeContract } from 'viem/actions'
import { PRM, publicClient, rhChain } from './chain'
import { ERC20_ABI, ROUTER_ABI } from './abis'
import { isBuy, swapFunctionName, type QuoteResult, type TradeMode } from './quotes'

/* ============================================================
   Execution — approve (router only, per docs) then swap.
   All writes go through the user's EIP-1193 wallet provider.
   ============================================================ */

export function walletClientFromEip1193(eip1193: unknown): WalletClient {
  return createWalletClient({ chain: rhChain, transport: custom(eip1193 as never) })
}

export async function allowanceOf(token: string, owner: string): Promise<bigint> {
  return (await readContract(publicClient(), {
    address: token as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner as `0x${string}`, PRM.router],
  })) as bigint
}

export async function approveRouter(
  wallet: WalletClient,
  account: Address,
  token: string,
  amountIn: bigint,
): Promise<`0x${string}`> {
  return writeContract(wallet, {
    address: token as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [PRM.router, amountIn],
    account,
    chain: rhChain,
  })
}

export interface ExecuteArgs {
  mode: TradeMode
  quote: QuoteResult
  meme?: string
  subjectId?: string
  account: Address
  deadlineSeconds?: number
}

export async function executeSwap(wallet: WalletClient, args: ExecuteArgs): Promise<`0x${string}`> {
  const { mode, quote, meme, subjectId, account } = args
  const deadline = BigInt(Math.floor(Date.now() / 1000) + (args.deadlineSeconds ?? 300))
  const fn = swapFunctionName(mode)
  const recipient = account

  const base = { address: PRM.router, abi: ROUTER_ABI, functionName: fn, account, chain: rhChain }

  let hash: `0x${string}`
  switch (mode) {
    case 'eth-meme': // payable: msg.value is the input
      hash = await writeContract(wallet, {
        ...base,
        args: [meme as `0x${string}`, quote.minOut, recipient, deadline],
        value: quote.amountIn,
      })
      break
    case 'meme-eth':
      hash = await writeContract(wallet, {
        ...base,
        args: [meme as `0x${string}`, quote.amountIn, quote.minOut, recipient, deadline],
      })
      break
    case 'eth-stock': // payable
      hash = await writeContract(wallet, {
        ...base,
        args: [subjectId as `0x${string}`, quote.minOut, recipient, deadline],
        value: quote.amountIn,
      })
      break
    case 'stock-eth':
      hash = await writeContract(wallet, {
        ...base,
        args: [subjectId as `0x${string}`, quote.amountIn, quote.minOut, recipient, deadline],
      })
      break
    case 'stock-meme': // pays with pSTOCK (already approved)
      hash = await writeContract(wallet, {
        ...base,
        args: [meme as `0x${string}`, quote.amountIn, quote.minOut, recipient, deadline],
      })
      break
    case 'meme-stock':
      hash = await writeContract(wallet, {
        ...base,
        args: [meme as `0x${string}`, quote.amountIn, quote.minOut, recipient, deadline],
      })
      break
    default:
      throw new Error('Unsupported route')
  }
  return hash
}

export async function awaitReceipt(hash: `0x${string}`) {
  return waitForTransactionReceipt(publicClient(), { hash, confirmations: 2, timeout: 180_000 })
}

export function friendlySwapError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e)
  if (/User rejected/i.test(msg)) return 'TRANSMISSION ABORTED — you rejected the request in your wallet.'
  if (/insufficient funds/i.test(msg)) return 'INSUFFICIENT FUEL — not enough ETH in wallet.'
  if (/allowance|approve/i.test(msg)) return 'APPROVAL REQUIRED — approve the router first.'
  if (/expired|deadline/i.test(msg)) return 'QUOTE EXPIRED — re-quote and try again.'
  if (/chain|4663/i.test(msg)) return 'WRONG CHAIN — switch your wallet to Robinhood Chain (4663).'
  return msg.length > 220 ? msg.slice(0, 220) + '…' : msg
}

/** token address when this route pays with an ERC-20 (needs allowance), else null */
export function inputTokenFor(mode: TradeMode, meme?: string): string | null {
  if (isBuy(mode)) return mode === 'stock-meme' ? meme ?? null : null
  return mode === 'meme-eth' || mode === 'meme-stock' ? meme ?? null : null
}
