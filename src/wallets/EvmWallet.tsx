import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Address } from 'viem'
import { RH_CHAIN_ID_HEX, rhChain } from '../lib/prm/chain'
import { walletClientFromEip1193 } from '../lib/prm/swaps'

/* ============================================================
   EVM wallet layer for Robinhood Chain (4663) — raw EIP-1193.
   ============================================================ */

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, handler: (...args: never[]) => void): void
  removeListener?(event: string, handler: (...args: never[]) => void): void
}

declare global {
  interface Window {
    ethereum?: Eip1193
  }
}

function eth(): Eip1193 | null {
  return typeof window !== 'undefined' ? window.ethereum ?? null : null
}

interface EvmWalletCtx {
  address: Address | null
  chainId: number | null
  available: boolean
  connecting: boolean
  connect: () => Promise<void>
  disconnect: () => void
  /** make sure the wallet is on chain 4663, prompting add/switch when needed */
  ensureChain: () => Promise<boolean>
  /** raw EIP-1193 passthrough — eth_sendTransaction, eth_getBalance, … */
  ethRequest: <T = unknown>(method: string, params?: unknown[]) => Promise<T>
  /** switch the wallet to any EVM chain; addParams used when the chain is unknown to the wallet */
  switchEvmChain: (hexChainId: string, addParams?: Record<string, unknown>) => Promise<boolean>
}

const Ctx = createContext<EvmWalletCtx>({
  address: null,
  chainId: null,
  available: false,
  connecting: false,
  connect: async () => {},
  disconnect: () => {},
  ensureChain: async () => false,
  ethRequest: (async () => {
    throw new Error('No EVM wallet installed')
  }) as EvmWalletCtx['ethRequest'],
  switchEvmChain: async () => false,
})

export function useEvmWallet() {
  return useContext(Ctx)
}

export function EvmWalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    setAvailable(!!eth())
  }, [])

  useEffect(() => {
    const p = eth()
    if (!p?.on) return
    const onAccounts = (...a: never[]) => {
      const accounts = a[0] as unknown as string[]
      setAddress((accounts?.[0] as Address) ?? null)
    }
    const onChain = (...a: never[]) => setChainId(parseInt(a[0] as unknown as string, 16))
    p.on('accountsChanged', onAccounts)
    p.on('chainChanged', onChain)
    return () => {
      p.removeListener?.('accountsChanged', onAccounts)
      p.removeListener?.('chainChanged', onChain)
    }
  }, [])

  const connect = useCallback(async () => {
    const p = eth()
    if (!p) throw new Error('No EVM wallet found — install an EVM wallet (e.g. MetaMask) to trade RH-CHAIN.')
    setConnecting(true)
    try {
      const accounts = (await p.request({ method: 'eth_requestAccounts' })) as string[]
      setAddress((accounts[0] as Address) ?? null)
      const cid = (await p.request({ method: 'eth_chainId' })) as string
      setChainId(parseInt(cid, 16))
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => setAddress(null), [])

  /** raw EIP-1193 passthrough — works on whatever chain the wallet is on */
  const ethRequest = useCallback(async function <T = unknown>(method: string, params?: unknown[]): Promise<T> {
    const p = eth()
    if (!p) throw new Error('No EVM wallet installed')
    return (await p.request({ method, params })) as T
  }, [])

  /** switch to any EVM chain; add it first if the wallet doesn't know it */
  const switchEvmChain = useCallback(async (hexChainId: string, addParams?: Record<string, unknown>): Promise<boolean> => {
    const p = eth()
    if (!p) return false
    try {
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] })
    } catch {
      if (!addParams) return false
      await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hexChainId, ...addParams }] })
    }
    setChainId(parseInt(hexChainId, 16))
    return true
  }, [])

  const ensureChain = useCallback(async () => {
    const p = eth()
    if (!p) return false
    const cid = (await p.request({ method: 'eth_chainId' })) as string
    if (parseInt(cid, 16) === rhChain.id) {
      setChainId(rhChain.id)
      return true
    }
    try {
      await p.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: RH_CHAIN_ID_HEX }],
      })
    } catch {
      await p.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: RH_CHAIN_ID_HEX,
            chainName: rhChain.name,
            nativeCurrency: rhChain.nativeCurrency,
            rpcUrls: [rhChain.rpcUrls.default.http[0]],
          },
        ],
      })
    }
    setChainId(rhChain.id)
    return true
  }, [])

  const value = useMemo(
    () => ({ address, chainId, available, connecting, connect, disconnect, ensureChain, ethRequest, switchEvmChain }),
    [address, chainId, available, connecting, connect, disconnect, ensureChain, ethRequest, switchEvmChain],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** helper for components that need a viem wallet client for the connected EIP-1193 provider */
export function activeWalletClient() {
  const p = eth()
  if (!p) throw new Error('No EVM provider')
  return walletClientFromEip1193(p)
}
