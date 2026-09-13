import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPublicClient, formatUnits, http } from 'viem'
import { useEvmWallet } from '../wallets/EvmWallet'
import { useSolanaWallet } from '../wallets/SolanaWallet'
import { useUi } from '../store/ui'
import { BRIDGE_CHAINS, RH_CHAIN, SOLANA_CHAIN_ID, SOL_MINT, NATIVE, currencyOutHuman, extractQuote, getRelayQuote, indexRelayTx, relayRequestId, waitForRelayFill, type RelayQuote } from '../lib/relay'
import { play } from '../sound/sfx'
import { Panel } from '../design/ui'
import { SystemDialog } from '../design/SystemDialog'
import { blocks, shortAddr } from '../lib/format'

type Direction = 'sol2evm' | 'evm2sol'
type Phase = 'idle' | 'quoting' | 'ready' | 'sending' | 'tracking' | 'success' | 'error'

const hexVal = (v: string | undefined) => (v != null ? '0x' + BigInt(v).toString(16) : undefined)
/** Relay SVM instruction data is hex (optional 0x). Wrong decoding makes Phantom fail simulation. */
const hexToBytes = (hex: string) => {
  const h = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  if (h.length % 2) throw new Error('Invalid instruction data')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) {
    const n = parseInt(h.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(n)) throw new Error('Invalid instruction data')
    out[i] = n
  }
  return out
}
/** keep a little SOL so the signature fee doesn't empty the wallet (MAX would fail Phantom sim) */
const SOL_FEE_RESERVE = 0.0001

const SOL_CONNECTIONS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']

interface SolQuote {
  outEth: string
  gasSol: number
  requestId: string
  data: {
    instructions: { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }[]
    addressLookupTableAddresses: string[]
  }
}

/** EVM destinations — RH-CHAIN featured first */
/** EVM sources for the EVM→SOL direction */
const SRC_CHAINS = [RH_CHAIN, ...BRIDGE_CHAINS]
/** EVM destinations — RH-CHAIN featured first */
const DEST_CHAINS = [RH_CHAIN, ...BRIDGE_CHAINS]

export function BridgeWindow() {
  const nav = useNavigate()
  const evm = useEvmWallet()
  const sol = useSolanaWallet()
  const openWalletHelp = useUi((s) => s.openWalletHelp)

  const [dir, setDir] = useState<Direction>('sol2evm')
  const [srcChainIdx, setSrcChainIdx] = useState(0) // RH-CHAIN first for reverse wire
  const [dstChainIdx, setDstChainIdx] = useState(0) // RH-CHAIN featured
  const [amount, setAmount] = useState('')
  const [solPrice, setSolPrice] = useState<number | null>(null)
  const [evmBalance, setEvmBalance] = useState<string | null>(null)
  const [quote, setQuote] = useState<ReturnType<typeof extractQuote> | null>(null)
  const [solQuote, setSolQuote] = useState<SolQuote | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [statusText, setStatusText] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [celebrate, setCelebrate] = useState<{
    route: string
    sent: string
    received: string
    destTx?: string
  } | null>(null)
  const busy = useRef(false)

  const dstChain = DEST_CHAINS[dstChainIdx]
  const srcChain = SRC_CHAINS[srcChainIdx]

  const log = (l: string) => setStatusText((s) => [...s.slice(-24), `[${new Date().toLocaleTimeString()}] ${l}`])

  useEffect(() => {
    fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')
      .then((r) => r.json())
      .then((j) => setSolPrice(j?.solana?.usd ?? null))
      .catch(() => setSolPrice(null))
  }, [])

  const evmChainForBalance = dir === 'evm2sol' ? srcChain : dstChain
  const refreshEvmBalance = useCallback(() => {
    if (!evm.address) return setEvmBalance(null)
    const pc = createPublicClient({ transport: http(evmChainForBalance.rpc, { timeout: 12_000 }) })
    pc.getBalance({ address: evm.address })
      .then((wei) => setEvmBalance(formatUnits(wei, 18)))
      .catch(() => setEvmBalance(null))
  }, [evm.address, evmChainForBalance])

  useEffect(() => {
    setQuote(null)
    setSolQuote(null)
    setPhase('idle')
    setErr(null)
    refreshEvmBalance()
  }, [dir, dstChainIdx, srcChainIdx, evm.address])

  const amountNum = useMemo(() => (isFinite(Number(amount)) ? Number(amount) : 0), [amount])


  /* ---------- quotes ---------- */
  const doSolQuote = async () => {
    if (!sol.address || !evm.address || amountNum <= 0) return
    setPhase('quoting')
    setErr(null)
    try {
      const q = (await getRelayQuote({
        user: sol.address,
        originChainId: SOLANA_CHAIN_ID,
        destinationChainId: dstChain.id,
        amount: String(Math.floor(amountNum * 1e9)),
        recipient: evm.address,
        originCurrency: SOL_MINT,
        destinationCurrency: NATIVE,
      } as never)) as RelayQuote
      const txStep = q.steps?.find((s) => s.kind === 'transaction')
      const d = txStep?.items?.[0]?.data as SolQuote['data'] | undefined
      if (!d?.instructions?.length) throw new Error('No Solana transaction in quote')
      setSolQuote({
        outEth: String(currencyOutHuman(q).outHuman),
        gasSol: Number(q.fees?.gas?.amount ?? 0) / 1e9,
        requestId: relayRequestId(q),
        data: d,
      })
      setPhase('ready')
      play('coin')
    } catch (e) {
      setPhase('error')
      setErr(String((e as Error).message ?? e))
      play('error')
    }
  }

  const doEvmQuote = async () => {
    if (!evm.address || !sol.address || amountNum <= 0) return
    setPhase('quoting')
    setErr(null)
    try {
      await evm.switchEvmChain(srcChain.hex, {
        chainName: srcChain.name === 'RH-CHAIN' ? 'Robinhood Chain' : srcChain.name,
        nativeCurrency: { name: srcChain.symbol, symbol: srcChain.symbol, decimals: 18 },
        rpcUrls: [srcChain.rpc],
        blockExplorerUrls: [srcChain.explorer],
      }).catch(() => false)
      const q = await getRelayQuote({
        user: evm.address,
        originChainId: srcChain.id,
        destinationChainId: SOLANA_CHAIN_ID,
        amount: BigInt(Math.floor(amountNum * 1e18)).toString(),
        recipient: sol.address,
        originCurrency: NATIVE,
        destinationCurrency: SOL_MINT,
      })
      const ex = extractQuote(q)
      if (!ex.tx) throw new Error('No transaction route returned')
      setQuote(ex)
      setPhase('ready')
      play('coin')
    } catch (e) {
      setPhase('error')
      setErr(String((e as Error).message ?? e))
      play('error')
    }
  }

  /* ---------- executions ---------- */
  const doSol2Evm = async () => {
    if (!sol.address || !evm.address || amountNum <= 0) return
    if (busy.current) return
    busy.current = true
    setConfirmOpen(false)
    setErr(null)
    let liveQuote = solQuote
    try {
      setPhase('sending')
      log('REFRESHING RELAY QUOTE…')
      const q = (await getRelayQuote({
        user: sol.address,
        originChainId: SOLANA_CHAIN_ID,
        destinationChainId: dstChain.id,
        amount: String(Math.floor(amountNum * 1e9)),
        recipient: evm.address,
        originCurrency: SOL_MINT,
        destinationCurrency: NATIVE,
      } as never)) as RelayQuote
      const txStep = q.steps?.find((s) => s.kind === 'transaction')
      const d = txStep?.items?.[0]?.data as SolQuote['data'] | undefined
      if (!d?.instructions?.length) throw new Error('No Solana transaction in quote')
      liveQuote = {
        outEth: String(currencyOutHuman(q).outHuman),
        gasSol: Number(q.fees?.gas?.amount ?? 0) / 1e9,
        requestId: relayRequestId(q),
        data: d,
      }
      setSolQuote(liveQuote)

      log('BUILDING SOLANA TRANSACTION…')
      const web3 = await import('@solana/web3.js')
      let conn: import('@solana/web3.js').Connection | null = null
      let blockhash = ''
      for (const rpc of SOL_CONNECTIONS) {
        try {
          conn = new web3.Connection(rpc, 'confirmed')
          blockhash = (await conn.getLatestBlockhash()).blockhash
          break
        } catch { /* next rpc */ }
      }
      if (!conn || !blockhash) throw new Error('No Solana RPC reachable')

      const ixs = liveQuote.data.instructions.map((ix) =>
        new web3.TransactionInstruction({
          programId: new web3.PublicKey(ix.programId),
          keys: ix.keys.map((k) => ({ pubkey: new web3.PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
          data: hexToBytes(ix.data) as never,
        }),
      )
      const lutAddrs = liveQuote.data.addressLookupTableAddresses ?? []
      const resolved = await Promise.all(
        lutAddrs.map((lut) =>
          conn!.getAddressLookupTable(new web3.PublicKey(lut)).then((r) => r.value).catch(() => null),
        ),
      )
      const luts = resolved.filter((t): t is import('@solana/web3.js').AddressLookupTableAccount => t != null)
      const msg = new web3.TransactionMessage({
        payerKey: new web3.PublicKey(sol.address),
        recentBlockhash: blockhash,
        instructions: ixs,
      }).compileToV0Message(luts)
      const vtx = new web3.VersionedTransaction(msg)

      /* Phantom flags txs that fail simulation as "this dApp could be malicious" */
      log('SIMULATING ON SOLANA…')
      let simOk = false
      for (const rpc of SOL_CONNECTIONS) {
        try {
          const c = rpc === SOL_CONNECTIONS[0] && conn ? conn : new web3.Connection(rpc, 'confirmed')
          const sim = await c.simulateTransaction(vtx, { sigVerify: false, replaceRecentBlockhash: true })
          if (sim.value.err) {
            const blob = JSON.stringify(sim.value.err) + '\n' + (sim.value.logs ?? []).join('\n')
            if (/insufficient|0x1\b/i.test(blob)) {
              throw new Error('Not enough SOL to cover the bridge + network fee. Leave a little SOL in the wallet (do not send MAX).')
            }
            throw new Error('Bridge transaction would fail on-chain. Re-quote and try a slightly smaller amount.')
          }
          simOk = true
          break
        } catch (e) {
          const m = String((e as Error).message ?? e)
          if (m.includes('Not enough SOL') || m.includes('would fail on-chain')) throw e
        }
      }
      if (!simOk) log('SIM RPC UNAVAILABLE — PHANTOM WILL SIMULATE')

      log('REQUESTING PHANTOM SIGNATURE…')
      play('alert')
      let sig = ''
      let raw: Uint8Array | null = null
      try {
        const signed = await sol.signTx(vtx)
        raw = new Uint8Array(signed.serialize() as Uint8Array)
        const bs58 = (await import('bs58')).default
        const sigBytes = signed instanceof web3.VersionedTransaction
          ? signed.signatures[0]
          : signed.signatures[0]?.signature
        if (sigBytes) sig = bs58.encode(sigBytes)
      } catch (e) {
        const m = String((e as Error).message ?? e)
        if (/malicious|blocked|signTransaction/i.test(m)) {
          log('SIGN-ONLY BLOCKED — FALLING BACK TO SIGN AND SEND')
          sig = await sol.signAndSendTx(vtx)
        } else {
          throw e
        }
      }
      if (raw) {
        let sent = false
        for (const rpc of SOL_CONNECTIONS) {
          try {
            const c = new web3.Connection(rpc, 'confirmed')
            const sentSig = await c.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 5 })
            if (sentSig) sig = sentSig
            sent = true
          } catch (e) {
            const m = String((e as Error).message ?? e)
            if (/already been processed|already processed/i.test(m)) sent = true
          }
        }
        if (!sent && !sig) throw new Error('Could not broadcast the Solana transaction')
      }
      if (!sig) throw new Error('No Solana signature returned')
      log(`SOL TX ${sig.slice(0, 18)}… SUBMITTED`)
      log('https://solscan.io/tx/' + sig)
      try {
        await indexRelayTx({ txHash: sig, chainId: SOLANA_CHAIN_ID, requestId: liveQuote.requestId })
        log('RELAY INDEXED ORIGIN TX')
      } catch (e) {
        log('INDEX WARN: ' + String((e as Error).message ?? e).slice(0, 80))
      }
      log('WAITING FOR SOLANA CONFIRMATION…')
      let landed = false
      for (let i = 0; i < 40; i++) {
        for (const rpc of SOL_CONNECTIONS) {
          try {
            const c = rpc === SOL_CONNECTIONS[0] ? conn : new web3.Connection(rpc, 'confirmed')
            const st = await c.getSignatureStatus(sig, { searchTransactionHistory: true })
            if (st?.value?.err) throw new Error('Solana transaction failed on-chain — check Solscan. Funds should still be in Phantom.')
            const cs = st?.value?.confirmationStatus
            if (cs === 'confirmed' || cs === 'finalized') { landed = true; break }
          } catch (e) {
            const m = String((e as Error).message ?? e)
            if (m.includes('failed on-chain')) throw e
          }
        }
        if (landed) break
        await new Promise((r) => setTimeout(r, 1500))
      }
      if (!landed) throw new Error('Solana tx did not confirm. Open the Solscan link — if it is missing, the wallet never broadcast it.')
      log('SOLANA CONFIRMED — TELLING RELAY TO INDEX…')
      try {
        await indexRelayTx({ txHash: sig, chainId: SOLANA_CHAIN_ID, requestId: liveQuote.requestId })
      } catch (e) {
        log('INDEX WARN: ' + String((e as Error).message ?? e).slice(0, 80))
      }

      if (!liveQuote.requestId) throw new Error('No tracking id — check recipient wallet shortly.')
      setPhase('tracking')
      log('TRACKING RELAY FILL…')
      const fill = await waitForRelayFill({
        requestId: liveQuote.requestId,
        originChainId: SOLANA_CHAIN_ID,
        originTx: sig,
        log,
      })
      log('✓ BRIDGE COMPLETE — ETH DELIVERED ON ' + dstChain.name)
      if (fill.destTx) log('DEST TX ' + String(fill.destTx).slice(0, 18) + '…')
      setPhase('success')
      play('win')
      setCelebrate({
        route: 'SOLANA → ' + dstChain.name,
        sent: amount + ' SOL',
        received: '≈ ' + Number(liveQuote.outEth).toFixed(6) + ' ETH',
        destTx: fill.destTx,
      })
    } catch (e) {
      play('error')
      const m = String((e as Error).message ?? e)
      const blocked = /malicious|blocked this request|unsafe/i.test(m)
      setErr(
        blocked
          ? 'Phantom blocked the request (simulation). Leave a little SOL for fees and try CONFIRM again — do not send MAX.'
          : m.includes('reject') || m.includes('refus')
            ? 'You rejected the request in Phantom.'
            : m,
      )
      setPhase(liveQuote ? 'ready' : 'error')
    } finally {
      busy.current = false
    }
  }

  const doEvm2Sol = async () => {
    if (!evm.address || !sol.address || amountNum <= 0) return
    if (busy.current) return
    busy.current = true
    setConfirmOpen(false)
    setErr(null)
    try {
      setPhase('sending')
      log(`SWITCHING WALLET TO ${srcChain.name}…`)
      const ok = await evm.switchEvmChain(srcChain.hex, {
        chainName: srcChain.name === 'RH-CHAIN' ? 'Robinhood Chain' : srcChain.name,
        nativeCurrency: { name: srcChain.symbol, symbol: srcChain.symbol, decimals: 18 },
        rpcUrls: [srcChain.rpc],
        blockExplorerUrls: [srcChain.explorer],
      })
      if (!ok) throw new Error('Could not switch wallet to ' + srcChain.name + '. Add the chain in your EVM wallet and retry.')
      log('REFRESHING RELAY QUOTE…')
      const q = await getRelayQuote({
        user: evm.address,
        originChainId: srcChain.id,
        destinationChainId: SOLANA_CHAIN_ID,
        amount: BigInt(Math.floor(amountNum * 1e18)).toString(),
        recipient: sol.address,
        originCurrency: NATIVE,
        destinationCurrency: SOL_MINT,
      })
      const ex = extractQuote(q)
      if (!ex.tx?.to) throw new Error('No transaction route returned')
      setQuote(ex)
      log('REQUESTING WALLET SIGNATURE…')
      play('alert')
      const tx = ex.tx as { to?: string; data?: string; value?: string; gas?: string }
      const hash = await evm.ethRequest<string>('eth_sendTransaction', [
        {
          from: evm.address,
          to: tx.to,
          data: tx.data,
          value: hexVal(tx.value),
          ...(tx.gas ? { gas: hexVal(tx.gas) } : {}),
        },
      ])
      log(`TX SENT ${String(hash).slice(0, 18)}…`)
      try {
        await indexRelayTx({ txHash: hash, chainId: srcChain.id, requestId: ex.requestId })
      } catch { /* index is best-effort */ }
      if (!ex.requestId) throw new Error('No tracking id — check your Solana wallet shortly.')
      setPhase('tracking')
      log('TRACKING — RELAY IS FILLING YOUR SOLANA WALLET…')
      const fill = await waitForRelayFill({
        requestId: ex.requestId,
        originChainId: srcChain.id,
        originTx: hash,
        log,
      })
      log('✓ BRIDGE COMPLETE — SOL DELIVERED TO PHANTOM')
      if (fill.destTx) log('DEST TX ' + String(fill.destTx).slice(0, 18) + '…')
      setPhase('success')
      play('win')
      setCelebrate({
        route: srcChain.name + ' → SOLANA',
        sent: amount + ' ' + srcChain.symbol,
        received: '≈ ' + ex.outHuman.toFixed(6) + ' SOL',
        destTx: fill.destTx,
      })
    } catch (e) {
      play('error')
      const m = String((e as Error).message ?? e)
      setErr(m.includes('reject') || m.includes('denied') ? 'You rejected the request in your wallet.' : m)
      setPhase('error')
    } finally {
      busy.current = false
    }
  }

  const statusTone = phase === 'success' ? 'var(--green)' : phase === 'error' ? 'var(--red)' : 'var(--amber)'

  /* ---------- contextual action button ---------- */
  const action = useMemo(() => {
    if (dir === 'sol2evm') {
      if (!sol.address) return { label: '👻 SELECT SOLANA WALLET', act: () => (sol.available ? sol.connect().catch(() => play('error')) : openWalletHelp('sol')), disabled: false }
      if (!evm.address) return { label: dstChain.name === 'RH-CHAIN' ? 'SELECT ROBINHOOD CHAIN WALLET' : 'CONNECT DEST WALLET', act: () => (evm.available ? evm.connect().catch(() => play('error')) : openWalletHelp('evm')), disabled: false }
    } else {
      if (!evm.address) return { label: srcChain.name === 'RH-CHAIN' ? 'SELECT ROBINHOOD CHAIN WALLET' : 'CONNECT SOURCE WALLET', act: () => (evm.available ? evm.connect().catch(() => play('error')) : openWalletHelp('evm')), disabled: false }
      if (!sol.address) return { label: '👻 SELECT SOLANA WALLET', act: () => (sol.available ? sol.connect().catch(() => play('error')) : openWalletHelp('sol')), disabled: false }
    }
    if (amountNum <= 0) return { label: 'ENTER AMOUNT', act: () => {}, disabled: true }
    if (phase === 'quoting') return { label: 'QUOTING…', act: () => {}, disabled: true }
    if (phase === 'sending' || phase === 'tracking') return { label: 'BRIDGING…', act: () => {}, disabled: true }
    if (!quote && !solQuote) return { label: '◎ GET QUOTE', act: () => void (dir === 'sol2evm' ? doSolQuote() : doEvmQuote()), disabled: false }
    return { label: '▣ BRIDGE NOW', act: () => { setConfirmOpen(true); play('alert') }, disabled: false }
  }, [dir, sol.address, evm.address, amountNum, phase, quote, solQuote, dstChain.name, srcChain.name, sol, evm, openWalletHelp, doSolQuote, doEvmQuote])

  const flip = () => {
    setDir((d) => {
      if (d === 'sol2evm') {
        const i = SRC_CHAINS.findIndex((c) => c.id === DEST_CHAINS[dstChainIdx].id)
        setSrcChainIdx(i >= 0 ? i : 0)
        return 'evm2sol'
      }
      const i = DEST_CHAINS.findIndex((c) => c.id === SRC_CHAINS[srcChainIdx].id)
      setDstChainIdx(i >= 0 ? i : 0)
      return 'sol2evm'
    })
    setQuote(null)
    setSolQuote(null)
    setPhase('idle')
    setErr(null)
    play('open')
  }

  const usdLabel = dir === 'sol2evm' && solPrice ? '$' + (amountNum * solPrice).toFixed(2) : '$—'

  const sellBalance = dir === 'sol2evm' ? (sol.balanceSol != null ? sol.balanceSol.toFixed(4) : '–') : (evmBalance != null ? Number(evmBalance).toFixed(4) : '–')

  const sellConnected = dir === 'sol2evm' ? !!sol.address : !!evm.address
  const buyConnected = dir === 'sol2evm' ? !!evm.address : !!sol.address
  const sellConnect = () => {
    if (dir === 'sol2evm') return sol.available ? sol.connect().catch(() => play('error')) : openWalletHelp('sol')
    return evm.available ? evm.connect().catch(() => play('error')) : openWalletHelp('evm')
  }
  const sellDisconnect = () => {
    if (dir === 'sol2evm') return void sol.disconnect()
    return void evm.disconnect()
  }
  const buyConnect = () => {
    if (dir === 'sol2evm') return evm.available ? evm.connect().catch(() => play('error')) : openWalletHelp('evm')
    return sol.available ? sol.connect().catch(() => play('error')) : openWalletHelp('sol')
  }
  const buyDisconnect = () => {
    if (dir === 'sol2evm') return void evm.disconnect()
    return void sol.disconnect()
  }
  const sellAddr = dir === 'sol2evm' ? sol.address : evm.address
  const buyAddr = dir === 'sol2evm' ? evm.address : sol.address

  return (
    <div className="page" style={{ alignItems: 'center' }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <Panel title="BRIDGE.EXE — CROSS-CHAIN WIRE" end={<span className="pt-end">RELAY.NET</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
            {/* SELL */}
            <div style={{ border: '2px solid var(--line)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="t9 dim">SELL</span>
                <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <button
                    className="bevel-btn b-sm"
                    title={sellConnected ? 'disconnect' : 'connect wallet'}
                    onClick={sellConnected ? sellDisconnect : sellConnect}
                  >
                    {sellConnected
                      ? `${dir === 'sol2evm' ? '👻' : '🔷'} ${shortAddr(sellAddr!, 4)}`
                      : dir === 'sol2evm'
                        ? (sol.available ? 'CONNECT PHANTOM' : 'INSTALL PHANTOM')
                        : (evm.available ? 'CONNECT EVM WALLET' : 'INSTALL METAMASK')}
                  </button>
                  {sellConnected && (
                    <button className="bevel-btn b-sm" style={{ color: 'var(--red)' }} title="disconnect" onClick={sellDisconnect}>⏏</button>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  style={{ flex: 1, fontSize: 30, border: 'none', background: 'transparent', padding: '2px 0', color: 'var(--amber)', textShadow: 'var(--glow-amber)' }}
                />
                {dir === 'sol2evm' ? (
                  <span className="badge reward" style={{ fontSize: 9, padding: '6px 8px' }}>🌞 SOL · SOLANA</span>
                ) : (
                  <select value={srcChainIdx} onChange={(e) => setSrcChainIdx(Number(e.target.value))} style={{ fontSize: 16, padding: '6px 8px', maxWidth: 200 }}>
                    {SRC_CHAINS.map((c, i) => (
                      <option key={c.id} value={i}>{c.symbol} · {c.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <span className="faint" style={{ fontSize: 15 }}>{usdLabel}</span>
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 15 }}>
                  <span className="faint">Balance: {sellBalance}</span>
                  {['20%', '50%'].map((p) => (
                    <button key={p} className="chip-toggle" style={{ fontSize: 7, padding: '4px 6px' }} onClick={() => {
                      const b = Number(sellBalance)
                      if (isFinite(b) && b > 0) setAmount(String(Math.floor(b * (parseInt(p) / 100) * 1e4) / 1e4))
                    }}>{p}</button>
                  ))}
                  <button className="chip-toggle" style={{ fontSize: 7, padding: '4px 6px' }} onClick={() => {
                    const b = Number(sellBalance)
                    if (!(isFinite(b) && b > 0)) return
                    const send = dir === 'sol2evm' ? Math.max(0, b - SOL_FEE_RESERVE) : b
                    setAmount(String(Math.floor(send * 1e4) / 1e4))
                  }}>MAX</button>
                </span>
              </div>
            </div>

            {/* flip */}
            <div style={{ display: 'grid', placeItems: 'center', margin: '-16px 0', zIndex: 3 }}>
              <button className="bevel-btn b-sm" style={{ fontSize: 14, padding: '6px 12px', background: 'var(--panel-3)' }} onClick={flip} title="flip direction">
                ⇅
              </button>
            </div>

            {/* BUY */}
            <div style={{ border: '2px solid var(--line)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="t9 dim">BUY</span>
                <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <button
                    className="bevel-btn b-sm"
                    title={buyConnected ? 'disconnect' : 'connect wallet'}
                    onClick={buyConnected ? buyDisconnect : buyConnect}
                  >
                    {buyConnected
                      ? `${dir === 'sol2evm' ? '🔷' : '👻'} ${shortAddr(buyAddr!, 4)}`
                      : dir === 'sol2evm'
                        ? (evm.available ? 'CONNECT EVM WALLET' : 'INSTALL METAMASK')
                        : (sol.available ? 'CONNECT PHANTOM' : 'INSTALL PHANTOM')}
                  </button>
                  {buyConnected && (
                    <button className="bevel-btn b-sm" style={{ color: 'var(--red)' }} title="disconnect" onClick={buyDisconnect}>⏏</button>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  readOnly
                  placeholder="0"
                  value={dir === 'sol2evm' ? (solQuote ? Number(solQuote.outEth).toFixed(6) : '0') : (quote ? quote.outHuman.toFixed(6) : '0')}
                  style={{ flex: 1, fontSize: 30, border: 'none', background: 'transparent', padding: '2px 0', color: 'var(--green)', textShadow: 'var(--glow-green)' }}
                />
                {dir === 'sol2evm' ? (
                  <select value={dstChainIdx} onChange={(e) => setDstChainIdx(Number(e.target.value))} style={{ fontSize: 16, padding: '6px 8px', maxWidth: 200 }}>
                    {DEST_CHAINS.map((c, i) => (
                      <option key={c.id} value={i}>{c.symbol} · {c.name}</option>
                    ))}
                  </select>
                ) : (
                  <span className="badge reward" style={{ fontSize: 9, padding: '6px 8px' }}>🌞 SOL · SOLANA</span>
                )}
              </div>
              <span className="faint" style={{ fontSize: 15 }}>Balance: –</span>
            </div>

            {/* quote details */}
            {(quote || solQuote) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {dir === 'sol2evm' ? (
                  <>
                    <div className="stat-row"><span className="sk">GAS</span><span className="sv">{solQuote!.gasSol.toFixed(6)} SOL</span></div>
                    <div className="stat-row"><span className="sk">TIME</span><span className="sv">~1 MIN (RELAY FILL)</span></div>
                    <div className="stat-row"><span className="sk">RECIPIENT</span><span className="sv mono-addr">{evm.address ? shortAddr(evm.address, 6) : '—'}</span></div>
                  </>
                ) : (
                  <>
                    <div className="stat-row"><span className="sk">RATE</span><span className="sv">1 {srcChain.symbol} ≈ {(quote!.rate || 0).toFixed(6)} SOL</span></div>
                    <div className="stat-row"><span className="sk">GAS (EST)</span><span className="sv">${quote!.gasUsd.toFixed(2)}</span></div>
                    <div className="stat-row"><span className="sk">TIME</span><span className="sv">~{Math.ceil(quote!.timeEstimate / 60)} MIN</span></div>
                    <div className="stat-row"><span className="sk">RECEIVE</span><span className="sv up">≈ {quote!.outHuman.toFixed(6)} SOL</span></div>
                  </>
                )}
              </div>
            )}

            {err && (
              <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)', textShadow: 'var(--glow-red)' }}>
                ✕ {err}
              </div>
            )}

            {statusText.length > 0 && (
              <div className="telemetry" style={{ color: statusTone }}>
                {statusText.join('\n')}
              </div>
            )}
            {phase === 'tracking' && (
              <div className="blocks" style={{ textAlign: 'center' }}>
                {blocks((Date.now() / 3000) % 1, 22)}
              </div>
            )}

            {/* contextual action */}
            <button
              className="bevel-btn b-lg"
              style={{ width: '100%', ...(action.label.includes('SELECT') || action.label.includes('CONNECT') ? { background: 'linear-gradient(180deg,#4cf0fa,#05d9e8)', color: '#001416', borderColor: '#b3f7fb' } : action.label.includes('BRIDGE NOW') ? { background: 'linear-gradient(180deg,#ff5b8d,#ff2a6d)', color: '#fff' } : {}) }}
              disabled={action.disabled}
              onClick={action.act}
            >
              {action.label}
            </button>

            <div className="faint" style={{ fontSize: 14 }}>
              Powered by Relay.link · connect both wallets to bridge SOL ⇄ EVM in either direction ·
              BRIDGE NOW always opens your wallet popup for approval.
            </div>
          </div>
        </Panel>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <button className="bevel-btn b-lg b-cyan" onClick={() => nav('/')}>◀ BACK TO DESKTOP</button>
        </div>
      </div>

      {confirmOpen && quote && dir === 'evm2sol' && (
        <SystemDialog
          title="CONFIRM BRIDGE — USER APPROVAL REQUIRED"
          onClose={() => setConfirmOpen(false)}
          actions={
            <>
              <button className="bevel-btn" onClick={() => setConfirmOpen(false)}>✕ CANCEL</button>
              <button className="bevel-btn b-danger" onClick={() => void doEvm2Sol()}>✓ CONFIRM &amp; SIGN</button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="stat-row"><span className="sk">ROUTE</span><span className="sv">{srcChain.name} → SOLANA</span></div>
            <div className="stat-row"><span className="sk">YOU SEND</span><span className="sv">{amount} {srcChain.symbol}</span></div>
            <div className="stat-row"><span className="sk">YOU RECEIVE</span><span className="sv">≈ {quote.outHuman.toFixed(6)} SOL</span></div>
            <div className="faint" style={{ fontSize: 15 }}>After CONFIRM, wallet popup opens — approve there. Relay fills Phantom automatically.</div>
          </div>
        </SystemDialog>
      )}

      {celebrate && (
        <SystemDialog
          title="BRIDGE COMPLETE"
          onClose={() => setCelebrate(null)}
          actions={
            <button className="bevel-btn b-cyan" onClick={() => setCelebrate(null)}>✓ NICE</button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="stat-row"><span className="sk">STATUS</span><span className="sv up">CONGRATULATIONS — WIRE LANDED</span></div>
            <div className="stat-row"><span className="sk">ROUTE</span><span className="sv">{celebrate.route}</span></div>
            <div className="stat-row"><span className="sk">YOU SENT</span><span className="sv">{celebrate.sent}</span></div>
            <div className="stat-row"><span className="sk">YOU RECEIVED</span><span className="sv">{celebrate.received}</span></div>
            {celebrate.destTx && (
              <div className="stat-row"><span className="sk">DEST TX</span><span className="sv mono-addr">{shortAddr(celebrate.destTx, 8)}</span></div>
            )}
            <div className="faint" style={{ fontSize: 15 }}>Funds are in the recipient wallet. Check the destination chain explorer if you want the receipt.</div>
          </div>
        </SystemDialog>
      )}

      {confirmOpen && solQuote && dir === 'sol2evm' && (
        <SystemDialog
          title="CONFIRM BRIDGE — USER APPROVAL REQUIRED"
          onClose={() => setConfirmOpen(false)}
          actions={
            <>
              <button className="bevel-btn" onClick={() => setConfirmOpen(false)}>✕ CANCEL</button>
              <button className="bevel-btn b-danger" onClick={() => { setConfirmOpen(false); void doSol2Evm() }}>✓ CONFIRM &amp; SIGN IN PHANTOM</button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="stat-row"><span className="sk">ROUTE</span><span className="sv">SOLANA → {dstChain.name}</span></div>
            <div className="stat-row"><span className="sk">YOU SEND</span><span className="sv">{amount} SOL</span></div>
            <div className="stat-row"><span className="sk">YOU RECEIVE</span><span className="sv">≈ {Number(solQuote.outEth).toFixed(6)} ETH</span></div>
            <div className="stat-row"><span className="sk">RECIPIENT</span><span className="sv mono-addr">{evm.address ? shortAddr(evm.address, 8) : '—'}</span></div>
            <div className="faint" style={{ fontSize: 15 }}>After CONFIRM, Phantom opens — approve there. Relay fills {dstChain.name} automatically.</div>
          </div>
        </SystemDialog>
      )}
    </div>
  )
}
