import { useEffect, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import { readContract } from 'viem/actions'
import { publicClient } from '../lib/prm/chain'
import { ERC20_ABI } from '../lib/prm/abis'
import { useEvmWallet } from '../wallets/EvmWallet'
import { useSolanaWallet } from '../wallets/SolanaWallet'
import { useCreatorLaunches, useTokenDetail } from '../hooks/stonk'
import { useMemePage, useStockPage } from '../hooks/prm'
import { Panel, Readout, StatusBadge, TokenLogo } from '../design/ui'
import { fmtEth, fmtPrice, fmtUsd, shortAddr } from '../lib/format'
import { play } from '../sound/sfx'
import { RH_ENABLED } from '../config'
import { useUi } from '../store/ui'

function SolLaunch({ mint }: { mint: string }) {
  const { data: t } = useTokenDetail(mint)
  if (!t) return null
  return (
    <div className="stat-row">
      <span className="sk" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <TokenLogo src={t.imageUrl} symbol={t.symbol.slice(0, 2)} size={20} /> {t.symbol}
      </span>
      <span className="sv">
        <StatusBadge status={t.status} /> ${fmtPrice(t.market.priceUsd)} · {fmtUsd(t.market.marketCapUsd)}
      </span>
    </div>
  )
}

export function Portfolio() {
  const sol = useSolanaWallet()
  const evm = useEvmWallet()
  const openWalletHelp = useUi((s) => s.openWalletHelp)

  const launches = useCreatorLaunches(sol.address)
  const memes = useMemePage(1, 16, RH_ENABLED)
  const stocks = useStockPage(1, 16, RH_ENABLED)

  const [ethBal, setEthBal] = useState<bigint | null>(null)
  const [positions, setPositions] = useState<Array<{ symbol: string; kind: 'meme' | 'stock'; token: string; balance: bigint; decimals: number; priceEth: number | null }>>([])
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    if (!evm.address) return setEthBal(null)
    void publicClient().getBalance({ address: evm.address }).then(setEthBal).catch(() => setEthBal(null))
  }, [evm.address, evm.chainId])

  const scan = async () => {
    if (!evm.address) return
    setScanning(true)
    play('click')
    try {
      const found: typeof positions = []
      const lists = [
        ...(memes.data ?? []).map((m) => ({ kind: 'meme' as const, token: m.token, symbol: m.symbol, decimals: m.decimals, priceEth: m.priceEth })),
        ...(stocks.data ?? []).map((s) => ({ kind: 'stock' as const, token: s.deskToken, symbol: s.symbol, decimals: s.decimals, priceEth: s.priceEth })),
      ]
      const results = await Promise.all(
        lists.map(async (l) => {
          try {
            const b = (await readContract(publicClient(), {
              address: l.token as Address,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [evm.address as Address],
            })) as bigint
            return b > 0n ? { ...l, balance: b } : null
          } catch {
            return null
          }
        }),
      )
      for (const r of results) if (r) found.push(r)
      setPositions(found)
      if (found.length) play('coin')
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">◤ PILOT DOSSIER</h1>
        <span className="page-sub">{RH_ENABLED ? 'BOTH WALLETS, ONE FILE' : 'SOLANA DOSSIER'}</span>
      </div>

      <div className="grid-2" style={!RH_ENABLED ? { gridTemplateColumns: '1fr' } : undefined}>
        {/* Solana side */}
        <Panel title={RH_ENABLED ? 'TAPE A · SOLANA' : 'SOLANA WALLET'} end={<span className="t8" style={{ color: sol.address ? 'var(--green)' : 'var(--text-faint)' }}>{sol.address ? shortAddr(sol.address, 6) : 'OFFLINE'}</span>}>
          {sol.address ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="grid-2" style={{ gap: 10 }}>
                <Readout label="SOL BALANCE" tone="cyan" value={sol.balanceSol != null ? sol.balanceSol.toFixed(4) : '…'} sub="mainnet-beta" />
                <Readout label="LAUNCHES CREATED" tone="pink" value={launches.data ? String(launches.data.launches?.length ?? 0) : '…'} />
              </div>
              <div>
                <div className="t8 dim" style={{ marginBottom: 6 }}>◈ LAUNCH LEDGER (LIVE)</div>
                {(launches.data?.launches ?? []).slice(0, 8).map((l, i) => (
                  <SolLaunch key={(l.mint ?? '') + i} mint={(l.mint as string) ?? ''} />
                ))}
                {launches.data && (launches.data.launches?.length ?? 0) === 0 && (
                  <div className="state-note">no launches yet — the LAUNCH DECK awaits, pilot</div>
                )}
              </div>
            </div>
          ) : (
            <div className="state-note">
              <span className="big">{RH_ENABLED ? 'TAPE A EMPTY' : 'NO WALLET LOADED'}</span>
              <button className="bevel-btn b-cyan" onClick={() => (sol.available ? sol.connect().catch(() => play('error')) : openWalletHelp('sol'))}>
                {sol.available ? 'CONNECT SOLANA WALLET' : '⬇ INSTALL SOL WALLET'}
              </button>
            </div>
          )}
        </Panel>

        {/* EVM side */}
        {RH_ENABLED && (
          <Panel
            title="TAPE B · RH-CHAIN"
          end={
            evm.address ? (
              <button className="bevel-btn b-sm" disabled={scanning} onClick={() => void scan()}>
                {scanning ? 'SCANNING…' : 'SCAN POSITIONS'}
              </button>
            ) : null
          }
        >
          {evm.address ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Readout label="ETH BALANCE" tone="amber" value={ethBal != null ? fmtEth(ethBal) : '…'} sub="Robinhood Chain · 4663" />
              <div>
                <div className="t8 dim" style={{ marginBottom: 6 }}>◈ SCANNED POSITIONS (first 32 assets)</div>
                {positions.length === 0 && <div className="faint" style={{ fontSize: 16 }}>no positions found in the scanned window — or run a fresh SCAN</div>}
                {positions.map((p) => (
                  <div key={p.token} className="stat-row">
                    <span className="sk" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <TokenLogo symbol={p.symbol.slice(0, 2)} size={20} /> {p.symbol}
                      <span className="badge dim">{p.kind.toUpperCase()}</span>
                    </span>
                    <span className="sv">
                      {formatUnits(p.balance, p.decimals)} {p.priceEth != null ? `· ≈ Ξ${fmtPrice(Number(p.balance) / 10 ** p.decimals * p.priceEth)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
              <div className="faint" style={{ fontSize: 15 }}>
                Scan reads the newest meme/stock directories and checks your balance on each. Positions outside the
                first 32 assets aren't listed.
              </div>
            </div>
          ) : (
            <div className="state-note">
              <span className="big">TAPE B EMPTY</span>
              <button className="bevel-btn b-pink" onClick={() => (evm.available ? evm.connect().catch(() => play('error')) : openWalletHelp('evm'))}>
                {evm.available ? 'CONNECT EVM WALLET' : '⬇ INSTALL EVM WALLET'}
              </button>
            </div>
          )}
          </Panel>
        )}
      </div>
    </div>
  )
}
