import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { usePrepareLaunch, useSubmitLaunch, useLaunchStatus, usePairs } from '../hooks/stonk'
import { useDirectPoolStatus } from '../hooks/launchDirect'
import { SfError } from '../lib/stonkfun'
import { getEmberQuotes, prepareEmberLaunch, submitEmberLaunch, type EmberPrepare } from '../lib/ember'
import { getEngine } from '../lib/launch/engine'
import {
  DIRECT_FEE_LINE,
  DIRECT_QUOTE_ASSETS,
  DIRECT_TESTNET_BADGE,
  NATIVE_SOL_MINT,
  USDC_MINT,
  dbcConfigForQuote,
  devnetExplorerAccountUrl,
  devnetExplorerTxUrl,
  devnetRpcCandidates,
  isDirectConfigured,
} from '../lib/launch/config'
import {
  effectiveQuoteMint,
  graduationLabelFor,
  quoteAutoMigrationWarning,
  stage1OkDirect as stage1OkDirectFn,
  validateDirectForm,
  type DirectForm,
} from '../lib/launch/validation'
import {
  confirmSignature,
  getDevnetConnection,
  mapTxError,
  verifyLaunch,
} from '../lib/launch/transactions'
import { useSolanaWallet } from '../wallets/SolanaWallet'
import { Blocks, CopyBtn, Field, Panel, Readout, Switch, TokenLogo } from '../design/ui'
import { SystemDialog } from '../design/SystemDialog'
import { byteLen, cn, shortAddr } from '../lib/format'
import { play } from '../sound/sfx'
import { useUi } from '../store/ui'

type Stage = 1 | 2 | 3 | 4
type Engine = 'stonkfun' | 'ember' | 'direct'

const ENGINES: { id: Engine; name: string; tag: string; blurb: string; cost: string }[] = [
  {
    id: 'stonkfun',
    name: 'STONKFUN',
    tag: 'FEE COIN',
    blurb: 'Classic fee coin on the LaunchLab curve. Stock / meme / gold pairs. 2% tier routes 1.5% of every trade to you. Reward mode pays holders via transfer tax.',
    cost: 'FLAT 0.2904 SOL LAUNCH FEE',
  },
    {
      id: 'ember',
      name: 'EMBER',
      tag: 'DBC · METEORA',
      blurb: 'Meteora bonding curve paired with 150+ tokenized stocks, SOL, USDC and more. 80% of fees routed your way (or to holders). Graduate at $25K/$35K/$40K. For serious launches with capital.',
      cost: '~$4,000 OPENING LIQUIDITY REQUIRED (YOUR CAPITAL, STAYS IN POOL)',
    },
  {
    id: 'direct',
    name: 'DIRECT',
    tag: 'DBC · DIRECT',
    blurb: 'Our own Meteora DBC rail on TESTNET — no third-party markup, zero platform fee. You sign pool creation, our RPC broadcasts. SOL / USDC curves, auto-graduation to DAMM v2.',
    cost: 'LOWEST FEES IN THE INDUSTRY · ZERO PLATFORM FEE · TESTNET',
  },
]

interface FormState {
  name: string
  symbol: string
  logo: string | null
  mode: 'standard' | 'reward'
  rewardTaxBps: '100' | '300'
  feeTier: '1%' | '2%'
  website: string
  twitter: string
  telegram: string
  quoteMint: string
  devBuyMode: 'none' | 'percent' | 'sol'
  devBuyPercent: number
  devBuySol: string
  airdrop: boolean
  airdropPercent: number
  airdropTier: 'top100' | 'top500' | 'top1000' | 'top2500' | 'top5000'
}

const INITIAL: FormState = {
  name: '',
  symbol: '',
  logo: null,
  mode: 'standard',
  rewardTaxBps: '100',
  feeTier: '2%',
  website: '',
  twitter: '',
  telegram: '',
  quoteMint: '',
  devBuyMode: 'none',
  devBuyPercent: 10,
  devBuySol: '',
  airdrop: false,
  airdropPercent: 10,
  airdropTier: 'top100',
}

const EMBER_INITIAL = {
  uri: '',
  quoteMint: '',
  feeBps: 200,
  graduateUsd: 35000,
  mode: 'holders' as 'keep' | 'split' | 'holders',
  holdersBps: 5000,
  payInQuote: false,
}

const DIRECT_INITIAL: DirectForm = {
  name: '',
  symbol: '',
  uri: '',
  quoteMint: NATIVE_SOL_MINT,
  customQuoteMint: '',
  firstBuyMode: 'none',
  firstBuyAmount: '',
  slippageBps: 100,
}

function PayloadBay({ logo, onPick }: { logo: string | null; onPick: (dataUrl: string) => void }) {
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const readFile = (f: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
      alert('PAYLOAD REJECTED — logo must be PNG, JPEG or WEBP.')
      return
    }
    if (f.size > 2 * 1024 * 1024) {
      alert('PAYLOAD REJECTED — logo exceeds 2 MB.')
      return
    }
    const r = new FileReader()
    r.onload = () => onPick(String(r.result))
    r.readAsDataURL(f)
  }

  return (
    <div
      className={cn('payload-bay', drag && 'drag')}
      onClick={() => fileRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) readFile(f) }}
    >
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
      {logo ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
          <TokenLogo src={logo} symbol="◈" size={72} />
          <span className="t8 dim">PAYLOAD SECURED — CLICK TO SWAP</span>
        </div>
      ) : (
        <>
          <span className="t9 dim">▼ DROP LOGO INTO PAYLOAD BAY ▼</span>
          <span className="faint" style={{ fontSize: 15 }}>PNG · JPEG · WEBP · MAX 2 MB</span>
        </>
      )}
    </div>
  )
}

export function LaunchDeck() {
  const { address, balanceSol, balanceUnknown, available, connect, signBase64, signAnyBase64, signTx, refreshBalance } = useSolanaWallet()
  const openWalletHelp = useUi((s) => s.openWalletHelp)
  const pairs = usePairs()
  const prepare = usePrepareLaunch()
  const submit = useSubmitLaunch()

  const [engine, setEngine] = useState<Engine>('stonkfun')
  const [stage, setStage] = useState<Stage>(1)
  const [form, setForm] = useState<FormState>(INITIAL)
  const [ember, setEmber] = useState(EMBER_INITIAL)
  const [direct, setDirect] = useState<DirectForm>(DIRECT_INITIAL)
  const [pairQ, setPairQ] = useState('')
  const [countdown, setCountdown] = useState<number | null>(null)
  const [telemetry, setTelemetry] = useState<string[]>([])
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [paymentSig, setPaymentSig] = useState<string | null>(null)
  const [emberResult, setEmberResult] = useState<{ mint: string; pool: string } | null>(null)
  const [directResult, setDirectResult] = useState<{ mint: string; pool: string; config: string; signature: string } | null>(null)
  const [directBusy, setDirectBusy] = useState(false)
  const [directTxState, setDirectTxState] = useState<string>('IDLE')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const telemetryRef = useRef<HTMLDivElement>(null)

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))
  const setE = <K extends keyof typeof EMBER_INITIAL>(k: K, v: (typeof EMBER_INITIAL)[K]) => setEmber((f) => ({ ...f, [k]: v }))
  const setD = <K extends keyof DirectForm>(k: K, v: DirectForm[K]) => setDirect((f) => ({ ...f, [k]: v }))

  const prepareData = prepare.data
  const status = useLaunchStatus(stage === 4 && engine === 'stonkfun' ? paymentSig : null)
  const statusData = status.data as { status?: string; mint?: string; [k: string]: unknown } | undefined

  /* ---------- ember data ---------- */
  const quotesQ = useQuery({
    queryKey: ['ember-quotes'],
    queryFn: getEmberQuotes,
    enabled: engine === 'ember',
    staleTime: 5 * 60_000,
    refetchInterval: 120_000,
  })
  const econ = quotesQ.data?.economics
  const [emberPrep, setEmberPrep] = useState<EmberPrepare | null>(null)
  const [emberPreparing, setEmberPreparing] = useState(false)
  const [emberPrepErr, setEmberPrepErr] = useState<string | null>(null)

  const chosenPair = quotesQ.data?.quotes.find((q) => q.mint === ember.quoteMint)
  /** Ember sizes opening liquidity to ~$4,000 of the pair token (their openUsd) */
  const emberLiqUsd = emberPrep && chosenPair?.usdPrice ? emberPrep.openQuote * chosenPair.usdPrice : null

  const costSol = useMemo(() => {
    const l = prepareData?.payment?.lamports
    if (l == null) return null
    return Number(l) / 1e9
  }, [prepareData])

  const feeBreakdown = useMemo(() => {
    const fee = Number(prepareData?.payment?.feeSol ?? NaN)
    const dev = Number(prepareData?.devBuy?.sol ?? 0)
    if (isFinite(fee) && fee > 0) return `StonkFun fee ${fee.toFixed(4)} + dev buy ${dev.toFixed(4)}`
    if (costSol != null) {
      const launchPayment = Math.max(0, costSol - dev)
      return `StonkFun launch payment ${launchPayment.toFixed(4)}${dev > 0 ? ` + dev buy ${dev.toFixed(4)}` : ''} (paid to StonkFun)`
    }
    return 'payment + dev buy + airdrop fee'
  }, [prepareData, costSol])

  const pairName = pairs.data?.pairs.find((p) => p.mint === form.quoteMint)
  const emberExpirySecs = emberPrep ? Math.max(0, Math.ceil((emberPrep.expiresAt * 1000 - now) / 1000)) : 0

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  const log = (line: string) => {
    setTelemetry((t) => [...t.slice(-12), `[${new Date().toLocaleTimeString()}] ${line}`])
    requestAnimationFrame(() => telemetryRef.current?.scrollTo({ top: 1e6 }))
  }

  /* ---------- validation ---------- */
  const stage1OkSf =
    byteLen(form.name) >= 1 && byteLen(form.name) <= 32 &&
    byteLen(form.symbol) >= 1 && byteLen(form.symbol) <= 10 &&
    !!form.logo
  const stage1OkEmber =
    byteLen(form.name) >= 1 && byteLen(form.name) <= 32 &&
    byteLen(form.symbol) >= 1 && byteLen(form.symbol) <= 10 &&
    /^https?:\/\//i.test(ember.uri)
  /* DIRECT reuses the shared mission-plan name/symbol + its own metadata URI.
     Supply / decimals / curve / graduation live in the on-chain config. */
  const stage1OkDirect = stage1OkDirectFn({ name: form.name, symbol: form.symbol, uri: direct.uri })
  const stage1Ok = engine === 'stonkfun' ? stage1OkSf : engine === 'ember' ? stage1OkEmber : stage1OkDirect
  const stage2OkSf = !!form.quoteMint && (form.devBuyMode === 'none' || (form.devBuyMode === 'percent' && form.devBuyPercent > 0) || (form.devBuyMode === 'sol' && Number(form.devBuySol) > 0))
  const stage2OkEmber = !!ember.quoteMint
  const directQuote = effectiveQuoteMint(direct)
  const directValidation = validateDirectForm({ ...direct, name: form.name, symbol: form.symbol })
  const stage2OkDirect = !!directQuote && directValidation.ok
  const stage2Ok = engine === 'stonkfun' ? stage2OkSf : engine === 'ember' ? stage2OkEmber : stage2OkDirect
  const directConfigAddr = directQuote ? dbcConfigForQuote(directQuote) : ''
  const directConfigured = isDirectConfigured()
  const directWarn = directQuote ? quoteAutoMigrationWarning(directQuote) : null
  const directGradLabel = directQuote ? graduationLabelFor(directQuote) : null
  const directStatus = useDirectPoolStatus(stage === 4 && engine === 'direct' ? directResult?.pool ?? null : null)
  const directBadge = engine === 'direct' ? <span className="badge" style={{ color: 'var(--amber)' }}>{DIRECT_TESTNET_BADGE}</span> : undefined

  const prepareEmber = async () => {
    if (!address || !ember.quoteMint) return
    setEmberPreparing(true)
    setEmberPrepErr(null)
    try {
      const p = await prepareEmberLaunch({
        creatorWallet: address,
        name: form.name,
        symbol: form.symbol,
        uri: ember.uri,
        quoteMint: ember.quoteMint,
        feeBps: ember.feeBps,
        graduateUsd: ember.graduateUsd,
        mode: ember.mode,
        ...(ember.mode === 'holders' ? { holdersBps: ember.holdersBps } : {}),
        payInQuote: ember.payInQuote,
      })
      setEmberPrep(p)
      log(`FUEL QUOTED — open liquidity ${p.openQuote.toFixed(4)} ${chosenPair?.ticker ?? ''}${emberLiqUsd != null ? ` ≈ $${emberLiqUsd.toFixed(2)}` : ''} · valid ${Math.max(0, Math.ceil((p.expiresAt * 1000 - Date.now()) / 1000))}s`)
      void refreshBalance()
    } catch (e) {
      setEmberPrep(null)
      const msg = String((e as Error).message ?? e)
      log(`PREPARE FAILED: ${msg}`)
      setEmberPrepErr(msg)
    } finally {
      setEmberPreparing(false)
    }
  }

  /* ---------- stonkfun flow ---------- */
  const doPrepare = async () => {
    if (!address) return
    setLaunchError(null)
    prepare.mutate(
      {
        creatorWallet: address,
        quoteMint: form.quoteMint,
        name: form.name,
        symbol: form.symbol,
        logo: form.logo!,
        mode: form.mode,
        ...(form.mode === 'reward' ? { rewardTaxBps: form.rewardTaxBps } : { feeTier: form.feeTier }),
        ...(form.website ? { website: form.website } : {}),
        ...(form.twitter ? { twitter: form.twitter } : {}),
        ...(form.telegram ? { telegram: form.telegram } : {}),
        ...(form.devBuyMode === 'percent' ? { devBuyPercent: String(form.devBuyPercent) } : {}),
        ...(form.devBuyMode === 'sol' ? { devBuySol: form.devBuySol } : {}),
        ...(form.mode === 'reward' && form.airdrop ? { airdropPercent: String(form.airdropPercent), airdropTier: form.airdropTier } : {}),
      },
      {
        onSuccess: () => {
          play('click')
          log('FUEL QUOTED — payment transaction received from StonkFun wire.')
          void refreshBalance()
        },
        onError: (e) => {
          play('error')
          log(`PREPARE FAILED: ${e.message}`)
        },
      },
    )
  }

  const doStonkfunLaunch = async () => {
    if (!address || !prepareData?.paymentTransaction || !prepareData?.signedQuote) return
    setLaunchError(null)
    try {
      for (const n of [3, 2, 1]) {
        setCountdown(n)
        play('alert')
        await new Promise((r) => setTimeout(r, 750))
      }
      setCountdown(null)
      play('launch')
      log('IGNITION — requesting wallet signature on payment transaction…')
      const { signedB64, signature } = await signBase64(prepareData.paymentTransaction)
      log(`PAYMENT SIGNED ${signature ? shortAddr(signature, 6) : ''} — transmitting to launch control…`)
      setStage(4)
      const res = await submit.mutateAsync({ signedQuote: prepareData.signedQuote, signedTransaction: signedB64, logo: form.logo! })
      const sig = res?.paymentSignature ?? signature
      setPaymentSig(sig)
      log(`SUBMITTED — bundle accepted. Polling launch status (${shortAddr(sig, 6)})…`)
      void refreshBalance()
    } catch (e) {
      play('error')
      const msg = e instanceof SfError ? `${e.code}: ${e.message}` : String((e as Error).message ?? e)
      log(`LAUNCH ABORT — ${msg}`)
      setLaunchError(msg)
      setStage(3)
    }
  }

  /* ---------- ember flow ---------- */
  const doEmberLaunch = async () => {
    if (!address || !emberPrep) return
    setLaunchError(null)
    try {
      for (const n of [3, 2, 1]) {
        setCountdown(n)
        play('alert')
        await new Promise((r) => setTimeout(r, 750))
      }
      setCountdown(null)
      play('launch')
      const txs = emberPrep.transactions?.length ? emberPrep.transactions : [{ versioned: false, transaction: emberPrep.transaction }]
      log(`${txs.length} transaction(s) — signing in order…`)
      let lastSig = ''
      for (let i = 0; i < txs.length; i++) {
        const { signedB64, signature } = await signAnyBase64(txs[i].transaction, txs[i].versioned)
        lastSig = signature || lastSig
        log(`TX ${i + 1}/${txs.length} SIGNED — registering with Ember…`)
        await submitEmberLaunch(emberPrep.launchId, signedB64)
        log(`TX ${i + 1}/${txs.length} ACCEPTED by launch control.`)
      }
      setStage(4)
      setEmberResult({ mint: emberPrep.mint, pool: emberPrep.pool })
      play('coin')
      log(`LIFTOFF COMPLETE — mint ${shortAddr(emberPrep.mint, 6)} · pool ${shortAddr(emberPrep.pool, 6)}${lastSig ? ` · sig ${shortAddr(lastSig, 6)}` : ''}`)
      void refreshBalance()
    } catch (e) {
      play('error')
      const msg = String((e as Error).message ?? e)
      log(`LAUNCH ABORT — ${msg}`)
      setLaunchError(msg)
    }
  }

  /* ---------- direct (Meteora DBC, TESTNET/devnet) flow ----------
     Pool creation is wallet-signed, our devnet RPC broadcasts. SUCCESS only
     after on-chain confirmation + mint/pool verification. */
  const doDirectLaunch = async () => {
    if (!address || directBusy) return
    const v = validateDirectForm({ ...direct, name: form.name, symbol: form.symbol })
    if (!v.ok) {
      setLaunchError(`Invalid launch config: ${Object.values(v.errors).join(' ')}`)
      return
    }
    setLaunchError(null)
    setDirectBusy(true)
    setDirectTxState('LOADING')
    try {
      for (const n of [3, 2, 1]) {
        setCountdown(n)
        play('alert')
        await new Promise((r) => setTimeout(r, 750))
      }
      setCountdown(null)
      play('launch')

      const quoteMint = effectiveQuoteMint(direct)
      const { Keypair, PublicKey } = await import('@solana/web3.js')
      const baseMintKp = Keypair.generate()
      const connection = getDevnetConnection()
      const engineImpl = getEngine('meteora-dbc')

      setDirectTxState('LOADING')
      log(`BUILDING POOL TX (DEVNET) — mint ${shortAddr(baseMintKp.publicKey.toBase58(), 6)} · quote ${shortAddr(quoteMint, 4)}…`)
      const firstBuy = direct.firstBuyMode === 'quote' ? Number(direct.firstBuyAmount) : 0
      const { tx, pool, config } = await engineImpl.buildCreatePoolTx(
        connection,
        {
          name: form.name,
          symbol: form.symbol,
          uri: direct.uri,
          quoteMint,
          payer: address,
          ...(firstBuy > 0 ? { firstBuyQuoteAmount: firstBuy } : {}),
          slippageBps: direct.slippageBps,
        },
        baseMintKp.publicKey,
      )
      log(`POOL ${shortAddr(pool.toBase58(), 6)} · CONFIG ${shortAddr(config.toBase58(), 6)} — simulating…`)
      tx.feePayer = new PublicKey(address)
      const { blockhash } = await connection.getLatestBlockhash('confirmed')
      tx.recentBlockhash = blockhash
      tx.partialSign(baseMintKp)
      const sim = await connection.simulateTransaction(tx)
      if (sim.value.err) throw new Error(`Simulation failed: ${JSON.stringify(sim.value.err).slice(0, 280)}`)
      log('SIMULATION OK — requesting wallet signature…')

      setDirectTxState('AWAITING_WALLET')
      setDirectTxState('SIGNING')
      const signed = await signTx(tx)
      setDirectTxState('SUBMITTING')
      const raw = signed.serialize()
      log(`SIGNED — broadcasting via devnet RPC (${devnetRpcCandidates()[0].split('?')[0]})…`)
      const signature = await connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed' })
      log(`SUBMITTED ${shortAddr(signature, 6)} — confirming…`)
      setDirectTxState('CONFIRMING')
      const outcome = await confirmSignature(connection, signature)
      if (!outcome.confirmed) throw new Error('Transaction confirmed with error — check the explorer link.')
      log('CONFIRMED — verifying mint + pool accounts…')
      const check = await verifyLaunch(connection, { signature, baseMint: baseMintKp.publicKey, pool })
      if (!check.mintOk) throw new Error('Mint account not found after confirmation — retry polling (do NOT re-pay).')
      if (!check.poolOk) throw new Error('Pool account not found after confirmation — retry polling (do NOT re-pay).')

      setDirectTxState('SUCCESS')
      setDirectResult({
        mint: baseMintKp.publicKey.toBase58(),
        pool: pool.toBase58(),
        config: config.toBase58(),
        signature,
      })
      setStage(4)
      play('coin')
      log(`LIFTOFF COMPLETE — mint ${shortAddr(baseMintKp.publicKey.toBase58(), 6)} · pool ${shortAddr(pool.toBase58(), 6)} · sig ${shortAddr(signature, 6)}`)
      void refreshBalance()
    } catch (e) {
      play('error')
      const mapped = mapTxError(e)
      log(`LAUNCH ABORT — ${mapped.message}`)
      setLaunchError(mapped.message)
      setDirectTxState('ERROR')
    } finally {
      setDirectBusy(false)
      setCountdown(null)
    }
  }

  const completed = engine === 'stonkfun' && (statusData?.status ?? '').toLowerCase() === 'completed'
  const mintOut =
    engine === 'ember'
      ? emberResult?.mint
      : engine === 'direct'
        ? directResult?.mint
        : (statusData?.mint as string | undefined) ?? ((statusData?.launch as { mint?: string } | undefined)?.mint)

  const filteredPairs = (pairs.data?.pairs ?? []).filter((p) => {
    const q = pairQ.trim().toLowerCase()
    return !q || p.symbol.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
  })
  const emberPairs = (quotesQ.data?.quotes ?? []).filter((q) => {
    const s = pairQ.trim().toLowerCase()
    return !s || q.ticker.toLowerCase().includes(s) || q.name.toLowerCase().includes(s)
  })

  const insufficient = engine === 'stonkfun' && costSol != null && balanceSol != null && balanceSol < costSol

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">◤ LAUNCH DECK</h1>
        <span className="page-sub">SOLANA · MULTI-ENGINE · YOU SIGN, THE PLATFORM BROADCASTS</span>
      </div>

      {/* ---------- engine selector ---------- */}
      <div className="grid-2" style={{ gap: 10 }}>
        {ENGINES.filter((e) => e.id !== 'direct').map((e) => (
          <button
            key={e.id}
            className="token-card"
            style={engine === e.id ? { borderColor: 'var(--pink)', boxShadow: 'var(--glow-pink)' } : {}}
            onClick={() => {
              if (engine === e.id) return
              setEngine(e.id)
              setStage(1)
              setEmberPrep(null)
              setEmberResult(null)
              setDirectResult(null)
              setDirectTxState('IDLE')
              setPaymentSig(null)
              setLaunchError(null)
              setTelemetry([])
              play('coin')
            }}
          >
            <div className="tc-head">
              <span className="badge" style={{ color: e.id === 'ember' ? 'var(--cyan)' : 'var(--pink)' }}>{e.tag}</span>
              <span className="tc-sym" style={{ fontSize: 13 }}>{e.name}</span>
              {e.id === 'direct' && <span className="badge" style={{ color: 'var(--amber)' }}>{DIRECT_TESTNET_BADGE}</span>}
              {engine === e.id && <span className="badge grad">SELECTED</span>}
            </div>
            <div className="dim" style={{ fontSize: 16, lineHeight: 1.3 }}>{e.blurb}</div>
            <div className="t8" style={{ color: e.id === 'ember' ? 'var(--cyan)' : 'var(--amber)' }}>{e.cost}</div>
          </button>
        ))}
        {/* PLANNED: own Meteora DBC rail for mainnet ($0.5 flat). On mainnet
            go-live (after DIRECT testnet trials), drop the DIRECT testnet entry
            and wire this card to the live engine. */}
        <button
          className="token-card"
          disabled
          title="Coming soon — mainnet launch after testnet trials complete"
          style={{ opacity: 0.75, cursor: 'not-allowed' }}
        >
          <div className="tc-head">
            <span className="badge" style={{ color: 'var(--cyan)' }}>DBC · MAINNET</span>
            <span className="tc-sym" style={{ fontSize: 13 }}>METEORA</span>
            <span className="badge" style={{ color: 'var(--amber)' }}>COMING SOON</span>
          </div>
          <div className="dim" style={{ fontSize: 16, lineHeight: 1.3 }}>Our own Meteora DBC rail for mainnet — no third-party markup. Bonding curve with auto-graduation to DAMM v2 via keepers.</div>
          <div className="t8" style={{ color: 'var(--amber)' }}>LOWEST FEES · $0.5 FLAT CHARGE · COMING SOON</div>
        </button>
      </div>

      <div className="wizard-steps">
        {([1, 2, 3, 4] as Stage[]).map((s) => {
          const labels = { 1: '1·MISSION PLAN', 2: engine === 'stonkfun' ? '2·FUEL & PAYLOAD' : '2·PAIR & ECONOMICS', 3: '3·IGNITION', 4: '4·LIFTOFF' }
          const cls = s < stage ? 'done' : s === stage ? 'now' : ''
          return (
            <span key={s} className={cn('wstep', cls)}>
              {s < stage ? '✓ ' : s === stage ? '⚒️ ' : ''}{labels[s]}
              {s === stage ? ' ◂ IN PROGRESS' : ''}
            </span>
          )
        })}
      </div>

      {/* ---------------- stage 1 ---------------- */}
      {stage === 1 && (
        <Panel title={`MISSION PLAN — ${engine === 'stonkfun' ? 'STONKFUN FEE COIN' : engine === 'ember' ? 'EMBER DBC COIN' : 'DIRECT DBC COIN'}`} end={directBadge}>
          <div className="grid-2">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="COIN NAME" hint={`${byteLen(form.name)}/32 bytes`}>
                <input value={form.name} maxLength={40} onChange={(e) => set('name', e.target.value)} placeholder="NEON DREAMS" />
              </Field>
              <Field label="TICKER SYMBOL" hint={`${byteLen(form.symbol)}/10 bytes`}>
                <input value={form.symbol} maxLength={12} onChange={(e) => set('symbol', e.target.value.toUpperCase())} placeholder="NDRM" style={{ textTransform: 'uppercase' }} />
              </Field>
              {engine === 'stonkfun' && (
                <>
                  <Field label="MODE" hint={form.mode === 'standard' ? 'Fee coin: classic SPL mint, pool fees split with creator (0.5%/1.5% creator cut).' : 'Reward coin: Token-2022 transfer tax pays holders on every transfer. No creator fee position.'}>
                    <div className="tab-row">
                      <button className={cn('tab', form.mode === 'standard' && 'active')} onClick={() => set('mode', 'standard')}>STANDARD</button>
                      <button className={cn('tab', form.mode === 'reward' && 'active')} onClick={() => set('mode', 'reward')} style={form.mode === 'reward' ? { background: '#ff7ae0', borderColor: '#ff7ae0', color: '#2a0022' } : {}}>
                        REWARD
                      </button>
                    </div>
                  </Field>
                  {form.mode === 'standard' ? (
                    <Field label="FEE TIER" hint='"2%" routes 1.5% of every trade to you, the platform keeps 0.5%.'>
                      <div className="tab-row">
                        {(['1%', '2%'] as const).map((t) => (
                          <button key={t} className={cn('tab', form.feeTier === t && 'active')} onClick={() => set('feeTier', t)}>{t}</button>
                        ))}
                      </div>
                    </Field>
                  ) : (
                    <Field label="REWARD TAX" hint='Transfer tax paid to holders. "3%" triples the reward stream but adds trading friction.'>
                      <div className="tab-row">
                        {([['100', '1% TAX'], ['300', '3% TAX']] as const).map(([v, l]) => (
                          <button key={v} className={cn('tab', form.rewardTaxBps === v && 'active')} onClick={() => set('rewardTaxBps', v)}>{l}</button>
                        ))}
                      </div>
                    </Field>
                  )}
                  <Field label="LINKS (OPTIONAL)">
                    <input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://website" />
                    <input value={form.twitter} onChange={(e) => set('twitter', e.target.value)} placeholder="https://x.com/…" />
                    <input value={form.telegram} onChange={(e) => set('telegram', e.target.value)} placeholder="https://t.me/…" />
                  </Field>
                </>
              )}
              {engine === 'ember' && (
                <Field label="HOLDER FEE SHARE (PREVIEW)" hint={econ ? `Ember routes ${econ.creatorFeePct}% of pool fees to you (or to holders). Final amounts show at IGNITION.` : 'loading Ember economics…'}>
                  <div className="tab-row">
                    {(econ?.feeModes ?? [{ bps: 200, label: '2% tax', default: true }]).map((m) => (
                      <button key={m.bps} className={cn('tab', ember.feeBps === m.bps && 'active')} onClick={() => setE('feeBps', m.bps)}>{m.label}</button>
                    ))}
                  </div>
                </Field>
              )}
              {engine === 'direct' && (
                <Field label="CURVE & GRADUATION" hint="Supply, decimals, fee schedule and graduation threshold are fixed by the on-chain pool config — not per-launch. SOL auto-graduates at 10 SOL, USDC at 750 USDC into a DAMM v2 pool via Meteora keepers.">
                  <div className="t9" style={{ color: 'var(--cyan)' }}>{DIRECT_FEE_LINE} · TESTNET</div>
                </Field>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {engine === 'stonkfun' ? (
                <Field label="LOGO PAYLOAD">
                  <PayloadBay logo={form.logo} onPick={(d) => set('logo', d)} />
                </Field>
              ) : engine === 'ember' ? (
                <Field label="METADATA URI" hint="Ember stores metadata by URI — host your JSON (name, symbol, image) anywhere public: IPFS (Pinata/web3.storage), a GitHub raw gist, your own server. Must start with http(s)://">
                  <input value={ember.uri} onChange={(e) => setE('uri', e.target.value)} placeholder="https://ipfs.io/ipfs/…/metadata.json" />
                </Field>
              ) : (
                <Field label="METADATA URI" hint="Direct DBC stores metadata by URI on-chain (Metaplex). Host your JSON (name, symbol, image) on IPFS / Arweave / public HTTPS. Supply, decimals, curve and graduation live in the pool config — shown at IGNITION.">
                  <input value={direct.uri} onChange={(e) => setD('uri', e.target.value)} placeholder="https://arweave.net/…/metadata.json" />
                </Field>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {!address ? (
                  <button className="bevel-btn b-cyan" onClick={() => (available ? connect().catch(() => play('error')) : openWalletHelp('sol'))}>
                    {available ? '► CONNECT CREATOR WALLET' : '⬇ INSTALL SOL WALLET'}
                  </button>
                ) : (
                  <span className="dim">CREATOR: <span style={{ color: 'var(--green)' }}>{shortAddr(address, 6)}</span></span>
                )}
              </div>
              <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="bevel-btn b-lg b-pink"
                  disabled={!stage1Ok || !address}
                  onClick={() => { setStage(2); play('click') }}
                  title={!stage1Ok ? (engine === 'stonkfun' ? 'name, symbol and logo required' : 'name, symbol and metadata URI required') : ''}
                >
                  NEXT: {engine === 'stonkfun' ? 'FUEL' : 'PAIR & ECONOMICS'} ►
                </button>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {/* ---------------- stage 2 ---------------- */}
      {stage === 2 && engine === 'stonkfun' && (
        <Panel title="FUEL & PAYLOAD — PAIRING, DEV BUY, AIRDROP">
          <div className="grid-2">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="QUOTE PAIR" hint={pairName ? `${pairName.name} (${pairName.categoryLabel ?? pairName.category ?? 'quote'}) · ${pairName.decimals} decimals` : 'What your coin launches against.'}>
                <input placeholder="SEARCH PAIRS…" value={pairQ} onChange={(e) => setPairQ(e.target.value)} />
                <div style={{ maxHeight: 210, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4, border: '2px solid var(--line-soft)', padding: 6, background: 'var(--inset)' }}>
                  {filteredPairs.map((p) => (
                    <button
                      key={p.mint}
                      className={cn('tab', form.quoteMint === p.mint && 'active')}
                      style={{ justifyContent: 'flex-start', display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left' }}
                      onClick={() => { set('quoteMint', p.mint); play('click') }}
                    >
                      <TokenLogo src={p.logoUrl} symbol={p.symbol.slice(0, 3)} size={22} />
                      <b>{p.symbol}</b>
                      <span className="faint" style={{ fontSize: 14 }}>{p.name}</span>
                    </button>
                  ))}
                  {pairs.isLoading && <div className="state-note">LOADING PAIRS…</div>}
                </div>
              </Field>

              <Field label="DEV BUY (OPTIONAL)" hint="Executed as the pool's literal first trade, Jito-bundled — cannot be front-run. Max 50% of supply.">
                <div className="tab-row">
                  {([['none', 'NO DEV BUY'], ['percent', '% OF SUPPLY'], ['sol', 'SOL AMOUNT']] as const).map(([v, l]) => (
                    <button key={v} className={cn('tab', form.devBuyMode === v && 'active')} onClick={() => set('devBuyMode', v)}>{l}</button>
                  ))}
                </div>
                {form.devBuyMode === 'percent' && (
                  <div>
                    <input type="range" min={1} max={50} value={form.devBuyPercent} onChange={(e) => set('devBuyPercent', Number(e.target.value))} style={{ width: '100%' }} />
                    <div className="t9" style={{ color: 'var(--amber)' }}>DEV BUY {form.devBuyPercent}% OF SUPPLY</div>
                  </div>
                )}
                {form.devBuyMode === 'sol' && (
                  <input inputMode="decimal" value={form.devBuySol} onChange={(e) => set('devBuySol', e.target.value.replace(/[^0-9.]/g, ''))} placeholder="SOL AMOUNT, e.g. 0.5" />
                )}
              </Field>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {form.mode === 'reward' && (
                <Field label="AIRDROP MODE (OPTIONAL)" hint="Holds supply out of the pool and drops it to holders of the quote token. Recipient set is frozen and hashed into the signed quote at prepare.">
                  <Switch checked={form.airdrop} onChange={(v) => set('airdrop', v)} label={`AIRDROP ${form.airdropPercent}% OF SUPPLY`} />
                  {form.airdrop && (
                    <>
                      <input type="range" min={1} max={50} value={form.airdropPercent} onChange={(e) => set('airdropPercent', Number(e.target.value))} style={{ width: '100%' }} />
                      <select value={form.airdropTier} onChange={(e) => set('airdropTier', e.target.value as FormState['airdropTier'])}>
                        {(['top100', 'top500', 'top1000', 'top2500', 'top5000'] as const).map((t) => (
                          <option key={t} value={t}>{t.toUpperCase()} HOLDERS</option>
                        ))}
                      </select>
                    </>
                  )}
                </Field>
              )}
              <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between' }}>
                <button className="bevel-btn" onClick={() => { setStage(1); play('click') }}>◄ BACK</button>
                <button className="bevel-btn b-lg b-pink" disabled={!stage2Ok} onClick={() => { setStage(3); void doPrepare() }}>
                  REQUEST FUEL QUOTE ►
                </button>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {stage === 2 && engine === 'ember' && (
        <Panel title="PAIR & ECONOMICS — EMBER DBC">
          <div className="grid-2">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {engine === 'ember' && (
                <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                  ⚠ EMBER MEANS CAPITAL — the creator supplies ~$4,000 worth of the chosen pair as opening
                  liquidity (e.g. TTWO pair ≈ 18.5 TTWO ≈ $4,038 at ~$218/token; priced live per pair). It stays
                  in the pool backing your curve and earns your fee share — it is not a burn, but you need it UPFRONT.
                </div>
              )}
              <Field label="QUOTE PAIR" hint={chosenPair ? `${chosenPair.name} · ${chosenPair.decimals} decimals — you supply the opening liquidity in this token, so cheap pairs (SOL / USDC) keep costs low.` : 'Pick what your curve is priced in. Stock pairs need you to hold that stock for opening liquidity!'}>
                <input placeholder="SEARCH PAIRS (TRY SOL OR USDC)…" value={pairQ} onChange={(e) => setPairQ(e.target.value)} />
                <div style={{ maxHeight: 230, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4, border: '2px solid var(--line-soft)', padding: 6, background: 'var(--inset)' }}>
                  {emberPairs.map((p) => (
                    <button
                      key={p.mint}
                      className={cn('tab', ember.quoteMint === p.mint && 'active')}
                      style={{ justifyContent: 'flex-start', display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left' }}
                      onClick={() => { setE('quoteMint', p.mint); setEmberPrep(null); play('click') }}
                    >
                      <b>{p.ticker}</b>
                      <span className="faint" style={{ fontSize: 14 }}>{p.name}</span>
                    </button>
                  ))}
                  {quotesQ.isLoading && <div className="state-note">LOADING EMBER PAIRS…</div>}
                  {!quotesQ.isLoading && quotesQ.error && (
                    <div className="state-note">
                      <span className="big" style={{ color: 'var(--red)' }}>PAIR WIRE DOWN</span>
                      {String((quotesQ.error as Error).message ?? quotesQ.error)}
                      <div><button className="bevel-btn b-sm" onClick={() => quotesQ.refetch()}>RETRY</button></div>
                    </div>
                  )}
                  {!quotesQ.isLoading && !quotesQ.error && (quotesQ.data?.quotes.length ?? 0) === 0 && (
                    <div className="state-note">NO PAIRS RETURNED</div>
                  )}
                </div>
              </Field>
              <Field label="GRADUATION TARGET" hint="Coin graduates to a DAMM pool when market cap reaches this.">
                <div className="tab-row">
                  {(econ?.graduateOptions ?? [25000, 35000, 40000]).map((g) => (
                    <button key={g} className={cn('tab', ember.graduateUsd === g && 'active')} onClick={() => { setE('graduateUsd', g); setEmberPrep(null) }}>${(g / 1000).toFixed(0)}K</button>
                  ))}
                </div>
              </Field>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="FEE ROUTING — YOUR 80% GOES TO" hint={econ ? `Ember sends ${econ.creatorFeePct}% of pool fees to you. Choose where they land.` : 'Ember economics offline — using defaults (2% tax, 80% share).'}>
                <div className="tab-row">
                  {([['keep', 'KEEP IT'], ['split', 'SPLIT'], ['holders', 'HOLDERS']] as const).map(([v, l]) => (
                    <button key={v} className={cn('tab', ember.mode === v && 'active')} onClick={() => { setE('mode', v); setEmberPrep(null) }}>{l}</button>
                  ))}
                </div>
              </Field>
              {ember.mode === 'holders' && (
                <Field label="HOLDERS SHARE" hint={`${(ember.holdersBps / 100).toFixed(0)}% of your 80% goes to holders by balance, the rest to you.`}>
                  <input type="range" min={0} max={10000} step={500} value={ember.holdersBps} onChange={(e) => { setE('holdersBps', Number(e.target.value)); setEmberPrep(null) }} style={{ width: '100%' }} />
                  <div className="t9" style={{ color: 'var(--amber)' }}>{(ember.holdersBps / 100).toFixed(0)}% HOLDERS · {(100 - ember.holdersBps / 100).toFixed(0)}% YOU</div>
                </Field>
              )}
              <Switch checked={ember.payInQuote} onChange={(v) => { setE('payInQuote', v); setEmberPrep(null) }} label="ADVANCED: PAY IN QUOTE TOKEN" />
              <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between' }}>
                <button className="bevel-btn" onClick={() => { setStage(1); play('click') }}>◄ BACK</button>
                <button className="bevel-btn b-lg b-pink" disabled={!stage2Ok} onClick={() => { setStage(3); void prepareEmber() }}>
                  REQUEST FUEL QUOTE ►
                </button>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {stage === 2 && engine === 'direct' && (
        <Panel title="PAIR & ECONOMICS — DIRECT DBC" end={<span className="badge" style={{ color: 'var(--amber)' }}>{DIRECT_TESTNET_BADGE}</span>}>
          <div className="grid-2">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                ◈ TESTNET — DIRECT launches run on Solana devnet while testing. StonkFun and Ember stay on mainnet.
              </div>
              {!directConfigured && (
                <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
                  ✕ DIRECT ENGINE NOT CONFIGURED — set VITE_METEORA_DBC_CONFIG_SOL / VITE_METEORA_DBC_CONFIG_USDC
                  to an existing DBC pool-config address (see .env.example). No pool is created until configured.
                </div>
              )}
              <Field label="QUOTE PAIR" hint="SOL auto-graduates at 10 SOL, USDC at 750 USDC into DAMM v2 via Meteora keepers. Custom SPL quotes are protocol-possible but need manual migration.">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '2px solid var(--line-soft)', padding: 6, background: 'var(--inset)' }}>
                  {DIRECT_QUOTE_ASSETS.map((q) => (
                    <button
                      key={q.mint}
                      className={cn('tab', direct.quoteMint === q.mint && 'active')}
                      style={{ justifyContent: 'flex-start', display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left' }}
                      onClick={() => { setD('quoteMint', q.mint); play('click') }}
                    >
                      <b>{q.ticker}</b>
                      <span className="faint" style={{ fontSize: 14 }}>{q.name} · graduates {graduationLabelFor(q.mint)}</span>
                    </button>
                  ))}
                  <button
                    className={cn('tab', direct.quoteMint === 'CUSTOM' && 'active')}
                    style={{ justifyContent: 'flex-start', display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left' }}
                    onClick={() => { setD('quoteMint', 'CUSTOM'); play('click') }}
                  >
                    <b>CUSTOM</b>
                    <span className="faint" style={{ fontSize: 14 }}>SPL mint · manual migration likely</span>
                  </button>
                </div>
              </Field>
              {direct.quoteMint === 'CUSTOM' && (
                <Field label="CUSTOM QUOTE MINT" hint="Any SPL mint works at the protocol level — keepers only auto-migrate listed quotes.">
                  <input value={direct.customQuoteMint} onChange={(e) => setD('customQuoteMint', e.target.value.trim())} placeholder="SPL mint address…" />
                </Field>
              )}
              {directWarn && (
                <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                  ⚠ {directWarn}
                </div>
              )}
              <Field label="GRADUATION TARGET" hint="Fixed by the on-chain pool config — displayed, not editable per launch.">
                <div className="t9" style={{ color: 'var(--cyan)' }}>
                  {directGradLabel ? `AUTO-GRADUATES AT ${directGradLabel} → DAMM V2` : 'CUSTOM QUOTE — MANUAL MIGRATION MAY APPLY'}
                </div>
                <div className="faint" style={{ fontSize: 15 }}>CONFIG {directConfigAddr ? shortAddr(directConfigAddr, 8) : 'NOT SET'}</div>
              </Field>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label="FIRST BUY (OPTIONAL)" hint="Same-transaction initial buy bundled with pool creation. Denominated in quote units.">
                <div className="tab-row">
                  {([['none', 'NO FIRST BUY'], ['quote', 'QUOTE AMOUNT']] as const).map(([v, l]) => (
                    <button key={v} className={cn('tab', direct.firstBuyMode === v && 'active')} onClick={() => setD('firstBuyMode', v)}>{l}</button>
                  ))}
                </div>
                {direct.firstBuyMode === 'quote' && (
                  <input inputMode="decimal" value={direct.firstBuyAmount} onChange={(e) => setD('firstBuyAmount', e.target.value.replace(/[^0-9.]/g, ''))} placeholder={direct.quoteMint === USDC_MINT ? 'USDC amount, e.g. 10' : 'SOL amount, e.g. 0.5'} />
                )}
              </Field>
              <Field label="SLIPPAGE (BPS)" hint="Applied to the first-buy leg. 100 = 1%.">
                <input inputMode="numeric" value={String(direct.slippageBps)} onChange={(e) => setD('slippageBps', Number(e.target.value.replace(/[^0-9]/g, '') || '0'))} placeholder="100" />
              </Field>
              {directValidation.ok === false && (
                <div className="faint" style={{ fontSize: 15, color: 'var(--red)' }}>
                  {Object.values(directValidation.errors).join(' ')}
                </div>
              )}
              <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between' }}>
                <button className="bevel-btn" onClick={() => { setStage(1); play('click') }}>◄ BACK</button>
                <button className="bevel-btn b-lg b-pink" disabled={!stage2OkDirect} onClick={() => { setStage(3); play('click') }}>
                  REVIEW IGNITION ►
                </button>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {/* ---------------- stage 3 ---------------- */}
      {stage === 3 && (
        <Panel title="IGNITION — FINAL CHECK" end={directBadge}>
          <div className="grid-2">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="checklist-row"><span>{stage1Ok ? '☑' : '☐'}</span> PAYLOAD PACKED — {form.symbol} / {form.name}</div>
              <div className="checklist-row"><span>{address ? '☑' : '☐'}</span> CREATOR WALLET {address ? shortAddr(address, 6) : 'NOT CONNECTED'}</div>

              {engine === 'stonkfun' && (
                <>
                  <div className="checklist-row"><span>{pairName ? '☑' : '☐'}</span> PAIR {pairName ? `${pairName.symbol} (${pairName.name})` : 'NOT SET'}</div>
                  <div className="checklist-row"><span>{prepare.isSuccess ? '☑' : '☐'}</span> FUEL QUOTED {costSol != null ? `— ${costSol.toFixed(4)} SOL` : prepare.isPending ? '…' : prepare.isError ? 'FAILED' : ''}</div>
                  <div className="checklist-row">
                    <span>{costSol != null && balanceSol != null && balanceSol >= costSol ? '☑' : costSol != null ? '☐' : '…'}</span>
                    SOL BALANCE {balanceSol != null ? balanceSol.toFixed(4) : balanceUnknown ? '— RPC UNREACHABLE' : '…'}
                    {insufficient ? ' — INSUFFICIENT' : ''}
                    <button className="bevel-btn b-sm" onClick={() => void refreshBalance()} title="re-read balance from the chain">⟳</button>
                  </div>
                  {balanceUnknown && (
                    <div className="faint" style={{ fontSize: 15 }}>
                      Balance could not be read from the public RPC — it is NOT required to press launch. Your wallet is the final gate.
                    </div>
                  )}
                  {prepare.isPending && <div className="t9" style={{ color: 'var(--amber)' }}>REQUESTING FUEL QUOTE FROM WIRE…</div>}
                  {prepare.isError && (
                    <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)', textShadow: 'var(--glow-red)' }}>
                      ✕ {prepare.error instanceof SfError ? `${prepare.error.code}: ${prepare.error.message}` : String(prepare.error?.message ?? prepare.error)}
                      <button className="bevel-btn b-sm" onClick={() => void doPrepare()}>RE-QUOTE</button>
                    </div>
                  )}
                </>
              )}

              {engine === 'ember' && (
                <>
                  <div className="checklist-row"><span>{chosenPair ? '☑' : '☐'}</span> PAIR {chosenPair ? `${chosenPair.ticker} (${chosenPair.name})` : 'NOT SET'}</div>
                  <div className="checklist-row"><span>{emberPrep ? '☑' : '☐'}</span> FUEL QUOTED {emberPrep ? `— ${emberPrep.openQuote.toFixed(4)} ${chosenPair?.ticker ?? ''}${emberLiqUsd != null ? ` ≈ $${emberLiqUsd.toFixed(0)}` : ''}` : emberPreparing ? '…' : emberPrepErr ? 'FAILED' : ''}</div>
                  <div className="checklist-row"><span>{emberPrep && emberExpirySecs > 0 ? '☑' : '☐'}</span> QUOTE {emberPrep ? (emberExpirySecs > 0 ? `VALID T-${emberExpirySecs}s` : 'EXPIRED — RE-QUOTE') : 'PENDING'}</div>
                  <div className="checklist-row"><span>{emberPrep ? '☑' : '…'}</span> MINT PRE-ASSIGNED {emberPrep ? shortAddr(emberPrep.mint, 6) : ''}</div>
                  {emberPreparing && <div className="t9" style={{ color: 'var(--amber)' }}>REQUESTING FUEL QUOTE FROM EMBER…</div>}
                  {emberPrepErr && (
                    <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)', textShadow: 'var(--glow-red)' }}>
                      ✕ {emberPrepErr}
                      <button className="bevel-btn b-sm" onClick={() => void prepareEmber()}>RE-QUOTE</button>
                    </div>
                  )}
                </>
              )}

              {engine === 'direct' && (
                <>
                  <div className="checklist-row"><span>{directQuote ? '☑' : '☐'}</span> PAIR {directQuote ? shortAddr(directQuote, 6) : 'NOT SET'}</div>
                  <div className="checklist-row"><span>{directConfigAddr ? '☑' : '☐'}</span> CONFIG {directConfigAddr ? shortAddr(directConfigAddr, 6) : 'NOT SET — SEE .env.example'}</div>
                  <div className="checklist-row"><span>{directGradLabel || direct.quoteMint === 'CUSTOM' ? '☑' : '☐'}</span> GRADUATION {directGradLabel ? `AUTO AT ${directGradLabel} → DAMM V2` : 'CUSTOM — MANUAL MIGRATION MAY APPLY'}</div>
                  <div className="checklist-row"><span>☑</span> NETWORK DEVNET (TESTNET)</div>
                  <div className="checklist-row"><span>{directTxState !== 'IDLE' ? '☑' : '…'}</span> TX STATE {directTxState}{directBusy ? '…' : ''}</div>
                  <div className="checklist-row">
                    <span>{balanceSol != null ? '☑' : balanceUnknown ? '☐' : '…'}</span>
                    SOL BALANCE {balanceSol != null ? balanceSol.toFixed(4) : balanceUnknown ? '— RPC UNREACHABLE' : '…'}
                    <button className="bevel-btn b-sm" onClick={() => void refreshBalance()} title="re-read balance from the chain">⟳</button>
                  </div>
                  {directWarn && (
                    <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                      ⚠ {directWarn}
                    </div>
                  )}
                  {!directConfigAddr && (
                    <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
                      ✕ No DBC config for this quote. Deploy via SDK partner.createConfig, set VITE_METEORA_DBC_CONFIG_SOL / _USDC, restart dev.
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {engine === 'stonkfun' && costSol != null && (
                <div className="grid-2" style={{ gap: 10 }}>
                  <Readout label="LAUNCH COST" tone="amber" value={`${costSol.toFixed(4)} SOL`} sub={feeBreakdown} />
                  <Readout label="MODE" tone="cyan" value={form.mode === 'standard' ? `STANDARD ${form.feeTier}` : `REWARD ${Number(form.rewardTaxBps) / 100}% TAX`} sub={
                    prepareData?.devBuy?.tokens != null || prepareData?.devBuy?.netTokens != null
                      ? `dev buy targets ${prepareData?.devBuy?.netTokens ?? prepareData?.devBuy?.tokens}`
                      : prepareData?.airdrop?.recipients != null
                        ? `airdrop to ${prepareData.airdrop.recipients} holders`
                        : undefined
                  } />
                </div>
              )}
              {engine === 'ember' && emberPrep && (
                <div className="grid-2" style={{ gap: 10 }}>
                  <Readout label="OPENING LIQUIDITY (YOU SUPPLY)" tone="amber" value={`${emberPrep.openQuote.toFixed(4)} ${chosenPair?.ticker ?? ''}`} sub={emberLiqUsd != null ? `≈ $${emberLiqUsd.toFixed(2)} of pool liquidity (your capital — backs the curve & earns your fee share) · + ~0.001 SOL rent` : 'plus ~0.001 SOL network rent'} />
                  <Readout label="FEE ROUTING" tone="cyan" value={`${ember.feeBps / 100}% POOL FEE`} sub={ember.mode === 'holders' ? `${(ember.holdersBps / 100).toFixed(0)}% of your 80% to holders` : ember.mode === 'split' ? 'your 80% split across up to 5 wallets' : 'your 80% kept in your wallet'} />
                </div>
              )}
              {engine === 'direct' && (
                <div className="grid-2" style={{ gap: 10 }}>
                  <Readout label="LAUNCH COST" tone="amber" value="RENT + FEES ONLY" sub={`${DIRECT_FEE_LINE} · you pay Solana rent + tx fees`} />
                  <Readout label="GRADUATION" tone="cyan" value={directGradLabel ?? 'MANUAL'} sub={directGradLabel ? `auto-migrated at ${directGradLabel} → DAMM v2 by keepers (devnet test)` : 'custom quote — manual migration via Migrator UI'} />
                </div>
              )}
              {!emberPrep && engine === 'ember' && (
                <div className="warn-strip" style={{ borderColor: 'var(--cyan)', color: 'var(--cyan)' }}>
                  ◈ Get a fuel quote first — the button below activates once Ember returns the launch transaction.
                  <button className="bevel-btn b-sm" onClick={() => void prepareEmber()}>REQUEST QUOTE</button>
                </div>
              )}
              {engine === 'ember' && emberPrep && emberExpirySecs <= 0 && (
                <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
                  ✕ QUOTE EXPIRED
                  <button className="bevel-btn b-sm" onClick={() => void prepareEmber()}>RE-QUOTE</button>
                </div>
              )}
              {/* wallet is the final gate — balance warnings never hard-block the popup */}
              {insufficient && (
                <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                  ⚠ SOL BALANCE {balanceSol?.toFixed(4)} looks below the launch cost ({costSol?.toFixed(4)} SOL). You can
                  still try — your wallet has the final say and will reject the payment if funds are short.
                </div>
              )}
              <div className="launch-cover-wrap">
                <button
                  className="bevel-btn b-lg b-danger"
                  style={{ width: '100%' }}
                  disabled={
                    !address ||
                    countdown != null ||
                    directBusy ||
                    (engine === 'stonkfun' && (!prepareData?.paymentTransaction || costSol == null)) ||
                    (engine === 'ember' && (!emberPrep || emberExpirySecs <= 0)) ||
                    (engine === 'direct' && (!stage2OkDirect || !directConfigAddr))
                  }
                  onClick={() => setConfirmOpen(true)}
                >
                  {countdown != null ? `T-MINUS ${countdown}` : directBusy ? `TX STATE: ${directTxState}…` : '▲ INITIATE LAUNCH SEQUENCE ▲'}
                </button>
                {countdown == null && (
                  <div className="launch-cover">
                    <span className="launch-cover-label">⬆ LIFT SAFETY COVER<br />(HOVER TO ARM)</span>
                  </div>
                )}
              </div>
              {countdown != null && <div className="t-minus blink" style={{ textAlign: 'center' }}>T-{countdown}</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button className="bevel-btn" onClick={() => { setStage(2); play('click') }}>◄ BACK</button>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {/* ---------------- stage 4 ---------------- */}
      {stage === 4 && (
        <Panel title="LIFTOFF — TELEMETRY" end={directBadge}>
          <div className="grid-2">
            <div>
              <div className="rocket-stage">
                <div className="rocket">
                  <span className="flame">▁▃▅</span>
                  {'🚀'}
                </div>
              </div>
              <div ref={telemetryRef} className="telemetry" style={{ marginTop: 10 }}>
                {telemetry.join('\n') || 'STANDING BY…'}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {engine === 'stonkfun' && !completed && (
                <>
                  <Readout
                    label="LAUNCH STATUS"
                    tone={status.isError ? 'pink' : 'amber'}
                    value={status.isError ? 'NO SIGNAL' : (statusData?.status ?? 'PROCESSING').toUpperCase()}
                    sub={completed ? undefined : 'on-chain bundle processing — never re-pay, we keep polling'}
                  />
                  <Blocks frac={completed ? 1 : 0.6} width={18} suffix={completed ? 'COMPLETE' : 'IN FLIGHT'} />
                </>
              )}
              {completed && mintOut && (
                <StonkfunSuccess mint={mintOut} onReset={resetAll} />
              )}
              {engine === 'ember' && (
                <>
                  <Readout label="LIFTOFF COMPLETE — MINT" tone="green" value={emberResult ? shortAddr(emberResult.mint, 6) : '…'} sub={emberResult ? `pool ${shortAddr(emberResult.pool, 6)}` : 'registering on the curve…'} />
                  {emberResult && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <CopyBtn text={emberResult.mint} label="COPY MINT" />
                      <a className="bevel-btn" href={`https://solscan.io/account/${emberResult.pool}`} target="_blank" rel="noreferrer">POOL ON SOLSCAN ↗</a>
                      <a className="bevel-btn" href={`https://embercurve.fun`} target="_blank" rel="noreferrer">VIEW ON EMBER ↗</a>
                      <button className="bevel-btn" onClick={resetAll}>NEW MISSION</button>
                    </div>
                  )}
                </>
              )}
              {engine === 'direct' && (
                <>
                  <Readout
                    label="LIFTOFF COMPLETE — MINT (DEVNET)"
                    tone={directResult ? 'green' : 'amber'}
                    value={directResult ? shortAddr(directResult.mint, 6) : directTxState}
                    sub={directResult ? `pool ${shortAddr(directResult.pool, 6)} · sig ${shortAddr(directResult.signature, 6)}` : 'building + broadcasting pool creation…'}
                  />
                  {directResult && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <CopyBtn text={directResult.mint} label="COPY MINT" />
                      <CopyBtn text={directResult.pool} label="COPY POOL" />
                      <a className="bevel-btn" href={devnetExplorerAccountUrl(directResult.pool)} target="_blank" rel="noreferrer">POOL ON SOLSCAN ↗</a>
                      <a className="bevel-btn" href={devnetExplorerTxUrl(directResult.signature)} target="_blank" rel="noreferrer">TX ON SOLSCAN ↗</a>
                      <button className="bevel-btn" onClick={resetAll}>NEW MISSION</button>
                    </div>
                  )}
                  {directResult && (
                    <Readout
                      label="GRADUATION STATUS"
                      tone={directStatus.data?.graduated ? 'green' : 'cyan'}
                      value={
                        directStatus.isLoading
                          ? 'READING CURVE…'
                          : directStatus.data?.graduated
                            ? 'GRADUATED → DAMM V2'
                            : directStatus.data?.graduationProgress != null
                              ? `${Math.round(directStatus.data.graduationProgress * 100)}% TO GRADUATION`
                              : 'TRACKING…'
                      }
                      sub={
                        directStatus.data?.quoteReserveUi != null && directStatus.data?.migrationThresholdUi != null
                          ? `${directStatus.data.quoteReserveUi.toFixed(4)} / ${directStatus.data.migrationThresholdUi.toFixed(4)} quote · keepers migrate automatically`
                          : 'live reserve / threshold from chain'
                      }
                    />
                  )}
                  {directResult && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="bevel-btn b-sm" onClick={() => void directStatus.refetch()}>RETRY POLL</button>
                    </div>
                  )}
                </>
              )}
              {status.isError && engine === 'stonkfun' && (
                <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
                  ✕ TELEMETRY LOST — {String(status.error?.message ?? status.error)}
                  {paymentSig && <button className="bevel-btn b-sm" onClick={() => void status.refetch()}>RETRY POLL</button>}
                </div>
              )}
              {launchError && <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)', textShadow: 'var(--glow-red)' }}>✕ {launchError}</div>}
              {engine === 'stonkfun' && statusData && !completed && (
                <div className="faint" style={{ fontSize: 15 }}>
                  raw: {JSON.stringify(statusData).slice(0, 220)}
                </div>
              )}
            </div>
          </div>
        </Panel>
      )}

      {confirmOpen && (
        <SystemDialog
          title="CONFIRM LAUNCH — USER APPROVAL REQUIRED"
          onClose={() => setConfirmOpen(false)}
          actions={
            <>
              <button className="bevel-btn" onClick={() => setConfirmOpen(false)}>✕ CANCEL</button>
              <button
                className="bevel-btn b-danger"
                disabled={engine === 'direct' && (!stage2OkDirect || !directConfigAddr)}
                onClick={() => { setConfirmOpen(false); play('launch'); void (engine === 'stonkfun' ? doStonkfunLaunch() : engine === 'ember' ? doEmberLaunch() : doDirectLaunch()) }}
              >
                ✓ CONFIRM &amp; SIGN IN WALLET
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="stat-row"><span className="sk">ENGINE</span><span className="sv">{engine === 'stonkfun' ? 'STONKFUN' : engine === 'ember' ? 'EMBER (DBC)' : 'DIRECT (DBC · TESTNET)'}</span></div>
            <div className="stat-row"><span className="sk">COIN</span><span className="sv">{form.name} / {form.symbol}</span></div>
            {engine === 'stonkfun' && <div className="stat-row"><span className="sk">COST</span><span className="sv">{costSol?.toFixed(4)} SOL (paid to StonkFun)</span></div>}
            {engine === 'ember' && emberPrep && (
              <>
                <div className="stat-row"><span className="sk">OPENING LIQUIDITY</span><span className="sv">{emberPrep.openQuote.toFixed(4)} {chosenPair?.ticker ?? ''}{emberLiqUsd != null ? ` ≈ $${emberLiqUsd.toFixed(2)}` : ''}</span></div>
                <div className="stat-row"><span className="sk">FEE ROUTING</span><span className="sv">{ember.feeBps / 100}% fee · {ember.mode}{ember.mode === 'holders' ? ` ${(ember.holdersBps / 100).toFixed(0)}% holders` : ''}</span></div>
              </>
            )}
            {engine === 'direct' && (
              <>
                <div className="stat-row"><span className="sk">QUOTE</span><span className="sv mono-addr">{shortAddr(directQuote, 8)}</span></div>
                <div className="stat-row"><span className="sk">CONFIG</span><span className="sv mono-addr">{shortAddr(directConfigAddr || 'NOT SET', 8)}</span></div>
                <div className="stat-row"><span className="sk">NETWORK</span><span className="sv">DEVNET (TESTNET)</span></div>
                <div className="stat-row"><span className="sk">GRADUATION</span><span className="sv">{directGradLabel ? `AUTO AT ${directGradLabel} → DAMM V2` : 'CUSTOM — MANUAL MIGRATION MAY APPLY'}</span></div>
                {direct.firstBuyMode === 'quote' && <div className="stat-row"><span className="sk">FIRST BUY</span><span className="sv">{direct.firstBuyAmount} quote</span></div>}
              </>
            )}
            <div className="stat-row"><span className="sk">MINT</span><span className="sv mono-addr">{shortAddr(engine === 'ember' && emberPrep ? emberPrep.mint : String((statusData?.mint as string) ?? prepareData?.mint ?? '…'), 8)}</span></div>
            <div className="faint" style={{ fontSize: 15 }}>
              After CONFIRM, your wallet popup opens — approve there to sign. No transaction is ever
              signed without your explicit wallet approval.
            </div>
          </div>
        </SystemDialog>
      )}

      <div className="warn-strip">
        <span>◈</span>
        <span>
          Launching is non-custodial: transactions are signed by YOUR wallet and broadcast by the engine
          (StonkFun or Ember). Engine fees are set by the platforms, shown before you sign — never after.
        </span>
      </div>
    </div>
  )

  function StonkfunSuccess({ mint, onReset }: { mint: string; onReset: () => void }) {
    return (
      <>
        <Readout label="LIFTOFF COMPLETE — MINT" tone="green" value={shortAddr(mint, 6)} sub="coin is live on the curve" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <CopyBtn text={mint} label="COPY MINT" />
          <Link className="bevel-btn b-cyan" to="/launchpad/markets">VIEW IN MARKETS →</Link>
          <a className="bevel-btn" href={`https://www.stonkfun.xyz/token/${mint}`} target="_blank" rel="noreferrer">OPEN ON STONKFUN ↗</a>
          <button className="bevel-btn" onClick={onReset}>NEW MISSION</button>
        </div>
      </>
    )
  }

  function resetAll() {
    setForm(INITIAL)
    setEmber(EMBER_INITIAL)
    setDirect(DIRECT_INITIAL)
    setStage(1)
    setPaymentSig(null)
    setEmberResult(null)
    setDirectResult(null)
    setDirectTxState('IDLE')
    setEmberPrep(null)
    setTelemetry([])
    setLaunchError(null)
  }
}
