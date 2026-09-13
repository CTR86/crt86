import { SystemDialog } from './SystemDialog'
import { useUi } from '../store/ui'
import { useSettings } from '../store/settings'
import { play } from '../sound/sfx'

/* Shown when a connect button is pressed but no wallet extension is installed. */
export function WalletHelpDialog() {
  const { walletHelp, closeWalletHelp } = useUi()
  const { setSound } = useSettings()

  if (!walletHelp) return null

  const isSol = walletHelp === 'sol'
  return (
    <SystemDialog title="WALLET NOT DETECTED" onClose={closeWalletHelp}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="t10" style={{ color: 'var(--amber)', textShadow: 'var(--glow-amber)' }}>
          {isSol ? 'NO SOLANA WALLET IN THIS BROWSER' : 'NO EVM WALLET IN THIS BROWSER'}
        </div>
        <p style={{ margin: 0 }}>
          This terminal runs entirely in your browser — no server signup. To launch coins
          {isSol ? '' : ' and trade on RH-CHAIN'}, install a wallet extension first, then reload
          this page:
        </p>
        {isSol ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <a className="bevel-btn b-cyan" href="https://phantom.app/download" target="_blank" rel="noreferrer">
              ⬇ INSTALL PHANTOM (RECOMMENDED) ↗
            </a>
            <a className="bevel-btn" href="https://solflare.com/download" target="_blank" rel="noreferrer">
              ⬇ INSTALL SOLFLARE ↗
            </a>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <a className="bevel-btn b-pink" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
              ⬇ INSTALL METAMASK ↗
            </a>
          </div>
        )}
        <ol style={{ margin: '4px 0 0', paddingLeft: 22, lineHeight: 1.5 }} className="dim">
          <li>Install the extension and create/import a wallet</li>
          <li>Load it with a little SOL (for launch fees)</li>
          <li>Reload this tab — the wallet bay will light up</li>
        </ol>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="bevel-btn b-sm" onClick={() => { setSound(true); location.reload() }}>
            ⟳ I INSTALLED — RELOAD
          </button>
          <button className="bevel-btn b-sm" onClick={() => { closeWalletHelp(); play('click') }}>
            CLOSE
          </button>
        </div>
      </div>
    </SystemDialog>
  )
}
