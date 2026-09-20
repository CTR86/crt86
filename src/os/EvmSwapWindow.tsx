/* ============================================================
   EvmSwapWindow — shared CRT swap terminal for the EVM providers
   (UNISWAP.EXE / PANCAKE.EXE). Same window system, same styling,
   same UX patterns as JUP.EXE (DexWindow): SELL/BUY boxes, flip,
   slippage, quote details, telemetry, confirm + success dialogs.
   Provider-specific logic (quote / calldata / router) lives in
   src/lib/swap/* — this file only renders + orchestrates wallet.
   No mock data. Nothing submits without explicit wallet signature.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Address } from 'viem'
import { useEvmWallet } from '../wallets/EvmWallet'
import { useUi } from '../store/ui'
import { Panel } from '../design/ui'
import { SystemDialog } from '../design/SystemDialog'
import { blocks, shortAddr } from '../lib/format'
import { play } from '../sound/sfx'
import {
  addChainParams,
  evmChain,
  explorerTxUrl,
  type EvmChainDef,
} from '../lib/swap/chains'
import { findPopular, isNative, popularTokens, type EvmToken } from '../lib/swap/tokens'
import {
  ERC20_ABI,
  getAllowance,
  getEvmBalanceHuman,
  publicClient,
  readTokenMeta,
  waitForEvmReceipt,
  walletSendTx,
} from '../lib/swap/evm'
import {
  applySlippageBps,
  baseToHuman,
  formatTokenAmount,
  humanToBase,
  isEvmQuoteStale,
  isWalletRejection,
  mapEvmTxError,
  validateEvmSwapInput,
} from '../lib/swap/amount'
import type { EvmQuote, EvmSwapProvider } from '../lib/swap/types'

type Phase = 'idle' | 'quoting' | 'ready' | 'approving' | 'signing' | 'sending' | 'success' | 'error'

/** Keep native back for gas on MAX so the tx doesn't fail simulation. */
const NATIVE_FEE_RESERVE: Record<number, number> = { 56: 0.0005, 1: 0.0005, 8453: 0.0005, 42161: 0.0005 }

function TokenBadge({ token }: { token: EvmToken }) {
  return (
    <span className="token-logo" style={{ width: 30, height: 30, fontSize: 9 }} title={token.name}>
      {token.symbol.slice(0, 3)}
    </span>
  )
}

export function EvmSwapWindow({ exe, provider }: { exe: string; provider: EvmSwapProvider }) {
  const nav = useNavigate()
  const evm = useEvmWallet()
  const openWalletHelp = useUi((s) => s.openWalletHelp)

  const chains: EvmChainDef[] = useMemo(() => provider.chainIds.map((id) => evmChain(id)), [provider])
  const [chainId, setChainId] = useState<number>(provider.defaultChainId)
  const chain = evmChain(chainId)
  const chainOk = evm.chainId === chainId

  const [inputToken, setInputToken] = useState<EvmToken>(() => popularTokens(provider.defaultChainId)[0])
  const [outputToken, setOutputToken] = useState<EvmToken>(() => popularTokens(provider.defaultChainId)[1])
  const [amount, setAmount] = useState('')
  const [slippageBps, setSlippageBps] = useState<number>(provider.defaultSlippageBps)
  const [quote, setQuote] = useState<EvmQuote | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<string[]>([])
  const [txHash, setTxHash] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [successOpen, setSuccessOpen] = useState(false)
  const [tokenDialog, setTokenDialog] = useState<'in' | 'out' | null>(null)
  const [customAddr, setCustomAddr] = useState('')
  const [customErr, setCustomErr] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [balIn, setBalIn] = useState<number | null>(null)
  const [balOut, setBalOut] = useState<number | null>(null)
  const [needsApproval, setNeedsApproval] = useState(false)
  const [needsPermit, setNeedsPermit] = useState(false)
  const busy = useRef(false)

  const log = useCallback((l: string) => {
    setTelemetry((s) => [...s.slice(-24), `[${new Date().toLocaleTimeString()}] ${l}`])
  }, [])

  /* ---------- chain change resets pair to that chain's populars ---------- */
  const selectChain = useCallback(
    (id: number) => {
      setChainId(id)
      const popular = popularTokens(id)
      setInputToken(popular[0])
      setOutputToken(popular[1] ?? popular[0])
      setAmount('')
      setQuote(null)
      setPhase('idle')
      setErr(null)
      setTxHash(null)
      setNeedsApproval(false)
      setNeedsPermit(false)
      play('click')
      // Best-effort wallet switch so quotes run on the right network.
      if (evm.address && evm.chainId !== id) {
        void evm.switchEvmChain(evmChain(id).hex, addChainParams(id)).catch(() => {})
      }
    },
    [evm],
  )

  /* ---------- balances ---------- */
  const refreshBalances = useCallback(async () => {
    if (!evm.address) {
      setBalIn(null)
      setBalOut(null)
      return
    }
    const [a, b] = await Promise.all([
      getEvmBalanceHuman(chainId, evm.address as Address, inputToken),
      getEvmBalanceHuman(chainId, evm.address as Address, outputToken),
    ])
    setBalIn(a)
    setBalOut(b)
  }, [evm.address, chainId, inputToken, outputToken])

  useEffect(() => {
    void refreshBalances()
  }, [refreshBalances])

  const pickToken = (t: EvmToken) => {
    if (tokenDialog === 'in') {
      if (t.address.toLowerCase() === outputToken.address.toLowerCase()) setOutputToken(inputToken)
      setInputToken(t)
    } else if (tokenDialog === 'out') {
      if (t.address.toLowerCase() === inputToken.address.toLowerCase()) setInputToken(outputToken)
      setOutputToken(t)
    }
    setTokenDialog(null)
    setCustomAddr('')
    setCustomErr(null)
    setQuote(null)
    setPhase('idle')
    setErr(null)
    setTxHash(null)
    setNeedsApproval(false)
    setNeedsPermit(false)
    play('click')
  }

  const resolveCustom = async () => {
    const a = customAddr.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
      setCustomErr('Paste a full 0x token contract address.')
      return
    }
    if (findPopular(chainId, a)) {
      setCustomErr('That token is already in the list below — tap it.')
      return
    }
    setResolving(true)
    setCustomErr(null)
    try {
      const pc = publicClient(chainId)
      const code = await pc.getBytecode({ address: a as Address })
      if (!code || code === '0x') throw new Error('No contract at this address on ' + chain.label + ' — check the chain and address.')
      const meta = await readTokenMeta(chainId, {
        address: a as Address,
        symbol: 'TOKEN',
        name: 'Custom token',
        decimals: 18,
      })
      pickToken({ address: a as Address, symbol: meta.symbol.slice(0, 11).toUpperCase(), name: 'Custom token', decimals: meta.decimals })
    } catch (e) {
      setCustomErr(mapEvmTxError(String((e as Error).message ?? e)).slice(0, 160))
    } finally {
      setResolving(false)
    }
  }

  const flip = () => {
    setInputToken(outputToken)
    setOutputToken(inputToken)
    setQuote(null)
    setPhase('idle')
    setErr(null)
    setTxHash(null)
    setNeedsApproval(false)
    setNeedsPermit(false)
    play('open')
  }

  const amountNum = useMemo(() => (isFinite(Number(amount)) ? Number(amount) : 0), [amount])
  const inputErr = validateEvmSwapInput({
    amountHuman: amount,
    inputDecimals: inputToken.decimals,
    balanceHuman: null, // balance checked at quote time; slow RPC must never block quoting
    inputAddr: inputToken.address,
    outputAddr: outputToken.address,
    walletConnected: !!evm.address,
    chainOk: true, // chain gate is surfaced as its own action below
  })
  const balanceHint =
    balIn != null && amountNum > balIn
      ? `Insufficient balance — wallet has ${balIn.toFixed(4)} ${inputToken.symbol}.`
      : null

  /* ---------- quote ---------- */
  const doQuote = useCallback(async () => {
    if (!evm.address) return
    if (evm.chainId !== chainId) {
      const ok = await evm
        .switchEvmChain(chain.hex, addChainParams(chainId))
        .then(() => true)
        .catch(() => false)
      if (!ok) {
        setErr(`Switch your wallet to ${chain.label} to quote.`)
        setPhase('error')
        play('error')
        return
      }
    }
    const v = validateEvmSwapInput({
      amountHuman: amount,
      inputDecimals: inputToken.decimals,
      balanceHuman: balIn,
      inputAddr: inputToken.address,
      outputAddr: outputToken.address,
      walletConnected: true,
      chainOk: true,
    })
    if (v) {
      setErr(v)
      setPhase('error')
      play('error')
      return
    }
    if (busy.current) return
    busy.current = true
    setPhase('quoting')
    setErr(null)
    setTxHash(null)
    setNeedsApproval(false)
    setNeedsPermit(false)
    log(`QUOTE ${amount} ${inputToken.symbol} → ${outputToken.symbol} ON ${chain.name}…`)
    try {
      const amountIn = humanToBase(amount, inputToken.decimals)
      const q = await provider.quote({
        chainId,
        tokenIn: inputToken,
        tokenOut: outputToken,
        amountIn,
        swapper: evm.address as Address,
        slippageBps,
      })
      setQuote(q)
      setPhase('ready')
      play('coin')
      log(`BEST ${q.routeLabel} · OUT ≈ ${formatTokenAmount(q.amountOutHuman, outputToken.decimals)} ${outputToken.symbol}`)
      // Approval pre-check so the confirm screen tells the truth up front.
      if (!isNative(inputToken)) {
        if (q.api?.permitData && provider.signPermit) {
          setNeedsPermit(true)
          log('PERMIT2 SIGNATURE WILL COVER APPROVAL — GASLESS, NO APPROVE TX')
        } else {
          const spender = q.api && provider.approvalSpender ? provider.approvalSpender(chainId, q) : provider.spender(chainId)
          try {
            const allow = await getAllowance(chainId, inputToken.address, evm.address as Address, spender)
            setNeedsApproval(allow < amountIn)
            if (allow < amountIn) log('ROUTER NOT APPROVED — SWAP WILL ASK FOR 1 APPROVAL FIRST')
          } catch {
            setNeedsApproval(true)
          }
        }
      }
    } catch (e) {
      const m = String((e as Error).message ?? e)
      setErr(mapEvmTxError(m))
      setPhase('error')
      play('error')
      log('QUOTE FAILED — ' + m.slice(0, 120))
    } finally {
      busy.current = false
    }
  }, [evm, chainId, chain, amount, inputToken, outputToken, balIn, slippageBps, provider, log])

  /* ---------- swap: fresh quote → approval? → wallet sign → receipt ---------- */
  const doSwap = useCallback(async () => {
    if (!evm.address || !quote) return
    if (busy.current) return
    busy.current = true
    setConfirmOpen(false)
    setErr(null)
    try {
      let liveQuote = quote
      if (isEvmQuoteStale(quote.fetchedAt)) {
        log('QUOTE STALE — RE-QUOTING BEFORE SIGN…')
        setPhase('quoting')
        const amountIn = humanToBase(amount, inputToken.decimals)
        liveQuote = await provider.quote({
          chainId,
          tokenIn: inputToken,
          tokenOut: outputToken,
          amountIn,
          swapper: evm.address as Address,
          slippageBps,
        })
        setQuote(liveQuote)
        log(`FRESH ${liveQuote.routeLabel} · OUT ≈ ${formatTokenAmount(liveQuote.amountOutHuman, outputToken.decimals)} ${outputToken.symbol}`)
      }
      const amountIn = humanToBase(amount, inputToken.decimals)
      const amountOutMin = applySlippageBps(liveQuote.amountOut, slippageBps)
      const me = evm.address as Address

      // ERC20 inputs: gasless Permit2 signature (API quotes) or classic approval.
      if (!isNative(inputToken)) {
        if (liveQuote.api?.permitData && provider.signPermit && !liveQuote.permit) {
          setPhase('signing')
          log('REQUESTING GASLESS PERMIT SIGNATURE…')
          play('alert')
          try {
            const signature = await provider.signPermit({ permitData: liveQuote.api.permitData, account: me, ethRequest: evm.ethRequest })
            liveQuote = { ...liveQuote, permit: { permitData: liveQuote.api.permitData, signature } }
            setQuote(liveQuote)
            setNeedsPermit(false)
            log('PERMIT SIGNED — NO APPROVE TX NEEDED')
          } catch (e) {
            const m = String((e as Error).message ?? e)
            if (isWalletRejection(m)) throw new Error('You rejected the permit signature in your wallet.', { cause: e })
            // Wallet cannot sign permits — fall back to classic approval + re-quote.
            log('PERMIT SIGN UNSUPPORTED — FALLING BACK TO ON-CHAIN APPROVAL…')
            const spender = provider.approvalSpender ? provider.approvalSpender(chainId, liveQuote) : provider.spender(chainId)
            await approveSpender(spender, amountIn, me)
            liveQuote = await provider.quote({
              chainId,
              tokenIn: inputToken,
              tokenOut: outputToken,
              amountIn,
              swapper: me,
              slippageBps,
            })
            setQuote(liveQuote)
          }
        }
        if (!liveQuote.permit) {
          const spender =
            liveQuote.api && provider.approvalSpender ? provider.approvalSpender(chainId, liveQuote) : provider.spender(chainId)
          let allow = 0n
          try {
            allow = await getAllowance(chainId, inputToken.address, me, spender)
          } catch {
            allow = 0n
          }
          if (allow < amountIn) {
            await approveSpender(spender, amountIn, me)
            setNeedsApproval(false)
          }
        }
      }

      async function approveSpender(spender: Address, amount: bigint, from: Address) {
        setPhase('approving')
        log(`REQUESTING APPROVAL FOR ${inputToken.symbol}…`)
        play('alert')
        const { encodeFunctionData } = await import('viem')
        const data = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [spender, amount],
        })
        let approveHash: string
        try {
          approveHash = await walletSendTx(evm.ethRequest, { from, to: inputToken.address, data })
        } catch (e) {
          const m = String((e as Error).message ?? e)
            if (isWalletRejection(m)) throw new Error('You rejected the approval in your wallet.', { cause: e })
          throw e
        }
        log(`APPROVAL TX ${approveHash.slice(0, 18)}… WAITING…`)
        await waitForEvmReceipt(evm.ethRequest, approveHash)
        log('APPROVAL CONFIRMED')
      }

      setPhase('signing')
      log('REQUESTING WALLET SIGNATURE…')
      play('alert')
      const built = await provider.buildTx({
        chainId,
        tokenIn: inputToken,
        tokenOut: outputToken,
        amountIn,
        amountOutMin,
        recipient: me,
        quote: liveQuote,
      })
      let hash: string
      try {
        hash = await walletSendTx(evm.ethRequest, {
          from: me,
          to: built.to,
          ...(built.data ? { data: built.data } : {}),
          ...(built.value != null ? { value: built.value } : {}),
        })
      } catch (e) {
        const m = String((e as Error).message ?? e)
        if (isWalletRejection(m)) throw new Error('You rejected the request in your wallet.', { cause: e })
        throw e
      }
      setTxHash(hash)
      setPhase('sending')
      log(`TX ${hash.slice(0, 18)}… SUBMITTED — WAITING FOR CONFIRMATION…`)
      await waitForEvmReceipt(evm.ethRequest, hash)
      log(`✓ SWAP COMPLETE — ≈ ${formatTokenAmount(liveQuote.amountOutHuman, outputToken.decimals)} ${outputToken.symbol} RECEIVED`)
      setPhase('success')
      setSuccessOpen(true)
      play('win')
      void refreshBalances()
    } catch (e) {
      const m = String((e as Error).message ?? e)
      play('error')
      setErr(mapEvmTxError(m))
      setPhase(quote ? 'ready' : 'error')
      log('ERROR — ' + m.slice(0, 140))
    } finally {
      busy.current = false
    }
  }, [evm, quote, amount, inputToken, outputToken, chainId, slippageBps, provider, log, refreshBalances])

  const resetAll = () => {
    setAmount('')
    setQuote(null)
    setPhase('idle')
    setErr(null)
    setTelemetry([])
    setTxHash(null)
    setSuccessOpen(false)
    setNeedsApproval(false)
    setNeedsPermit(false)
    play('click')
  }

  /* ---------- contextual action ---------- */
  const action = useMemo(() => {
    if (!evm.address) {
      return {
        label: '🔷 CONNECT WALLET',
        act: () => (evm.available ? evm.connect().catch(() => play('error')) : openWalletHelp('evm')),
        disabled: false,
      }
    }
    if (!chainOk) {
      return {
        label: `⇄ SWITCH TO ${chain.name}`,
        act: () =>
          evm
            .switchEvmChain(chain.hex, addChainParams(chainId))
            .catch(() => play('error')),
        disabled: false,
      }
    }
    if (!amount.trim() || amountNum <= 0) return { label: 'ENTER AMOUNT', act: () => {}, disabled: true }
    if (inputErr) return { label: 'CHECK INPUT', act: () => void doQuote(), disabled: false }
    if (phase === 'quoting') return { label: 'QUOTING…', act: () => {}, disabled: true }
    if (phase === 'approving') return { label: 'APPROVING…', act: () => {}, disabled: true }
    if (phase === 'signing') return { label: 'SIGNING…', act: () => {}, disabled: true }
    if (phase === 'sending') return { label: 'SWAPPING…', act: () => {}, disabled: true }
    if (!quote) return { label: '◎ GET QUOTE', act: () => void doQuote(), disabled: false }
    return {
      label: needsPermit ? '▣ SIGN + SWAP' : needsApproval ? '▣ APPROVE + SWAP' : '▣ SWAP NOW',
      act: () => {
        setConfirmOpen(true)
        play('alert')
      },
      disabled: false,
    }
  }, [evm, chainOk, chain, chainId, amount, amountNum, inputErr, phase, quote, needsApproval, needsPermit, openWalletHelp, doQuote])

  const statusTone = phase === 'success' ? 'var(--green)' : phase === 'error' ? 'var(--red)' : 'var(--amber)'
  const staleWarn = quote ? isEvmQuoteStale(quote.fetchedAt) : false
  const minOutHuman = quote ? baseToHuman(applySlippageBps(quote.amountOut, slippageBps), outputToken.decimals) : null

  const setMax = () => {
    if (balIn == null || !isFinite(balIn) || balIn <= 0) return
    const reserve = isNative(inputToken) ? (NATIVE_FEE_RESERVE[chainId] ?? 0.0005) : 0
    const send = Math.max(0, balIn - reserve)
    const decimals = Math.min(6, inputToken.decimals)
    setAmount(String(Math.floor(send * 10 ** decimals) / 10 ** decimals))
    play('click')
  }

  return (
    <div className="page" style={{ alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: '70vh' }}>
      <div style={{ maxWidth: 720, width: '100%' }}>
        <Panel title={`${exe} — ${chain.label.toUpperCase()} SWAP`} end={<span className="pt-end">{provider.label}</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
            {/* CHAIN */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="t9 dim">CHAIN</span>
              <select value={chainId} onChange={(e) => selectChain(Number(e.target.value))} style={{ fontSize: 16, padding: '6px 8px' }}>
                {chains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.symbol} · {c.name}
                  </option>
                ))}
              </select>
              {!chainOk && evm.address && <span className="badge new" style={{ fontSize: 8 }}>WALLET ON WRONG NETWORK</span>}
            </div>

            {/* SELL */}
            <div style={{ border: '2px solid var(--line)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="t9 dim">SELL</span>
                <button
                  className="bevel-btn b-sm"
                  title={evm.address ? evm.address : 'connect wallet'}
                  onClick={() => (evm.address ? void evm.disconnect() : evm.available ? evm.connect().catch(() => play('error')) : openWalletHelp('evm'))}
                >
                  {evm.address ? `🔷 ${shortAddr(evm.address, 4)}` : evm.available ? 'CONNECT WALLET' : 'INSTALL METAMASK'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value.replace(/[^0-9.]/g, ''))
                    setQuote(null)
                    if (phase === 'ready' || phase === 'error') setPhase('idle')
                    setErr(null)
                  }}
                  style={{ flex: 1, minWidth: 0, fontSize: 'clamp(32px, 6vw, 44px)', border: 'none', background: 'transparent', padding: '2px 0', color: 'var(--amber)', textShadow: 'var(--glow-amber)' }}
                />
                <button className="bevel-btn b-sm" onClick={() => setTokenDialog('in')} title="pick input token" style={{ fontSize: 15, padding: '10px 12px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <TokenBadge token={inputToken} />
                    {inputToken.symbol} ▾
                  </span>
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <span className="faint" style={{ fontSize: 15 }}>
                  {chain.symbol} · {chain.label}
                </span>
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 15 }}>
                  <span className="faint">Balance: {balIn != null ? balIn.toFixed(4) : '–'}</span>
                  <button className="chip-toggle" style={{ fontSize: 7, padding: '4px 6px' }} onClick={setMax}>MAX</button>
                </span>
              </div>
            </div>

            {/* flip */}
            <div style={{ display: 'grid', placeItems: 'center', margin: '-16px 0', zIndex: 3 }}>
              <button className="bevel-btn b-sm" style={{ fontSize: 14, padding: '6px 12px', background: 'var(--panel-3)' }} onClick={flip} title="flip tokens">
                ⇅
              </button>
            </div>

            {/* BUY */}
            <div style={{ border: '2px solid var(--line)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="t9 dim">BUY</span>
                <span className="faint" style={{ fontSize: 14 }}>
                  Balance: {balOut != null ? balOut.toFixed(4) : '–'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  readOnly
                  placeholder="0"
                  value={quote ? formatTokenAmount(quote.amountOutHuman, outputToken.decimals) : '0'}
                  style={{ flex: 1, minWidth: 0, fontSize: 'clamp(32px, 6vw, 44px)', border: 'none', background: 'transparent', padding: '2px 0', color: 'var(--green)', textShadow: 'var(--glow-green)' }}
                />
                <button className="bevel-btn b-sm" onClick={() => setTokenDialog('out')} title="pick output token" style={{ fontSize: 15, padding: '10px 12px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <TokenBadge token={outputToken} />
                    {outputToken.symbol} ▾
                  </span>
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <span className="faint" style={{ fontSize: 15 }}>
                  {quote ? `1 ${inputToken.symbol} ≈ ${formatTokenAmount(quote.rate, 6)} ${outputToken.symbol}` : 'rate appears after quote'}
                </span>
                <label className="faint" style={{ fontSize: 14, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  SLIP
                  <select value={slippageBps} onChange={(e) => { setSlippageBps(Number(e.target.value)); setQuote(null); setPhase('idle') }} style={{ fontSize: 14, padding: '4px 6px' }}>
                    <option value={50}>0.5%</option>
                    <option value={100}>1.0%</option>
                    <option value={300}>3.0%</option>
                  </select>
                </label>
              </div>
            </div>

            {/* quote details — only real on-chain fields, never fabricated */}
            {quote && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div className="stat-row"><span className="sk">EST OUTPUT</span><span className="sv up">≈ {formatTokenAmount(quote.amountOutHuman, outputToken.decimals)} {outputToken.symbol}</span></div>
                <div className="stat-row"><span className="sk">ROUTE</span><span className="sv">{quote.routeLabel}</span></div>
                {minOutHuman != null && (
                  <div className="stat-row"><span className="sk">MIN RECEIVE</span><span className="sv">≈ {formatTokenAmount(minOutHuman, outputToken.decimals)} {outputToken.symbol}</span></div>
                )}
                {needsPermit && !isNative(inputToken) && (
                  <div className="stat-row"><span className="sk">APPROVAL</span><span className="sv">GASLESS PERMIT SIGNATURE — NO APPROVE TX</span></div>
                )}
                {needsApproval && !isNative(inputToken) && (
                  <div className="stat-row"><span className="sk">APPROVAL</span><span className="sv">REQUIRED — 1 APPROVE TX FIRST</span></div>
                )}
                {quote.api?.gasFeeUSD != null && (
                  <div className="stat-row"><span className="sk">GAS (EST)</span><span className="sv">${quote.api.gasFeeUSD.toFixed(2)}</span></div>
                )}
                <div className="stat-row"><span className="sk">STATUS</span><span className="sv" style={{ color: staleWarn ? 'var(--red)' : 'var(--green)' }}>{staleWarn ? 'STALE — RE-QUOTE BEFORE SIGN' : 'FRESH — READY TO SIGN'}</span></div>
              </div>
            )}

            {(inputErr && amount.trim() && evm.address) || balanceHint ? (
              <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                ⚠ {balanceHint ?? inputErr}
              </div>
            ) : null}

            {err && (
              <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)', textShadow: 'var(--glow-red)' }}>
                ✕ {err}
              </div>
            )}

            {telemetry.length > 0 && (
              <div className="telemetry" style={{ color: statusTone }}>
                {telemetry.join('\n')}
              </div>
            )}
            {(phase === 'quoting' || phase === 'sending' || phase === 'approving') && (
              <div className="blocks" style={{ textAlign: 'center' }}>
                {blocks((Date.now() / 3000) % 1, 22)}
              </div>
            )}
            {txHash && (
              <div className="stat-row">
                <span className="sk">LAST TX</span>
                <span className="sv"><a href={explorerTxUrl(chainId, txHash)} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>{shortAddr(txHash, 8)} ↗</a></span>
              </div>
            )}

            <button
              className="bevel-btn b-lg"
              style={{ width: '100%', fontSize: 15, padding: '14px 18px', ...(action.label.includes('CONNECT') || action.label.includes('SWITCH') ? { background: 'linear-gradient(180deg,#4cf0fa,#05d9e8)', color: '#001416', borderColor: '#b3f7fb' } : action.label.includes('SWAP') || action.label.includes('APPROVE') ? { background: 'linear-gradient(180deg,#ff5b8d,#ff2a6d)', color: '#fff' } : {}) }}
              disabled={action.disabled}
              onClick={action.act}
            >
              {action.label}
            </button>

            {quote && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="bevel-btn b-sm" onClick={() => void doQuote()}>↻ RE-QUOTE</button>
                <button className="bevel-btn b-sm" onClick={resetAll}>✕ RESET</button>
              </div>
            )}

            <div className="faint" style={{ fontSize: 14 }}>
              {provider.id === 'uniswap'
                ? 'Powered by UNISWAP Trading API (best price V2/V3/V4, simulated) · on-chain V3 fallback · SWAP NOW always opens your wallet popup first.'
                : 'Powered by PANCAKESWAP on-chain · quotes from public RPC, no API key · SWAP NOW always opens your wallet popup first.'}
              {needsApproval ? ' (approval tx, then swap tx)' : ''}
              {needsPermit ? ' (gasless signature, then swap tx)' : ''}
            </div>
          </div>
        </Panel>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <button className="bevel-btn b-lg b-cyan" onClick={() => nav('/')}>◀ BACK TO DESKTOP</button>
        </div>
      </div>

      {/* token picker */}
      {tokenDialog && (
        <SystemDialog
          title={`SELECT TOKEN — ${tokenDialog === 'in' ? 'SELL' : 'BUY'} · ${chain.name}`}
          onClose={() => { setTokenDialog(null); setCustomAddr(''); setCustomErr(null) }}
          actions={
            <button className="bevel-btn" onClick={() => { setTokenDialog(null); setCustomAddr(''); setCustomErr(null) }}>✕ CLOSE</button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 'min(420px, 80vw)' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                placeholder="PASTE CUSTOM TOKEN ADDRESS (0x…)…"
                value={customAddr}
                onChange={(e) => setCustomAddr(e.target.value)}
                style={{ width: '100%' }}
              />
              <button className="bevel-btn b-sm" onClick={() => void resolveCustom()} disabled={resolving}>
                {resolving ? '…' : 'ADD'}
              </button>
            </div>
            {customErr && <div className="faint" style={{ fontSize: 14, color: 'var(--red)' }}>{customErr}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
              {popularTokens(chainId).map((t) => (
                <button key={t.address} className="bevel-btn b-sm" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => pickToken(t)}>
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', width: '100%' }}>
                    <TokenBadge token={t} />
                    <span style={{ fontWeight: 'bold' }}>{t.symbol}</span>
                    <span className="faint" style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="faint" style={{ fontSize: 13 }}>
              Custom addresses are verified on-chain before listing — non-contracts are rejected.
            </div>
          </div>
        </SystemDialog>
      )}

      {/* confirm */}
      {confirmOpen && quote && (
        <SystemDialog
          title="CONFIRM SWAP — USER APPROVAL REQUIRED"
          onClose={() => setConfirmOpen(false)}
          actions={
            <>
              <button className="bevel-btn" onClick={() => setConfirmOpen(false)}>✕ CANCEL</button>
              <button className="bevel-btn b-danger" onClick={() => void doSwap()}>✓ CONFIRM &amp; SIGN IN WALLET</button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="stat-row"><span className="sk">CHAIN</span><span className="sv">{chain.label}</span></div>
            <div className="stat-row"><span className="sk">YOU SEND</span><span className="sv">{amount} {inputToken.symbol}</span></div>
            <div className="stat-row"><span className="sk">YOU RECEIVE</span><span className="sv">≈ {formatTokenAmount(quote.amountOutHuman, outputToken.decimals)} {outputToken.symbol}</span></div>
            <div className="stat-row"><span className="sk">MIN RECEIVE</span><span className="sv">≈ {minOutHuman != null ? formatTokenAmount(minOutHuman, outputToken.decimals) : '—'} {outputToken.symbol}</span></div>
            <div className="stat-row"><span className="sk">ROUTE</span><span className="sv">{quote.routeLabel}</span></div>
            <div className="stat-row"><span className="sk">WALLET</span><span className="sv">{evm.address ? shortAddr(evm.address, 6) : '—'}</span></div>
            {needsPermit && !isNative(inputToken) && (
              <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>Permit approval — your wallet will pop up TWICE (gasless signature, then swap).</div>
            )}
            {needsApproval && !isNative(inputToken) && (
              <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>Approval required — your wallet will pop up TWICE (approve, then swap).</div>
            )}
            {staleWarn && <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>Quote is stale — a fresh quote will be fetched automatically before signing.</div>}
            <div className="faint" style={{ fontSize: 14 }}>After CONFIRM, your wallet opens — approve there. Nothing is submitted until you sign.</div>
          </div>
        </SystemDialog>
      )}

      {/* success */}
      {successOpen && txHash && quote && (
        <SystemDialog
          title="SWAP COMPLETE"
          onClose={() => setSuccessOpen(false)}
          actions={
            <>
              <a className="bevel-btn b-sm" href={explorerTxUrl(chainId, txHash)} target="_blank" rel="noreferrer">VIEW ON EXPLORER ↗</a>
              <button className="bevel-btn b-cyan" onClick={() => { setSuccessOpen(false); resetAll() }}>✓ NICE — NEW SWAP</button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="stat-row"><span className="sk">STATUS</span><span className="sv up">CONGRATULATIONS — SWAP LANDED</span></div>
            <div className="stat-row"><span className="sk">ROUTE</span><span className="sv">{inputToken.symbol} → {outputToken.symbol} · {quote.routeLabel}</span></div>
            <div className="stat-row"><span className="sk">YOU SENT</span><span className="sv">{amount} {inputToken.symbol}</span></div>
            <div className="stat-row"><span className="sk">YOU RECEIVED</span><span className="sv">≈ {formatTokenAmount(quote.amountOutHuman, outputToken.decimals)} {outputToken.symbol}</span></div>
            <div className="stat-row"><span className="sk">TX</span><span className="sv mono-addr">{shortAddr(txHash, 8)}</span></div>
            <div className="faint" style={{ fontSize: 14 }}>Tokens are in your wallet. Balances refreshed above — verify on the explorer any time.</div>
          </div>
        </SystemDialog>
      )}
    </div>
  )
}
