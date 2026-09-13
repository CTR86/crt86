import { useState } from 'react'
import { useCreatorLaunches, usePrepareFeeClaim, useSubmitFeeClaim, useTokenFees } from '../hooks/stonk'
import { SfError } from '../lib/stonkfun'
import { useSolanaWallet } from '../wallets/SolanaWallet'
import { CoinRain, CopyBtn, Panel, Readout, TokenLogo } from '../design/ui'
import { shortAddr } from '../lib/format'
import { play } from '../sound/sfx'
import { useUi } from '../store/ui'

/* ============================================================
   FEE VAULT — claim creator fees (Solana / StonkFun).
   Flow: prepare (unsigned claim tx, 90s validity) -> your wallet
   signs -> submit with intentId (platform broadcasts; idempotent).
   Only the wallet holding the launch's Fee Key NFT can claim.
   ============================================================ */

function ClaimRow({ mint }: { mint: string }) {
  const { address, signBase64 } = useSolanaWallet()
  const openWalletHelp = useUi((s) => s.openWalletHelp)
  const fees = useTokenFees(mint)
  const prepare = usePrepareFeeClaim()
  const submit = useSubmitFeeClaim()
  const [phase, setPhase] = useState<'idle' | 'signing' | 'submitting' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState<string | null>(null)
  const [raining, setRaining] = useState(false)

  const claimable = fees.data?.claimable
  const reason = fees.data?.reason

  const claim = async () => {
    if (!address) return
    setMsg(null)
    try {
      setPhase('signing')
      const p = await prepare.mutateAsync({ mint, creatorWallet: address })
      const txB64 = (p as { transaction?: string; unsignedTransaction?: string }).transaction ?? (p as { unsignedTransaction?: string }).unsignedTransaction
      const intentId = (p as { intentId?: string }).intentId
      if (!txB64 || !intentId) throw new Error('Prepare returned no transaction/intentId')
      setPhase('submitting')
      const { signedB64 } = await signBase64(txB64)
      await submit.mutateAsync({ mint, creatorWallet: address, intentId, signedTransaction: signedB64 })
      setPhase('done')
      setRaining(true)
      play('coin')
      setTimeout(() => setRaining(false), 3500)
      void fees.refetch()
    } catch (e) {
      play('error')
      setPhase('error')
      setMsg(e instanceof SfError ? `${e.code}: ${e.message}` : String((e as Error).message ?? e))
    }
  }

  const busy = phase === 'signing' || phase === 'submitting'

  return (
    <div style={{ position: 'relative', border: '2px solid var(--line-soft)', padding: 10, borderRadius: 4, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      {raining && <CoinRain />}
      <TokenLogo symbol={mint.slice(0, 3)} size={30} />
      <div style={{ flex: 1, minWidth: 160 }}>
        <div className="t9">{fees.data?.creator ? `CREATOR ${shortAddr(fees.data.creator, 4)}` : shortAddr(mint, 6)} <CopyBtn text={mint} label="⧉" /></div>
        {claimable ? (
          <div className="dim" style={{ fontSize: 16 }}>
            {Object.entries(claimable).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') || 'claimable balance available'}
          </div>
        ) : (
          <div className="faint" style={{ fontSize: 15 }}>{reason ?? 'NO CLAIMABLE DATA'}</div>
        )}
      </div>
      {claimable ? (
        <button className="bevel-btn b-sm b-amber" disabled={!address || busy} onClick={() => void claim()}>
          {phase === 'signing' ? 'SIGN…' : phase === 'submitting' ? 'SUBMIT…' : phase === 'done' ? '✓ COLLECTED' : '◎ COLLECT COINS'}
        </button>
      ) : (
        <button className="bevel-btn b-sm" onClick={() => !address && openWalletHelp('sol')}>
          {fees.isLoading ? 'SCANNING…' : address ? 'NOTHING TO CLAIM' : 'CONNECT WALLET'}
        </button>
      )}
      {msg && <div className="faint" style={{ width: '100%', color: 'var(--red)', fontSize: 15 }}>{msg}</div>}
    </div>
  )
}

export function FeeVault() {
  const { address, connect, available } = useSolanaWallet()
  const openWalletHelp = useUi((s) => s.openWalletHelp)
  const launches = useCreatorLaunches(address)
  const [mintInput, setMintInput] = useState('')
  const [manualMint, setManualMint] = useState<string | null>(null)

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">◤ FEE VAULT</h1>
        <span className="page-sub">COLLECT YOUR CREATOR FEES · SOLANA</span>
      </div>

      {!address ? (
        <Panel title="VAULT SEALED">
          <div className="state-note">
            <span className="big">INSERT CREATOR WALLET</span>
            <button className="bevel-btn b-cyan b-lg" onClick={() => (available ? connect().catch(() => play('error')) : openWalletHelp('sol'))}>
              {available ? '► CONNECT SOLANA WALLET' : '⬇ INSTALL SOL WALLET'}
            </button>
            <div className="faint" style={{ marginTop: 10, fontSize: 15 }}>
              Only the wallet holding a launch's Fee Key NFT can claim its fees. Reward coins pay holders directly via
              transfer tax — there is nothing to claim for those.
            </div>
          </div>
        </Panel>
      ) : (
        <div className="grid-2">
          <Panel title="YOUR LAUNCHES" end={launches.data ? `${launches.data.launches?.length ?? 0} found` : '…'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(launches.data?.launches ?? [])
                .filter((l) => typeof l.mint === 'string' && l.mint.length >= 32)
                .map((l, i) => (
                  <ClaimRow key={(l.mint ?? '') + i} mint={(l.mint as string) ?? ''} />
                ))}
              {launches.isLoading && <div className="state-note"><span className="big">SCANNING LEDGER…</span></div>}
              {launches.data && (launches.data.launches?.length ?? 0) === 0 && (
                <div className="state-note">
                  <span className="big">NO LAUNCHES ON FILE</span>
                  this wallet hasn't launched any coins yet — visit the LAUNCH DECK
                </div>
              )}
            </div>
          </Panel>

          <Panel title="MANUAL SCAN">
            <p className="dim" style={{ marginTop: 0 }}>
              Claim fees for any mint this wallet created. The terminal reads live claimable totals from the StonkFun
              wire, then runs the sign → submit → idempotent claim flow.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={mintInput}
                onChange={(e) => setMintInput(e.target.value)}
                placeholder="PASTE TOKEN MINT…"
                style={{ flex: 1 }}
              />
              <button className="bevel-btn b-sm b-cyan" disabled={mintInput.length < 32} onClick={() => { setManualMint(mintInput.trim()); play('click') }}>
                SCAN
              </button>
            </div>
            {manualMint && (
              <div style={{ marginTop: 12 }}>
                <ClaimRow mint={manualMint} />
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <Readout
                label="HOW CLAIMS WORK"
                tone="cyan"
                value="SIGN → SUBMIT → BROADCAST"
                sub="claim tx valid 90s · intentId makes retries idempotent (alreadySubmitted:true)"
              />
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}
