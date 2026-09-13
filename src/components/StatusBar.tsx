import { useEffect, useState } from 'react'
import { publicClient } from '../lib/prm/chain'
import { useStats } from '../hooks/stonk'
import { useSolPrice } from '../hooks/useSolPrice'
import { useSettings } from '../store/settings'
import { LedDot } from '../design/ui'
import { RH_ENABLED } from '../config'

export function StatusBar() {
  const { data: stats } = useStats()
  const { effects, sound, night } = useSettings()
  const { data: solPrice } = useSolPrice()
  const [block, setBlock] = useState<bigint | null>(null)

  useEffect(() => {
    if (!RH_ENABLED) return
    let alive = true
    const tick = () =>
      publicClient()
        .getBlockNumber()
        .then((b) => alive && setBlock(b))
        .catch(() => {})
    void tick()
    const iv = setInterval(tick, 12_000)
    return () => {
      alive = false
      clearInterval(iv)
    }
  }, [])

  return (
    <footer className="status-bar">
      <span className="sb-item">
        <LedDot color="green" solid={!!stats} off={!stats} /> SOL: {stats?.network ?? 'LINKING…'}
        {solPrice != null && (
          <span style={{ color: 'var(--green)', textShadow: 'var(--glow-green)' }}>
            {' '}
            · ${solPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
      </span>
      {RH_ENABLED && (
        <span className="sb-item">
          <LedDot color="pink" solid={block != null} off={block == null} /> RH-CHAIN 4663 · BLK {block ?? '····'}
        </span>
      )}
      <span className="sb-item">SOL TOKENS: {stats ? stats.tokens.total.toLocaleString() : '…'}</span>
      <span className="sb-item" style={{ marginLeft: 'auto' }}>
        CRT {effects ? 'ON' : 'OFF'} · SFX {sound ? 'ON' : 'OFF'} · {night ? '☾ NIGHT' : 'COLOR'}
      </span>
      <span className="sb-item faint">📱 MOBILE UI</span>
      <span className="sb-item faint">© 1986 CRT86 SYSTEMS</span>
    </footer>
  )
}
