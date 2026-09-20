import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Panel } from '../design/ui'

const QA: { q: string; a: string }[] = [
  {
    q: 'WHAT IS CRT86?',
    a: 'A retro 80s computer-styled trading OS on Solana + EVM. One CRT terminal: coin launcher (StonkFun, Ember), swaps (Jupiter, Uniswap, PancakeSwap), perps (Hyperliquid, Aster), bridge, stocks, market wire, games.',
  },
  {
    q: 'HOW DO I LAUNCH A COIN?',
    a: 'Desktop → double-click LAUNCHPAD.EXE → LAUNCH DECK → pick an engine (StonkFun or Ember) → fill the mission plan → get a fuel quote → IGNITION → approve in your wallet. Your coin goes live on the curve.',
  },
  {
    q: 'WHICH WALLETS WORK?',
    a: 'Any Solana wallet: Phantom (recommended), Solflare, Backpack. The wallet bay in the header lights up when detected. EVM wallets (MetaMask etc.) for swaps, bridge and Hyperliquid perps. The RH-CHAIN trading module is flag-gated for now.',
  },
  {
    q: 'WHAT DOES IT COST?',
    a: 'Engine fees are set by the platforms and shown BEFORE you sign. StonkFun: 0.2904 SOL flat launch fee. Ember: ~$4,000 opening liquidity in the pair token (your capital — it stays in the pool and earns your fee share). CRT-DOS adds nothing on top. Network rent is ~0.001 SOL.',
  },
  {
    q: 'IS IT SAFE?',
    a: 'Non-custodial: every transaction is signed by YOUR wallet and your keys never leave it. Launch costs and warnings are shown before signing. If your balance is short, your wallet — not us — rejects it.',
  },
  {
    q: 'CREATOR FEES? HOW DO I EARN?',
    a: 'StonkFun fee coins: the 2% tier routes 1.5% of every trade to you — claim it in FEE VAULT. Ember: 80% of pool fees are routed your way (Keep / Split / Holders modes) every 15 minutes automatically.',
  },
  {
    q: 'MULTICHAIN?',
    a: 'Solana first — launchpad and markets are live. RH-CHAIN (EVM) trading, more engines and bridges are on the roadmap. The OS is built modular, so new chains plug in as new .EXE files.',
  },
  {
    q: 'WHY THE 80s?',
    a: 'Because degen trading deserves a CRT. Also phosphor glow hides our UI bugs.',
  },
]

/* FAQ.TXT — retro notepad window */
export function FaqWindow() {
  const nav = useNavigate()
  const [open, setOpen] = useState<number | null>(0)

  return (
    <div className="page">
      <Panel title="FAQ.TXT — CRT-DOS NOTEPAD" end={<span className="pt-end">FILE · EDIT · SEARCH · HELP</span>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {QA.map((item, i) => {
            const isOpen = open === i
            return (
              <div key={i} style={{ borderBottom: '1px dashed var(--line-soft)' }}>
                <button
                  className="bevel-btn b-sm"
                  style={{ width: '100%', textAlign: 'left', border: 'none', boxShadow: 'none', background: isOpen ? 'rgba(255,42,109,0.08)' : 'transparent', display: 'flex', gap: 10, alignItems: 'baseline' }}
                  onClick={() => {
                    setOpen(isOpen ? null : i)
                  }}
                >
                  <span style={{ color: 'var(--pink)' }}>{isOpen ? '▾' : '▸'}</span>
                  <span className="t9" style={{ color: 'var(--cyan)', textShadow: 'var(--glow-cyan)', whiteSpace: 'normal' }}>
                    {item.q}
                  </span>
                </button>
                {isOpen && (
                  <div style={{ padding: '4px 12px 14px 34px', fontSize: 19, lineHeight: 1.45 }}>{item.a}</div>
                )}
              </div>
            )
          })}
        </div>
      </Panel>

      <div className="warn-strip">
        <span>📄</span>
        <span>END OF FILE — 8 RECORDS. Press ◀ BACK TO DESKTOP when done reading, pilot.</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button className="bevel-btn b-lg b-cyan" onClick={() => nav('/')}>
          ◀ BACK TO DESKTOP
        </button>
      </div>
    </div>
  )
}
