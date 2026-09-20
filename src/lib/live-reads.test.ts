/* Live public-read integration — no keys, no wallets, no signatures.
   Verifies venue read paths against real testnets/APIs. These touch the
   network (30s timeouts); a failure means the upstream moved, not that
   parsing broke (parsing is unit-tested elsewhere). */
import { describe, expect, it } from 'vitest'

async function getJson(url: string, timeoutMs = 25_000): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`)
  return r.json()
}

describe('hyperliquid testnet reads', () => {
  it(
    'meta returns the perp universe',
    async () => {
      const r = await fetch('https://api.hyperliquid-testnet.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'meta' }),
        signal: AbortSignal.timeout(25_000),
      })
      expect(r.ok).toBe(true)
      const meta = (await r.json()) as { universe: Array<{ name: string; szDecimals: number }> }
      expect(meta.universe.length).toBeGreaterThan(100)
      const btc = meta.universe.find((u) => u.name === 'BTC')
      expect(btc).toBeDefined()
    },
    30_000,
  )
})

describe('aster testnet reads', () => {
  it(
    'exchangeInfo returns trading perpetuals',
    async () => {
      const j = (await getJson('https://fapi.asterdex-testnet.com/fapi/v3/exchangeInfo')) as {
        symbols: Array<{ symbol: string; status: string; contractType: string }>
      }
      const live = j.symbols.filter((s) => s.status === 'TRADING' && s.contractType === 'PERPETUAL')
      // testnet lists a small subset (mainnet has 600+)
      expect(live.length).toBeGreaterThan(5)
      expect(live.some((s) => s.symbol === 'BTCUSDT')).toBe(true)
    },
    30_000,
  )
})

describe('stonkfun public reads', () => {
  it(
    'tokens endpoint returns a list',
    async () => {
      const j = (await getJson('https://www.stonkfun.xyz/api/public/v1/tokens?limit=5')) as unknown
      expect(Array.isArray(j) || (j !== null && typeof j === 'object')).toBe(true)
    },
    30_000,
  )
})
