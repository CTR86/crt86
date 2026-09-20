import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSolanaWallet } from '../wallets/SolanaWallet'
import { useUi } from '../store/ui'
import { Panel, Readout } from '../design/ui'
import { SystemDialog } from '../design/SystemDialog'
import { blocks, shortAddr } from '../lib/format'
import { play } from '../sound/sfx'
import { MIN_I128, WSOL_MINT, explorerTxUrl } from '../lib/lend/config'
import {
  broadcastSignedTx,
  buildBorrowOperateTx,
  buildEarnDepositTx,
  buildEarnWithdrawTx,
  computeLtv,
  confirmSignature,
  deserializeVersionedTx,
  fetchBorrowPositions,
  fetchBorrowVaults,
  fetchEarnPositions,
  fetchEarnTokens,
  formatBorrowRate,
  formatFactorPct,
  formatRatePct,
  formatTokenAmount,
  friendlyLendError,
  fromBaseUnits,
  getTokenBalanceHuman,
  isWalletRejection,
  simulateVersionedTx,
  toBaseUnits,
  tokenPriceUsd,
  validateEarnInput,
  validateOperateInput,
  validateProjectedLtv,
  validateWithdrawInput,
  type BorrowPosition,
  type BorrowVault,
  type EarnPosition,
  type EarnToken,
} from '../lib/lend/api'

type Tab = 'earn' | 'borrow'
type Phase = 'idle' | 'working' | 'signing' | 'sending' | 'confirming' | 'success' | 'error'
type EarnAction = 'deposit' | 'withdraw'
type BorrowAction = 'deposit' | 'borrow' | 'repay' | 'withdraw' | 'deposit-borrow'

export function LendWindow() {
  const nav = useNavigate()
  const sol = useSolanaWallet()
  const openWalletHelp = useUi((s) => s.openWalletHelp)

  const [tab, setTab] = useState<Tab>('earn')

  /* ---------- shared tx state ---------- */
  const [phase, setPhase] = useState<Phase>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [telemetry, setTelemetry] = useState<string[]>([])
  const [txSig, setTxSig] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [successOpen, setSuccessOpen] = useState(false)
  const [successLabel, setSuccessLabel] = useState('')
  const busy = useRef(false)

  const log = useCallback((l: string) => {
    setTelemetry((s) => [...s.slice(-24), `[${new Date().toLocaleTimeString()}] ${l}`])
  }, [])

  /* ================= EARN ================= */
  const [earnTokens, setEarnTokens] = useState<EarnToken[]>([])
  const [earnLoading, setEarnLoading] = useState(true)
  const [earnListErr, setEarnListErr] = useState<string | null>(null)
  const [earnMint, setEarnMint] = useState<string>('')
  const [earnAmount, setEarnAmount] = useState('')
  const [earnAction, setEarnAction] = useState<EarnAction>('deposit')
  const [earnPositions, setEarnPositions] = useState<EarnPosition[]>([])
  const [earnPosLoading, setEarnPosLoading] = useState(false)
  const [earnBal, setEarnBal] = useState<number | null>(null)

  const earnToken: EarnToken | undefined = useMemo(
    () => earnTokens.find((t) => t.assetAddress === earnMint) ?? earnTokens[0],
    [earnTokens, earnMint],
  )

  const loadEarnTokens = useCallback(async () => {
    setEarnLoading(true)
    setEarnListErr(null)
    try {
      const list = await fetchEarnTokens()
      setEarnTokens(list)
      if (list.length > 0 && !earnMint) setEarnMint(list[0].assetAddress)
      log(`EARN MARKETS LOADED — ${list.length} ASSETS`)
    } catch (e) {
      const m = friendlyLendError(String((e as Error).message ?? e))
      setEarnListErr(m)
      log('EARN MARKETS FAILED — ' + m.slice(0, 120))
    } finally {
      setEarnLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadEarnPositions = useCallback(async () => {
    if (!sol.address) {
      setEarnPositions([])
      return
    }
    setEarnPosLoading(true)
    try {
      const pos = await fetchEarnPositions([sol.address])
      setEarnPositions(pos)
      log(`POSITIONS REFRESHED — ${pos.length} EARN POSITIONS`)
    } catch (e) {
      log('POSITION REFRESH FAILED — ' + String((e as Error).message ?? e).slice(0, 120))
    } finally {
      setEarnPosLoading(false)
    }
  }, [sol.address, log])

  useEffect(() => {
    void loadEarnTokens()
  }, [loadEarnTokens])

  useEffect(() => {
    void loadEarnPositions()
  }, [loadEarnPositions])

  useEffect(() => {
    let dead = false
    if (!sol.address || !earnToken) {
      setEarnBal(null)
      return
    }
    void getTokenBalanceHuman(sol.address, earnToken.assetAddress).then((b) => {
      if (!dead) setEarnBal(b)
    })
    return () => {
      dead = true
    }
  }, [sol.address, earnToken])

  const earnPositionForToken: EarnPosition | undefined = useMemo(
    () => earnPositions.find((p) => p.token.assetAddress === earnToken?.assetAddress),
    [earnPositions, earnToken],
  )
  const earnSuppliedHuman: number | null = useMemo(() => {
    if (!earnPositionForToken || !earnToken) return null
    try {
      return fromBaseUnits(earnPositionForToken.underlyingAssets, earnToken.decimals)
    } catch {
      return null
    }
  }, [earnPositionForToken, earnToken])

  const earnInputErr =
    earnAction === 'deposit'
      ? validateEarnInput({
          amountHuman: earnAmount,
          decimals: earnToken?.decimals ?? 6,
          balanceHuman: earnBal,
          walletConnected: !!sol.address,
        })
      : validateWithdrawInput({
          amountHuman: earnAmount,
          decimals: earnToken?.decimals ?? 6,
          suppliedHuman: earnSuppliedHuman,
          walletConnected: !!sol.address,
        })

  /* ================= BORROW ================= */
  const [vaults, setVaults] = useState<BorrowVault[]>([])
  const [vaultsLoading, setVaultsLoading] = useState(true)
  const [vaultsErr, setVaultsErr] = useState<string | null>(null)
  const [vaultId, setVaultId] = useState<number | null>(null)
  const [borrowPositions, setBorrowPositions] = useState<BorrowPosition[]>([])
  const [borrowPosLoading, setBorrowPosLoading] = useState(false)
  const [positionId, setPositionId] = useState<number | null>(null) // null = new position
  const [colAmount, setColAmount] = useState('')
  const [debtAmount, setDebtAmount] = useState('')
  const [borrowAction, setBorrowAction] = useState<BorrowAction>('deposit-borrow')
  const [useMaxRepay, setUseMaxRepay] = useState(false)
  const [useMaxWithdraw, setUseMaxWithdraw] = useState(false)
  const [colBal, setColBal] = useState<number | null>(null)

  const vault: BorrowVault | undefined = useMemo(
    () => vaults.find((v) => v.id === vaultId) ?? vaults[0],
    [vaults, vaultId],
  )

  const loadVaults = useCallback(async () => {
    setVaultsLoading(true)
    setVaultsErr(null)
    try {
      const list = await fetchBorrowVaults('main')
      setVaults(list)
      if (list.length > 0 && vaultId == null) setVaultId(list[0].id)
      log(`BORROW MARKETS LOADED — ${list.length} VAULTS`)
    } catch (e) {
      const m = friendlyLendError(String((e as Error).message ?? e))
      setVaultsErr(m)
      log('BORROW MARKETS FAILED — ' + m.slice(0, 120))
    } finally {
      setVaultsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadBorrowPositions = useCallback(async () => {
    if (!sol.address) {
      setBorrowPositions([])
      return
    }
    setBorrowPosLoading(true)
    try {
      const pos = await fetchBorrowPositions([sol.address], 'main')
      setBorrowPositions(pos)
      log(`POSITIONS REFRESHED — ${pos.length} BORROW POSITIONS`)
    } catch (e) {
      log('BORROW POSITION REFRESH FAILED — ' + String((e as Error).message ?? e).slice(0, 120))
    } finally {
      setBorrowPosLoading(false)
    }
  }, [sol.address, log])

  useEffect(() => {
    void loadVaults()
  }, [loadVaults])

  useEffect(() => {
    void loadBorrowPositions()
  }, [loadBorrowPositions])

  useEffect(() => {
    let dead = false
    if (!sol.address || !vault) {
      setColBal(null)
      return
    }
    void getTokenBalanceHuman(sol.address, vault.supplyToken.address).then((c) => {
      if (!dead) setColBal(c)
    })
    return () => {
      dead = true
    }
  }, [sol.address, vault])

  const vaultPositions = useMemo(
    () => (vault ? borrowPositions.filter((p) => p.vaultId === vault.id) : []),
    [borrowPositions, vault],
  )
  const activePosition: BorrowPosition | undefined = useMemo(
    () => vaultPositions.find((p) => p.id === positionId),
    [vaultPositions, positionId],
  )

  const positionLtv = useMemo(
    () => (vault && activePosition ? computeLtv(vault, activePosition.supply, activePosition.borrow) : null),
    [vault, activePosition],
  )

  const operateInputErr = useMemo(() => {
    if (!vault) return null
    return validateOperateInput({
      vault,
      colHuman: borrowAction === 'borrow' || borrowAction === 'repay' ? '' : colAmount,
      debtHuman: borrowAction === 'deposit' || borrowAction === 'withdraw' ? '' : debtAmount,
      mode: borrowAction,
      walletConnected: !!sol.address,
      positionSupplyBase: activePosition?.supply ?? null,
      positionBorrowBase: activePosition?.borrow ?? null,
    })
  }, [vault, colAmount, debtAmount, borrowAction, sol.address, activePosition])

  /* projected LTV for the pending op (client-side guard, chain is truth) */
  const projectedLtvErr = useMemo(() => {
    if (!vault) return null
    if (borrowAction !== 'borrow' && borrowAction !== 'deposit-borrow') return null
    const col = colAmount.trim() === '' ? 0 : Number(colAmount)
    const debt = debtAmount.trim() === '' ? 0 : Number(debtAmount)
    if (!isFinite(col) || !isFinite(debt) || (col === 0 && debt === 0)) return null
    try {
      const curSup = activePosition ? BigInt(activePosition.supply) : 0n
      const curBor = activePosition ? BigInt(activePosition.borrow) : 0n
      const addSup = col > 0 ? BigInt(toBaseUnits(String(col), vault.supplyToken.decimals)) : 0n
      const addBor = debt > 0 ? BigInt(toBaseUnits(String(debt), vault.borrowToken.decimals)) : 0n
      return validateProjectedLtv(vault, String(curSup + addSup), String(curBor + addBor))
    } catch {
      return null
    }
  }, [vault, colAmount, debtAmount, borrowAction, activePosition])

  /* ---------- shared runner: build unsigned → simulate → sign → send → verify ---------- */
  const runLendTx = useCallback(
    async (kind: string, build: () => Promise<{ transaction: string; nftId?: number }>, label: string) => {
      if (!sol.address) {
        setErr('Wallet not connected — connect Phantom first.')
        play('error')
        return
      }
      if (busy.current) return
      busy.current = true
      setConfirmOpen(false)
      setErr(null)
      setTxSig(null)
      try {
        setPhase('working')
        log(`BUILDING ${kind} TX VIA JUPITER LEND…`)
        const built = await build()
        log('TX RECEIVED — DESERIALIZING…')
        const tx = await deserializeVersionedTx(built.transaction)
        log('SIMULATING ON SOLANA…')
        const sim = await simulateVersionedTx(tx)
        if (!sim.ok) {
          const first = (sim.logs ?? []).find((l) => /error|failed|insufficient/i.test(l)) ?? (sim.logs ?? [])[0]
          if (first) log(first.slice(0, 140))
          throw new Error(sim.err ? String(sim.err).slice(0, 260) : 'Simulation failed — the protocol would reject this. Check amounts and liquidity, then retry.')
        }
        log('SIM OK — REQUESTING WALLET SIGNATURE…')
        setPhase('signing')
        play('alert')
        let signed: import('@solana/web3.js').VersionedTransaction
        try {
          signed = (await sol.signTx(tx)) as import('@solana/web3.js').VersionedTransaction
        } catch (e) {
          const m = String((e as Error).message ?? e)
          if (isWalletRejection(m)) throw new Error('You rejected the request in your wallet.', { cause: e })
          throw e
        }
        setPhase('sending')
        log('SIGNATURE RECEIVED — BROADCASTING…')
        const sig = await broadcastSignedTx(signed)
        setTxSig(sig)
        log(`TX ${sig.slice(0, 18)}…`)
        log(explorerTxUrl(sig))
        setPhase('confirming')
        const ok = await confirmSignature(sig)
        log(ok ? 'CONFIRMED — REFRESHING POSITIONS…' : 'SENT — check Solscan; confirmation pending')
        if (built.nftId != null) log(`POSITION NFT #${built.nftId}`)
        setPhase('success')
        setSuccessLabel(label)
        setSuccessOpen(true)
        play('win')
        void loadEarnPositions()
        void loadBorrowPositions()
        void sol.refreshBalance()
      } catch (e) {
        const m = String((e as Error).message ?? e)
        play('error')
        setErr(m.length > 420 ? m.slice(0, 420) : m)
        setPhase('error')
        log('ERROR — ' + m.slice(0, 140))
      } finally {
        busy.current = false
      }
    },
    [sol, log, loadEarnPositions, loadBorrowPositions],
  )

  /* ---------- earn submit ---------- */
  const submitEarn = useCallback(() => {
    if (!sol.address || !earnToken) return
    if (earnInputErr) {
      setErr(earnInputErr)
      setPhase('error')
      play('error')
      return
    }
    const amountBase = toBaseUnits(earnAmount, earnToken.decimals)
    const asset = earnToken.assetAddress
    const signer = sol.address
    const kind = earnAction === 'deposit' ? 'DEPOSIT' : 'WITHDRAW'
    const label = `${earnAction === 'deposit' ? 'SUPPLIED' : 'WITHDREW'} ${earnAmount} ${earnToken.asset.symbol}`
    void runLendTx(
      kind,
      async () =>
        earnAction === 'deposit'
          ? buildEarnDepositTx({ asset, amountBase, signer })
          : buildEarnWithdrawTx({ asset, amountBase, signer }),
      label,
    )
  }, [sol.address, earnToken, earnInputErr, earnAmount, earnAction, runLendTx])

  /* ---------- borrow submit ---------- */
  const submitBorrow = useCallback(() => {
    if (!sol.address || !vault) return
    if (operateInputErr) {
      setErr(operateInputErr)
      setPhase('error')
      play('error')
      return
    }
    if (projectedLtvErr) {
      setErr(projectedLtvErr)
      setPhase('error')
      play('error')
      return
    }
    const col = colAmount.trim() === '' ? 0 : Number(colAmount)
    const debt = debtAmount.trim() === '' ? 0 : Number(debtAmount)
    const signer = sol.address
    const pid = activePosition ? activePosition.id : 0
    let colAmountStr = '0'
    let debtAmountStr = '0'
    let kind: string
    let label: string
    const supSym = vault.supplyToken.uiSymbol ?? vault.supplyToken.symbol
    const borSym = vault.borrowToken.uiSymbol ?? vault.borrowToken.symbol
    if (borrowAction === 'deposit') {
      colAmountStr = toBaseUnits(String(col), vault.supplyToken.decimals)
      kind = 'DEPOSIT COLLATERAL'
      label = `DEPOSITED ${col} ${supSym} → VAULT #${vault.id}`
    } else if (borrowAction === 'borrow') {
      if (!activePosition) {
        setErr('Borrow needs an existing position — deposit collateral first (or use DEPOSIT+BORROW for a new position).')
        setPhase('error')
        play('error')
        return
      }
      debtAmountStr = toBaseUnits(String(debt), vault.borrowToken.decimals)
      kind = 'BORROW'
      label = `BORROWED ${debt} ${borSym} FROM VAULT #${vault.id}`
    } else if (borrowAction === 'repay') {
      if (!activePosition) {
        setErr('Nothing to repay — this vault has no position on your wallet.')
        setPhase('error')
        play('error')
        return
      }
      debtAmountStr = useMaxRepay ? MIN_I128 : '-' + toBaseUnits(String(debt), vault.borrowToken.decimals)
      kind = 'REPAY'
      label = useMaxRepay ? `REPAID FULL DEBT ON VAULT #${vault.id}` : `REPAID ${debt} ${borSym} ON VAULT #${vault.id}`
    } else if (borrowAction === 'withdraw') {
      if (!activePosition) {
        setErr('Nothing to withdraw — this vault has no position on your wallet.')
        setPhase('error')
        play('error')
        return
      }
      colAmountStr = useMaxWithdraw ? MIN_I128 : '-' + toBaseUnits(String(col), vault.supplyToken.decimals)
      kind = 'WITHDRAW COLLATERAL'
      label = useMaxWithdraw ? `WITHDREW ALL COLLATERAL FROM VAULT #${vault.id}` : `WITHDREW ${col} ${supSym} FROM VAULT #${vault.id}`
    } else {
      colAmountStr = toBaseUnits(String(col), vault.supplyToken.decimals)
      debtAmountStr = toBaseUnits(String(debt), vault.borrowToken.decimals)
      kind = 'DEPOSIT+BORROW'
      label = `DEPOSITED ${col} ${supSym} + BORROWED ${debt} ${borSym} (VAULT #${vault.id})`
    }
    void runLendTx(
      kind,
      async () =>
        buildBorrowOperateTx({
          vaultId: vault.id,
          positionId: pid,
          signer,
          colAmount: colAmountStr,
          debtAmount: debtAmountStr,
          positionOwner: activePosition ? signer : undefined,
          market: 'main',
        }),
      label,
    )
  }, [sol.address, vault, operateInputErr, projectedLtvErr, colAmount, debtAmount, activePosition, borrowAction, useMaxRepay, useMaxWithdraw, runLendTx])

  const statusTone = phase === 'success' ? 'var(--green)' : phase === 'error' ? 'var(--red)' : 'var(--amber)'
  const wsolInvolved =
    earnToken?.assetAddress === WSOL_MINT ||
    vault?.supplyToken.address === WSOL_MINT ||
    vault?.borrowToken.address === WSOL_MINT

  const earnApy = earnToken ? formatRatePct(earnToken.totalRate) : '—'

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">◤ LEND.EXE</h1>
        <span className="page-sub">JUPITER LEND INSIDE THE CRT · EARN YIELD · BORROW AGAINST COLLATERAL</span>
        <span className="badge new">JUP.LEND</span>
      </div>

      <div className="warn-strip">
        <span>◈</span>
        <span>
          Markets are <b>discovered live</b> from Jupiter Lend — APY, LTV and liquidity below are real API values, never
          hardcoded. Every action opens <b>your wallet once</b> for signature. Nothing is submitted until you sign.
        </span>
      </div>

      <div className="tab-row" role="tablist" aria-label="lend mode">
        <button className={`tab ${tab === 'earn' ? 'active' : ''}`} onClick={() => { setTab('earn'); play('click') }}>
          EARN / LEND
        </button>
        <button className={`tab ${tab === 'borrow' ? 'active' : ''}`} onClick={() => { setTab('borrow'); play('click') }}>
          BORROW
        </button>
      </div>

      {tab === 'earn' ? (
        <div className="grid-2" style={{ gap: 12, alignItems: 'start' }}>
          <Panel title="EARN.EXE — SUPPLY & WITHDRAW" end={<span className="pt-end">JUP.LEND</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {earnLoading ? (
                <div className="state-note"><span className="big">LOADING MARKETS…</span>api.jup.ag/lend/v1/earn/tokens</div>
              ) : earnListErr ? (
                <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
                  ✕ {earnListErr}{' '}
                  <button className="bevel-btn b-sm" onClick={() => void loadEarnTokens()}>↻ RETRY</button>
                </div>
              ) : earnTokens.length === 0 ? (
                <div className="state-note"><span className="big">NO MARKETS</span>Jupiter Lend returned zero earn tokens.</div>
              ) : (
                <>
                  <label className="field">
                    <span className="field-label">ASSET — {earnTokens.length} SUPPORTED</span>
                    <select value={earnToken?.assetAddress ?? ''} onChange={(e) => { setEarnMint(e.target.value); setEarnAmount(''); setErr(null); play('click') }}>
                      {earnTokens.map((t) => (
                        <option key={t.assetAddress} value={t.assetAddress}>
                          {t.asset.symbol} · {formatRatePct(t.totalRate)} APY
                        </option>
                      ))}
                    </select>
                    <span className="field-hint">Only assets returned by Jupiter Lend are listed. Anything else shows as Not supported.</span>
                  </label>

                  {earnToken && (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <Readout label="TOTAL APY" tone="green" value={formatRatePct(earnToken.totalRate)} sub={`supply ${formatRatePct(earnToken.supplyRate)} + rewards ${formatRatePct(earnToken.rewardsRate)}`} />
                        <Readout label="ASSET PRICE" tone="cyan" value={earnToken.asset.price ? `$${Number(earnToken.asset.price).toFixed(2)}` : '—'} sub={earnToken.asset.name} />
                      </div>
                      <div className="stat-row"><span className="sk">SUPPLIED (YOU)</span><span className="sv">{earnSuppliedHuman != null ? `${formatTokenAmount(earnSuppliedHuman, earnToken.decimals)} ${earnToken.asset.symbol}` : '—'}</span></div>
                      <div className="stat-row"><span className="sk">WALLET BALANCE</span><span className="sv">{earnBal != null ? `${earnBal.toFixed(4)} ${earnToken.asset.symbol}` : '—'}</span></div>
                      <div className="stat-row"><span className="sk">WITHDRAWABLE (POOL)</span><span className="sv">{earnToken.liquiditySupplyData?.withdrawable ? formatTokenAmount(fromBaseUnits(earnToken.liquiditySupplyData.withdrawable, earnToken.decimals), earnToken.decimals) + ` ${earnToken.asset.symbol}` : '—'}</span></div>
                    </>
                  )}

                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['deposit', 'withdraw'] as EarnAction[]).map((a) => (
                      <button key={a} className={`chip-toggle ${earnAction === a ? 'on' : ''}`} onClick={() => { setEarnAction(a); setEarnAmount(''); setErr(null); play('click') }}>
                        {a === 'deposit' ? '＋ SUPPLY' : '－ WITHDRAW'}
                      </button>
                    ))}
                  </div>

                  <label className="field">
                    <span className="field-label">AMOUNT — {earnToken?.asset.symbol ?? '—'} {earnAction === 'deposit' && earnBal != null ? <span className="faint" style={{ textTransform: 'none' }}>· wallet {earnBal.toFixed(4)}</span> : null}</span>
                    <input value={earnAmount} onChange={(e) => { setEarnAmount(e.target.value.replace(/[^0-9.]/g, '')); setErr(null) }} placeholder="0.0" inputMode="decimal" />
                    {earnInputErr && earnAmount.trim() && <span className="field-hint" style={{ color: 'var(--red)' }}>{earnInputErr}</span>}
                  </label>

                  {wsolInvolved && (
                    <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                      WSOL market — Jupiter Lend does not wrap/unwrap native SOL. Supply needs a funded WSOL balance.
                    </div>
                  )}

                  <button
                    className="bevel-btn b-lg b-cyan"
                    style={{ width: '100%' }}
                    disabled={!sol.address || !earnToken || !earnAmount.trim() || !!earnInputErr || phase === 'signing' || phase === 'sending' || phase === 'working'}
                    onClick={() => { setConfirmOpen(true); play('alert') }}
                  >
                    {!sol.address ? 'CONNECT PHANTOM TO LEND' : phase === 'signing' ? 'SIGNING…' : phase === 'sending' ? 'SENDING…' : phase === 'working' ? 'WORKING…' : `${earnAction === 'deposit' ? '＋ SUPPLY' : '－ WITHDRAW'} ${earnToken?.asset.symbol ?? ''} · PREVIEW`}
                  </button>
                  <div className="faint" style={{ fontSize: 14 }}>
                    Flow: preview → confirm → wallet signs once → broadcast → verify → refresh. APY {earnApy} is the live Jupiter rate.
                  </div>
                </>
              )}
            </div>
          </Panel>

          <Panel
            title="YOUR EARN POSITIONS — ON-CHAIN"
            end={
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span className="t8 dim">{sol.address ? shortAddr(sol.address, 4) : 'OFFLINE'}</span>
                <button className="bevel-btn b-sm" disabled={!sol.address || earnPosLoading} onClick={() => void loadEarnPositions()}>
                  {earnPosLoading ? 'SCANNING…' : '↻ REFRESH'}
                </button>
              </span>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!sol.address ? (
                <div className="state-note">
                  <span className="big">WALLET OFFLINE</span>
                  <button className="bevel-btn b-cyan" onClick={() => (sol.available ? sol.connect().catch(() => play('error')) : openWalletHelp('sol'))}>
                    {sol.available ? 'CONNECT PHANTOM' : 'INSTALL PHANTOM'}
                  </button>
                </div>
              ) : earnPositions.length === 0 ? (
                <div className="state-note">
                  <span className="big">NO SUPPLY YET</span>
                  <span className="faint" style={{ fontSize: 14 }}>Supply an asset from the left panel — your jlToken position appears here.</span>
                </div>
              ) : (
                earnPositions.map((p) => (
                  <div key={p.token.assetAddress} style={{ border: '2px solid var(--line)', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="badge grad" style={{ fontSize: 8 }}>＋ {p.token.asset.symbol} SUPPLIED</span>
                      <span className="faint" style={{ fontSize: 14 }}>{formatRatePct(p.token.totalRate)} APY</span>
                    </div>
                    <div className="stat-row"><span className="sk">SUPPLIED</span><span className="sv">{formatTokenAmount(fromBaseUnits(p.underlyingAssets, p.token.decimals), p.token.decimals)} {p.token.asset.symbol}</span></div>
                    <div className="stat-row"><span className="sk">SHARES (jl)</span><span className="sv">{formatTokenAmount(fromBaseUnits(p.shares, p.token.decimals), p.token.decimals)} {p.token.symbol}</span></div>
                    <div className="stat-row"><span className="sk">WALLET BAL</span><span className="sv">{p.underlyingBalance} {p.token.asset.symbol}</span></div>
                    <button className="bevel-btn b-sm" onClick={() => { setEarnMint(p.token.assetAddress); setEarnAction('withdraw'); setEarnAmount(''); play('click') }}>
                      WITHDRAW THIS →
                    </button>
                  </div>
                ))
              )}
              <div className="faint" style={{ fontSize: 13 }}>
                Positions: <code style={{ fontSize: 12 }}>GET /earn/positions?users=</code> · shares = jlTokens · underlying grows with yield.
              </div>
            </div>
          </Panel>
        </div>
      ) : (
        <div className="grid-2" style={{ gap: 12, alignItems: 'start' }}>
          <Panel title="BORROW.EXE — COLLATERAL VAULTS" end={<span className="pt-end">JUP.LEND</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {vaultsLoading ? (
                <div className="state-note"><span className="big">LOADING VAULTS…</span>api.jup.ag/lend/v1/borrow/vaults</div>
              ) : vaultsErr ? (
                <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
                  ✕ {vaultsErr}{' '}
                  <button className="bevel-btn b-sm" onClick={() => void loadVaults()}>↻ RETRY</button>
                </div>
              ) : vaults.length === 0 ? (
                <div className="state-note"><span className="big">NO VAULTS</span>Jupiter Lend returned zero borrow vaults.</div>
              ) : (
                <>
                  <label className="field">
                    <span className="field-label">VAULT — {vaults.length} MARKETS (MAIN)</span>
                    <select value={vault?.id ?? ''} onChange={(e) => { setVaultId(Number(e.target.value)); setPositionId(null); setColAmount(''); setDebtAmount(''); setUseMaxRepay(false); setUseMaxWithdraw(false); setErr(null); play('click') }}>
                      {vaults.map((v) => (
                        <option key={v.id} value={v.id}>
                          #{v.id} {v.supplyToken.uiSymbol ?? v.supplyToken.symbol} → {v.borrowToken.uiSymbol ?? v.borrowToken.symbol} · LTV {formatFactorPct(v.collateralFactor)}
                        </option>
                      ))}
                    </select>
                    <span className="field-hint">Each vault fixes its collateral + debt pair. Anything else is Not supported on that vault.</span>
                  </label>

                  {vault && (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <Readout label="MAX LTV" tone="amber" value={formatFactorPct(vault.collateralFactor)} sub={`liq ${formatFactorPct(vault.liquidationThreshold)}`} />
                        <Readout label="BORROW RATE" tone="cyan" value={formatBorrowRate(vault.borrowRate)} sub={vault.borrowToken.uiSymbol ?? vault.borrowToken.symbol} />
                      </div>
                      <div className="stat-row"><span className="sk">COLLATERAL</span><span className="sv">{vault.supplyToken.uiSymbol ?? vault.supplyToken.symbol} · {tokenPriceUsd(vault.supplyToken.price) ? `$${tokenPriceUsd(vault.supplyToken.price)!.toFixed(2)}` : 'price —'}</span></div>
                      <div className="stat-row"><span className="sk">DEBT ASSET</span><span className="sv">{vault.borrowToken.uiSymbol ?? vault.borrowToken.symbol} · {tokenPriceUsd(vault.borrowToken.price) ? `$${tokenPriceUsd(vault.borrowToken.price)!.toFixed(2)}` : 'price —'}</span></div>
                      <div className="stat-row"><span className="sk">BORROWABLE</span><span className="sv">{vault.borrowable ? formatTokenAmount(fromBaseUnits(vault.borrowable, vault.borrowToken.decimals), vault.borrowToken.decimals) + ` ${vault.borrowToken.uiSymbol ?? vault.borrowToken.symbol}` : '—'}</span></div>
                      <div className="stat-row"><span className="sk">WALLET {vault.supplyToken.uiSymbol ?? vault.supplyToken.symbol}</span><span className="sv">{colBal != null ? colBal.toFixed(4) : '—'}</span></div>
                    </>
                  )}

                  <label className="field">
                    <span className="field-label">POSITION — {vaultPositions.length} ON THIS VAULT</span>
                    <select value={positionId ?? 'new'} onChange={(e) => { setPositionId(e.target.value === 'new' ? null : Number(e.target.value)); setErr(null); play('click') }}>
                      <option value="new">＋ NEW POSITION</option>
                      {vaultPositions.map((p) => (
                        <option key={p.id} value={p.id}>
                          #{p.id} · coll {formatTokenAmount(fromBaseUnits(p.supply, vault?.supplyToken.decimals ?? 6), vault?.supplyToken.decimals ?? 6)} / debt {formatTokenAmount(fromBaseUnits(p.borrow, vault?.borrowToken.decimals ?? 6), vault?.borrowToken.decimals ?? 6)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {([['deposit', '＋ DEPOSIT'], ['borrow', '－ BORROW'], ['repay', '↩ REPAY'], ['withdraw', '↪ WITHDRAW'], ['deposit-borrow', '⚡ DEPOSIT+BORROW']] as Array<[BorrowAction, string]>).map(([a, label]) => (
                      <button key={a} className={`chip-toggle ${borrowAction === a ? 'on' : ''}`} onClick={() => { setBorrowAction(a); setUseMaxRepay(false); setUseMaxWithdraw(false); setErr(null); play('click') }}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {(borrowAction === 'deposit' || borrowAction === 'withdraw' || borrowAction === 'deposit-borrow') && (
                    <label className="field">
                      <span className="field-label">COLLATERAL — {vault?.supplyToken.uiSymbol ?? vault?.supplyToken.symbol}</span>
                      <input value={colAmount} disabled={useMaxWithdraw} onChange={(e) => { setColAmount(e.target.value.replace(/[^0-9.]/g, '')); setErr(null) }} placeholder="0.0" inputMode="decimal" />
                      {borrowAction === 'withdraw' && activePosition && (
                        <span className="field-hint">
                          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                            <input type="checkbox" checked={useMaxWithdraw} onChange={(e) => setUseMaxWithdraw(e.target.checked)} /> MAX (withdraw all)
                          </label>
                        </span>
                      )}
                    </label>
                  )}
                  {(borrowAction === 'borrow' || borrowAction === 'repay' || borrowAction === 'deposit-borrow') && (
                    <label className="field">
                      <span className="field-label">DEBT — {vault?.borrowToken.uiSymbol ?? vault?.borrowToken.symbol}</span>
                      <input value={debtAmount} disabled={useMaxRepay} onChange={(e) => { setDebtAmount(e.target.value.replace(/[^0-9.]/g, '')); setErr(null) }} placeholder="0.0" inputMode="decimal" />
                      {borrowAction === 'repay' && activePosition && (
                        <span className="field-hint">
                          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                            <input type="checkbox" checked={useMaxRepay} onChange={(e) => setUseMaxRepay(e.target.checked)} /> MAX (clear dust — uses MIN_I128)
                          </label>
                        </span>
                      )}
                    </label>
                  )}

                  {positionLtv && activePosition && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div className="stat-row"><span className="sk">LTV NOW</span><span className="sv" style={{ color: positionLtv.health === 'DANGER' ? 'var(--red)' : positionLtv.health === 'WARNING' ? 'var(--amber)' : 'var(--green)' }}>{positionLtv.ltvPct != null ? `${positionLtv.ltvPct.toFixed(1)}%` : '—'} · {positionLtv.health}</span></div>
                      <div className="stat-row"><span className="sk">DEBT</span><span className="sv">{activePosition.borrow !== '0' ? `${formatTokenAmount(fromBaseUnits(activePosition.borrow, vault?.borrowToken.decimals ?? 6), vault?.borrowToken.decimals ?? 6)} ${vault?.borrowToken.uiSymbol ?? vault?.borrowToken.symbol}` : '0 (repaid)'}</span></div>
                    </div>
                  )}
                  {projectedLtvErr && <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>⚠ {projectedLtvErr}</div>}
                  {operateInputErr && ((colAmount.trim() || debtAmount.trim())) && <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>⚠ {operateInputErr}</div>}
                  {wsolInvolved && (
                    <div className="warn-strip" style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                      WSOL vault — wrap SOL into WSOL before depositing; borrows land as WSOL (unwrap yourself).
                    </div>
                  )}

                  <button
                    className="bevel-btn b-lg b-cyan"
                    style={{ width: '100%' }}
                    disabled={!sol.address || !vault || !!operateInputErr || !!projectedLtvErr || phase === 'signing' || phase === 'sending' || phase === 'working'}
                    onClick={() => { setConfirmOpen(true); play('alert') }}
                  >
                    {!sol.address ? 'CONNECT PHANTOM TO BORROW' : phase === 'signing' ? 'SIGNING…' : phase === 'sending' ? 'SENDING…' : phase === 'working' ? 'WORKING…' : `▣ ${borrowAction.toUpperCase().replace('-', '+')} · PREVIEW`}
                  </button>
                  <div className="faint" style={{ fontSize: 14 }}>
                    One operate call per action. New positions use positionId 0 — Jupiter assigns the NFT id.
                  </div>
                </>
              )}
            </div>
          </Panel>

          <Panel
            title="YOUR BORROW POSITIONS — NFTS"
            end={
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span className="t8 dim">{sol.address ? shortAddr(sol.address, 4) : 'OFFLINE'}</span>
                <button className="bevel-btn b-sm" disabled={!sol.address || borrowPosLoading} onClick={() => void loadBorrowPositions()}>
                  {borrowPosLoading ? 'SCANNING…' : '↻ REFRESH'}
                </button>
              </span>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!sol.address ? (
                <div className="state-note">
                  <span className="big">WALLET OFFLINE</span>
                  <button className="bevel-btn b-cyan" onClick={() => (sol.available ? sol.connect().catch(() => play('error')) : openWalletHelp('sol'))}>
                    {sol.available ? 'CONNECT PHANTOM' : 'INSTALL PHANTOM'}
                  </button>
                </div>
              ) : borrowPositions.length === 0 ? (
                <div className="state-note">
                  <span className="big">NO DEBT</span>
                  <span className="faint" style={{ fontSize: 14 }}>Deposit collateral into a vault — your position NFT appears here.</span>
                </div>
              ) : (
                borrowPositions.map((p) => {
                  const v = vaults.find((x) => x.id === p.vaultId)
                  const ltv = v ? computeLtv(v, p.supply, p.borrow) : null
                  return (
                    <div key={`${p.vaultId}-${p.id}`} style={{ border: '2px solid var(--line)', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span className="badge paused" style={{ fontSize: 8 }}>VAULT #{p.vaultId} · NFT #{p.id}</span>
                        {ltv && <span className="faint" style={{ fontSize: 14 }}>LTV {ltv.ltvPct != null ? `${ltv.ltvPct.toFixed(1)}%` : '—'} · {ltv.health}</span>}
                      </div>
                      <div className="stat-row"><span className="sk">COLLATERAL</span><span className="sv">{v ? `${formatTokenAmount(fromBaseUnits(p.supply, v.supplyToken.decimals), v.supplyToken.decimals)} ${v.supplyToken.uiSymbol ?? v.supplyToken.symbol}` : p.supply}</span></div>
                      <div className="stat-row"><span className="sk">DEBT</span><span className="sv">{v ? `${formatTokenAmount(fromBaseUnits(p.borrow, v.borrowToken.decimals), v.borrowToken.decimals)} ${v.borrowToken.uiSymbol ?? v.borrowToken.symbol}` : p.borrow}{p.dustBorrow && p.dustBorrow !== '0' ? ' (+dust)' : ''}</span></div>
                      {p.isLiquidated && <div className="warn-strip" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>LIQUIDATED</div>}
                      <button className="bevel-btn b-sm" onClick={() => { setVaultId(p.vaultId); setPositionId(p.id); setBorrowAction(p.borrow !== '0' ? 'repay' : 'borrow'); play('click') }}>
                        MANAGE THIS →
                      </button>
                    </div>
                  )
                })
              )}
              <div className="faint" style={{ fontSize: 13 }}>
                Positions: <code style={{ fontSize: 12 }}>GET /borrow/positions?users=</code> · debt accrues interest until repaid.
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* shared telemetry / errors / tx */}
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
      {(phase === 'working' || phase === 'sending' || phase === 'confirming') && (
        <div className="blocks" style={{ textAlign: 'center' }}>
          {blocks((Date.now() / 3000) % 1, 22)}
        </div>
      )}
      {txSig && (
        <div className="stat-row">
          <span className="sk">LAST TX</span>
          <span className="sv"><a href={explorerTxUrl(txSig)} target="_blank" rel="noreferrer" style={{ color: 'var(--cyan)' }}>{shortAddr(txSig, 8)} ↗</a></span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="bevel-btn b-lg b-cyan" onClick={() => nav('/')}>◀ BACK TO DESKTOP</button>
        <a className="bevel-btn b-sm" href="https://developers.jup.ag/docs/lend" target="_blank" rel="noreferrer">LEND DOCS ↗</a>
      </div>

      {/* confirm */}
      {confirmOpen && (
        <SystemDialog
          title={tab === 'earn' ? 'CONFIRM EARN — WALLET WILL SIGN ONCE' : 'CONFIRM OPERATE — WALLET WILL SIGN ONCE'}
          onClose={() => setConfirmOpen(false)}
          actions={
            <>
              <button className="bevel-btn" onClick={() => setConfirmOpen(false)}>✕ CANCEL</button>
              <button className="bevel-btn b-danger" onClick={() => (tab === 'earn' ? submitEarn() : submitBorrow())}>✓ CONFIRM &amp; SIGN</button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tab === 'earn' && earnToken ? (
              <>
                <div className="stat-row"><span className="sk">ACTION</span><span className="sv">{earnAction.toUpperCase()} {earnToken.asset.symbol}</span></div>
                <div className="stat-row"><span className="sk">AMOUNT</span><span className="sv">{earnAmount} {earnToken.asset.symbol}</span></div>
                <div className="stat-row"><span className="sk">APY</span><span className="sv">{formatRatePct(earnToken.totalRate)}</span></div>
              </>
            ) : vault ? (
              <>
                <div className="stat-row"><span className="sk">VAULT</span><span className="sv">#{vault.id} {vault.supplyToken.uiSymbol ?? vault.supplyToken.symbol} → {vault.borrowToken.uiSymbol ?? vault.borrowToken.symbol}</span></div>
                <div className="stat-row"><span className="sk">ACTION</span><span className="sv">{borrowAction.toUpperCase().replace('-', '+')}</span></div>
                <div className="stat-row"><span className="sk">POSITION</span><span className="sv">{activePosition ? `NFT #${activePosition.id}` : 'NEW (id 0 → assigned)'}</span></div>
                {(borrowAction === 'deposit' || borrowAction === 'withdraw' || borrowAction === 'deposit-borrow') && (
                  <div className="stat-row"><span className="sk">COLLATERAL Δ</span><span className="sv">{useMaxWithdraw && borrowAction === 'withdraw' ? 'MAX (all)' : `${colAmount} ${vault.supplyToken.uiSymbol ?? vault.supplyToken.symbol}`}</span></div>
                )}
                {(borrowAction === 'borrow' || borrowAction === 'repay' || borrowAction === 'deposit-borrow') && (
                  <div className="stat-row"><span className="sk">DEBT Δ</span><span className="sv">{useMaxRepay && borrowAction === 'repay' ? 'MAX (clear dust)' : `${debtAmount} ${vault.borrowToken.uiSymbol ?? vault.borrowToken.symbol}`}</span></div>
                )}
                <div className="stat-row"><span className="sk">MAX LTV</span><span className="sv">{formatFactorPct(vault.collateralFactor)}</span></div>
              </>
            ) : null}
            <div className="stat-row"><span className="sk">WALLET</span><span className="sv">{sol.address ? shortAddr(sol.address, 6) : '—'}</span></div>
            <div className="faint" style={{ fontSize: 14 }}>After CONFIRM, your wallet opens — approve there. Nothing is submitted until you sign.</div>
          </div>
        </SystemDialog>
      )}

      {/* success */}
      {successOpen && txSig && (
        <SystemDialog
          title="LEND COMPLETE"
          onClose={() => setSuccessOpen(false)}
          actions={
            <>
              <a className="bevel-btn b-sm" href={explorerTxUrl(txSig)} target="_blank" rel="noreferrer">VIEW ON SOLSCAN ↗</a>
              <button className="bevel-btn b-cyan" onClick={() => { setSuccessOpen(false); setEarnAmount(''); setColAmount(''); setDebtAmount('') }}>✓ NICE — CONTINUE</button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="stat-row"><span className="sk">STATUS</span><span className="sv up">{successLabel || 'TRANSACTION LANDED'}</span></div>
            <div className="stat-row"><span className="sk">TX</span><span className="sv mono-addr">{shortAddr(txSig, 8)}</span></div>
            <div className="faint" style={{ fontSize: 14 }}>Positions refreshed above — verify on Solscan any time.</div>
          </div>
        </SystemDialog>
      )}
    </div>
  )
}
