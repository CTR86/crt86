import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Transaction, TransactionSignature, VersionedTransaction } from '@solana/web3.js'

/* ============================================================
   Thin Solana wallet layer (Wallet-Standard injected providers:
   Phantom, Solflare, Backpack). The StonkFun launch + claim
   flows only need signTransaction — the platform broadcasts.
   ============================================================ */

export interface SolanaProvider {
  isPhantom?: boolean
  isSolflare?: boolean
  publicKey?: { toString(): string }
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>
  disconnect(): Promise<void>
  signTransaction<T extends { signatures: unknown[] }>(tx: T): Promise<T>
  /** Phantom-recommended path — wallet simulates, signs and broadcasts */
  signAndSendTransaction?(
    tx: Transaction | VersionedTransaction,
    opts?: unknown,
  ): Promise<{ signature: string } | string>
}

declare global {
  interface Window {
    phantom?: { solana?: SolanaProvider }
    solflare?: SolanaProvider
    backpack?: { solana?: SolanaProvider }
  }
}

function detect(): { name: string; provider: SolanaProvider } | null {
  if (typeof window === 'undefined') return null
  if (window.phantom?.solana?.isPhantom) return { name: 'PHANTOM', provider: window.phantom.solana }
  if (window.solflare?.isSolflare) return { name: 'SOLFLARE', provider: window.solflare }
  if (window.backpack?.solana) return { name: 'BACKPACK', provider: window.backpack.solana }
  return null
}

export const SOLANA_RPC_CANDIDATES = (() => {
  try {
    const custom = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_SOLANA_RPC_URL?.trim()
    const base = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']
    return custom ? [...new Set([custom, ...base])] : base
  } catch {
    return ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']
  }
})()

interface SolanaWalletCtx {
  walletName: string | null
  address: string | null
  available: boolean
  connecting: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  /** sign a base64 transaction, return base64 signed tx + its signature */
  signBase64: (b64: string) => Promise<{ signedB64: string; signature: string }>
  /** handles both legacy and versioned wire transactions */
  signAnyBase64: (b64: string, versioned: boolean) => Promise<{ signedB64: string; signature: string }>
  /** sign + broadcast in the wallet (avoids Phantom simulation-block on sign-only) */
  signAndSendTx: (tx: Transaction | VersionedTransaction) => Promise<string>
  /** sign only — caller broadcasts so we can hit multiple RPCs */
  signTx: (tx: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>
  balanceSol: number | null
  /** true when every RPC endpoint failed and the balance is unknown */
  balanceUnknown: boolean
  refreshBalance: () => Promise<void>
}

const Ctx = createContext<SolanaWalletCtx>({
  walletName: null,
  address: null,
  available: false,
  connecting: false,
  connect: async () => {},
  disconnect: async () => {},
  signBase64: async () => ({ signedB64: '', signature: '' }),
  signAnyBase64: async () => ({ signedB64: '', signature: '' }),
  signAndSendTx: async () => '',
  signTx: async (tx) => tx,
  balanceSol: null,
  balanceUnknown: false,
  refreshBalance: async () => {},
})

export function useSolanaWallet() {
  return useContext(Ctx)
}

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const [walletName, setWalletName] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [balanceSol, setBalanceSol] = useState<number | null>(null)
  const [balanceUnknown, setBalanceUnknown] = useState(false)
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    setAvailable(!!detect())
    const id = setInterval(() => setAvailable(!!detect()), 1500)
    return () => clearInterval(id)
  }, [])

  /* silent reconnect for already-trusted sites (standard wallet behaviour) */
  useEffect(() => {
    const d = detect()
    if (!d) return
    d.provider
      .connect({ onlyIfTrusted: true })
      .then((res) => {
        setWalletName(d.name)
        setAddress(res.publicKey.toString())
      })
      .catch(() => {
        /* not trusted yet — user connects manually */
      })
  }, [])

  /** try each public RPC in order — the official one rate-limits browsers hard */
  const refreshBalance = useCallback(async () => {
    if (!address) return
    const { PublicKey, Connection } = await import('@solana/web3.js')
    for (const url of SOLANA_RPC_CANDIDATES) {
      try {
        const conn = new Connection(url, 'confirmed')
        const lamports = await conn.getBalance(new PublicKey(address))
        setBalanceSol(lamports / 1e9)
        setBalanceUnknown(false)
        return
      } catch {
        /* try the next endpoint */
      }
    }
    setBalanceUnknown(true)
  }, [address])

  useEffect(() => {
    void refreshBalance()
  }, [refreshBalance])

  const connect = useCallback(async () => {
    const d = detect()
    if (!d) throw new Error('No Solana wallet installed — install PHANTOM to proceed.')
    setConnecting(true)
    try {
      const res = await d.provider.connect()
      setWalletName(d.name)
      setAddress(res.publicKey.toString())
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    const d = detect()
    try {
      await d?.provider.disconnect()
    } catch {
      /* ignore */
    }
    setWalletName(null)
    setAddress(null)
    setBalanceSol(null)
  }, [])

  const signAnyBase64 = useCallback(async (b64: string, _versioned: boolean) => {
    const d = detect()
    if (!d) throw new Error('No Solana wallet connected')
    const web3 = await import('@solana/web3.js')
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    /* Ember flags its v0 transactions as legacy — autodetect wins over the flag */
    let tx: Transaction | VersionedTransaction
    try {
      tx = web3.VersionedTransaction.deserialize(raw)
    } catch {
      tx = web3.Transaction.from(raw)
    }
    const signed = (await d.provider.signTransaction(tx)) ?? tx
    const bytes = signed.serialize() as Uint8Array
    const signedB64 = btoa(String.fromCharCode(...new Uint8Array(bytes)))
    let sigBytes: Uint8Array | null = null
    if (signed instanceof web3.VersionedTransaction) sigBytes = signed.signatures[0] ?? null
    else sigBytes = signed.signatures[0]?.signature ?? null
    const signature: TransactionSignature = sigBytes ? (await import('bs58')).default.encode(sigBytes) : ''
    return { signedB64, signature }
  }, [])

  const signAndSendTx = useCallback(async (tx: Transaction | VersionedTransaction) => {
    const d = detect()
    if (!d) throw new Error('No Solana wallet connected')
    if (typeof d.provider.signAndSendTransaction !== 'function') {
      throw new Error('Wallet does not support signAndSendTransaction')
    }
    const res = await d.provider.signAndSendTransaction(tx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 5,
    })
    const sig = typeof res === 'string' ? res : res?.signature
    if (!sig) throw new Error('Wallet did not return a signature')
    return sig
  }, [])

  const signTx = useCallback(async (tx: Transaction | VersionedTransaction) => {
    const d = detect()
    if (!d) throw new Error('No Solana wallet connected')
    return (await d.provider.signTransaction(tx)) ?? tx
  }, [])

  const signBase64 = useCallback((b64: string) => signAnyBase64(b64, true), [signAnyBase64])

  const value: SolanaWalletCtx = {
    walletName,
    address,
    available,
    connecting,
    connect,
    disconnect,
    signBase64,
    signAnyBase64,
    signAndSendTx,
    signTx,
    balanceSol,
    balanceUnknown,
    refreshBalance,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
