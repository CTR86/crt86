/* ============================================================
   Live venue feeds for PERP.EXE — public WebSockets, no auth for
   market data (user streams need only the account address, except
   Aster which uses a signed listenKey). Every socket has
   auto-reconnect with backoff and degrades to REST polling on
   failure — a dead socket never blocks trading.
   Hosts verified: Aster mainnet wss://fstream.asterdex.com,
   testnet wss://fstream5.asterdex-testnet.com (official docs);
   HL wss://api.hyperliquid[-testnet].xyz/ws (REST verified live,
   WS same host pattern with REST fallback).
   ============================================================ */

import { useEffect, useRef } from 'react'
import type { PerpNetwork } from './types'

const HL_WS: Record<PerpNetwork, string> = {
  mainnet: 'wss://api.hyperliquid.xyz/ws',
  testnet: 'wss://api.hyperliquid-testnet.xyz/ws',
}

const ASTER_WS: Record<PerpNetwork, string> = {
  mainnet: 'wss://fstream.asterdex.com/ws',
  testnet: 'wss://fstream5.asterdex-testnet.com/ws',
}

function useSocket(url: string | null, onMessage: (data: unknown) => void, onState: (up: boolean) => void) {
  const msgRef = useRef(onMessage)
  msgRef.current = onMessage
  const stateRef = useRef(onState)
  stateRef.current = onState

  useEffect(() => {
    if (!url) {
      stateRef.current(false)
      return
    }
    let dead = false
    let ws: WebSocket | null = null
    let attempt = 0
    let timer: number | null = null

    const connect = () => {
      if (dead) return
      try {
        ws = new WebSocket(url)
      } catch {
        schedule()
        return
      }
      ws.onopen = () => {
        if (dead) return
        attempt = 0
        stateRef.current(true)
      }
      ws.onmessage = (ev) => {
        if (dead) return
        try {
          msgRef.current(JSON.parse(String(ev.data)))
        } catch {
          /* ignore malformed frames */
        }
      }
      const down = () => {
        if (dead) return
        stateRef.current(false)
        schedule()
      }
      ws.onclose = down
      ws.onerror = () => {
        try {
          ws?.close()
        } catch {
          /* ignore */
        }
      }
    }
    const schedule = () => {
      if (dead) return
      attempt += 1
      const wait = Math.min(3000 * attempt, 30000)
      timer = window.setTimeout(connect, wait)
    }

    connect()
    return () => {
      dead = true
      if (timer != null) window.clearTimeout(timer)
      try {
        ws?.close()
      } catch {
        /* ignore */
      }
      stateRef.current(false)
    }
  }, [url])
}

/* ---------- Hyperliquid: allMids + userEvents ---------- */

export function hlWsUrl(net: PerpNetwork): string {
  return HL_WS[net]
}

export function useHlLive(args: {
  net: PerpNetwork
  user: string | null
  onMids: (mids: Record<string, number>) => void
  onUserEvent: () => void
  onState: (up: boolean) => void
}): void {
  const { net, user } = args
  const cbRef = useRef(args)
  cbRef.current = args
  // allMids is one multiplexed socket; userEvents needs its own connection
  // because HL closes sockets on malformed frames — keep them isolated.
  useSocket(
    hlWsUrl(net),
    (j) => {
      const m = j as { channel?: string; data?: { mids?: Record<string, string> } }
      if (m?.channel === 'allMids' && m.data?.mids) {
        const out: Record<string, number> = {}
        for (const [k, v] of Object.entries(m.data.mids)) {
          const n = Number(v)
          if (isFinite(n)) out[k] = n
        }
        cbRef.current.onMids(out)
      }
    },
    (up) => cbRef.current.onState(up),
  )
  useEffect(() => {
    if (!user) return
    let dead = false
    let ws: WebSocket | null = null
    try {
      ws = new WebSocket(hlWsUrl(net))
    } catch {
      return
    }
    ws.onopen = () => {
      if (dead) return
      ws?.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'userEvents', user } }))
    }
    ws.onmessage = (ev) => {
      if (dead) return
      try {
        const j = JSON.parse(String(ev.data)) as { channel?: string }
        if (j?.channel === 'userEvents') cbRef.current.onUserEvent()
      } catch {
        /* ignore */
      }
    }
    return () => {
      dead = true
      try {
        ws?.close()
      } catch {
        /* ignore */
      }
    }
  }, [net, user])
}

/* ---------- Aster: markPrice stream + user data via listenKey ---------- */

export function asterWsUrl(net: PerpNetwork): string {
  return ASTER_WS[net]
}

export function useAsterLive(args: {
  net: PerpNetwork
  symbol: string | null
  listenKey: string | null
  onMark: (symbol: string, mark: number, funding: number | null) => void
  onUserEvent: () => void
  onState: (up: boolean) => void
}): void {
  const cbRef = useRef(args)
  cbRef.current = args
  const { net, symbol, listenKey } = args
  useSocket(
    symbol ? `${asterWsUrl(net)}/${symbol.toLowerCase()}@markPrice` : null,
    (j) => {
      const m = j as { e?: string; s?: string; p?: string; r?: string }
      if (m?.e === 'markPriceUpdate' && m.s) {
        const mark = Number(m.p)
        const funding = m.r != null ? Number(m.r) : NaN
        if (isFinite(mark)) cbRef.current.onMark(m.s, mark, isFinite(funding) ? funding : null)
      }
    },
    (up) => cbRef.current.onState(up),
  )
  useSocket(
    listenKey ? `${asterWsUrl(net)}/${listenKey}` : null,
    (j) => {
      const m = j as { e?: string }
      if (m && typeof m.e === 'string' && (m.e === 'ORDER_TRADE_UPDATE' || m.e === 'ACCOUNT_UPDATE')) {
        cbRef.current.onUserEvent()
      }
    },
    () => {},
  )
}
