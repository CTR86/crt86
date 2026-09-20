// /api/uniswap — same-origin Uniswap Trading API proxy. The server
// injects x-api-key so the browser bundle never carries the secret.
// Verified against the official OpenAPI spec
// (https://trade-api.gateway.uniswap.org/v1/api.json):
//   GET  /api/uniswap?op=status           → { configured, mode, gateway }
//   GET  /api/uniswap?op=chains           → upstream /v1/supported_chains
//   POST /api/uniswap?op=quote            → upstream POST /v1/quote
//   POST /api/uniswap?op=swap             → upstream POST /v1/swap
// Env: UNISWAP_API_KEY (server, never VITE_).
//      UNISWAP_API_BASE (optional override, defaults to the official gateway).
// Never logs the key, never returns it. Upstream errors are passed
// through honestly — never fabricated.

const DEFAULT_BASE = 'https://trade-api.gateway.uniswap.org/v1'

function base() {
  return (process.env.UNISWAP_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, '')
}

function apiKey() {
  return (process.env.UNISWAP_API_KEY || '').trim()
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    return null
  }
}

const HEX40 = /^0x[0-9a-fA-F]{40}$/

function errMsg(text, status) {
  if (text) {
    try {
      const j = JSON.parse(text)
      const m = j?.message || j?.error?.message || j?.error || j?.detail
      if (m) return String(m).slice(0, 300)
    } catch {
      return text.slice(0, 300)
    }
  }
  return `UNISWAP API HTTP ${status}`
}

async function upstream(res, p, init, timeoutMs) {
  let r
  try {
    r = await fetch(`${base()}${p}`, {
      ...init,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-api-key': apiKey(), ...(init.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    send(res, 502, { message: 'UNISWAP API UNREACHABLE — ' + String(e.message || e).slice(0, 160) })
    return
  }
  const text = await r.text().catch(() => '')
  if (!r.ok) {
    const msg = errMsg(text, r.status)
    const hint =
      r.status === 401
        ? ' (key rejected — check UNISWAP_API_KEY)'
        : r.status === 429
          ? ' (rate-limited — retry in a bit)'
          : ''
    send(res, r.status, { message: (msg + hint).slice(0, 400) })
    return
  }
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(text || '{}')
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', 'http://local')
    const op = url.searchParams.get('op') || ''
    const method = (req.method || 'GET').toUpperCase()

    if (method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    if (method === 'GET' && (op === 'status' || op === '')) {
      const ok = apiKey().length > 0
      send(res, 200, {
        configured: ok,
        mode: ok ? 'api' : 'onchain',
        gateway: ok ? base() : 'onchain QuoterV2 + SwapRouter02 (no API key configured)',
      })
      return
    }

    if (!apiKey()) {
      send(res, 501, {
        message: 'UNISWAP API NOT CONFIGURED — missing UNISWAP_API_KEY in server env. UNISWAP.EXE uses on-chain quotes.',
      })
      return
    }

    if (method === 'GET' && op === 'chains') {
      await upstream(res, '/supported_chains', { method: 'GET' }, 15_000)
      return
    }

    if (method === 'POST' && op === 'quote') {
      const body = await readJson(req)
      if (!body) {
        send(res, 400, { message: 'INVALID JSON BODY' })
        return
      }
      const chainId = Number(body.chainId)
      const tokenIn = String(body.tokenIn || '').trim()
      const tokenOut = String(body.tokenOut || '').trim()
      const amount = String(body.amount || '').trim()
      const swapper = String(body.swapper || '').trim()
      const slippageBps = body.slippageBps == null ? 50 : Number(body.slippageBps)
      if (!Number.isInteger(chainId) || chainId <= 0) {
        send(res, 400, { message: 'CHAINID REQUIRED' })
        return
      }
      if (!HEX40.test(tokenIn) || !HEX40.test(tokenOut)) {
        send(res, 400, { message: 'TOKENIN AND TOKENOUT MUST BE 0X ADDRESSES' })
        return
      }
      if (!/^\d+$/.test(amount) || amount === '0') {
        send(res, 400, { message: 'AMOUNT MUST BE A POSITIVE BASE-UNIT INTEGER STRING' })
        return
      }
      if (!HEX40.test(swapper)) {
        send(res, 400, { message: 'SWAPPER MUST BE A 0X ADDRESS' })
        return
      }
      // Classic on-chain protocols only: the response is always a single
      // sign-and-send tx. UniswapX Dutch/priority orders need a separate
      // off-chain order flow (/order) which UNISWAP.EXE does not implement.
      await upstream(
        res,
        '/quote',
        {
          method: 'POST',
          headers: { 'x-universal-router-version': '2.0' },
          body: JSON.stringify({
            type: 'EXACT_INPUT',
            tokenInChainId: chainId,
            tokenOutChainId: chainId,
            tokenIn,
            tokenOut,
            amount,
            swapper,
            slippageTolerance: Math.max(0.05, (Number.isFinite(slippageBps) ? slippageBps : 50) / 100),
            routingPreference: 'BEST_PRICE',
            protocols: ['V2', 'V3', 'V4'],
            generatePermitAsTransaction: false,
          }),
        },
        25_000,
      )
      return
    }

    if (method === 'POST' && op === 'swap') {
      const body = await readJson(req)
      if (!body || typeof body.quote !== 'object' || !body.quote) {
        send(res, 400, { message: 'QUOTE OBJECT REQUIRED' })
        return
      }
      const out = { quote: body.quote, simulateTransaction: true }
      if (body.permitData && body.signature) {
        out.permitData = body.permitData
        out.signature = String(body.signature)
      }
      if (body.deadline != null) out.deadline = Number(body.deadline)
      await upstream(
        res,
        '/swap',
        {
          method: 'POST',
          headers: { 'x-universal-router-version': '2.0' },
          body: JSON.stringify(out),
        },
        45_000,
      )
      return
    }

    send(res, 400, { message: op ? 'UNKNOWN OP' : 'METHOD NOT ALLOWED' })
  } catch (e) {
    send(res, 500, { message: String(e.message || 'UNISWAP PROXY ERROR').slice(0, 300) })
  }
}
