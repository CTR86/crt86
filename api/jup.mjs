// /api/jup — same-origin Jupiter proxy. The server injects x-api-key so the
// browser bundle never carries the secret. Supports:
//   GET  /api/jup?op=status
//   GET  /api/jup?op=order&inputMint&outputMint&amount&taker[&slippageBps]
//   POST /api/jup?op=execute  { signedTransaction, requestId }
//   GET  /api/jup?op=search&query=...
//   GET  /api/jup?op=price&ids=a,b
// Env: JUPITER_API_KEY (server, preferred) or VITE_JUPITER_API_KEY fallback.
// Never logs the key, never returns it.

const SWAP_BASE = 'https://api.jup.ag/swap/v2'
const TOKENS_BASE = 'https://api.jup.ag/tokens/v2'
const PRICE_BASE = 'https://api.jup.ag/price/v3'

function apiKey() {
  const k = (process.env.JUPITER_API_KEY || process.env.VITE_JUPITER_API_KEY || '').trim()
  return k
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
    return {}
  }
}

async function passthrough(res, url, init) {
  let r
  try {
    r = await fetch(url, init)
  } catch (e) {
    send(res, 502, { message: 'JUPITER UNREACHABLE — ' + String(e.message || e).slice(0, 160) })
    return
  }
  const text = await r.text().catch(() => '')
  let json = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = { message: text.slice(0, 500) }
    }
  }
  if (!r.ok) {
    const msg = json?.error || json?.message || `JUPITER HTTP ${r.status}`
    send(res, r.status, { message: String(msg).slice(0, 500), error: String(msg).slice(0, 500) })
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
      send(res, 200, { configured: apiKey().length > 0, gateway: 'https://api.jup.ag' })
      return
    }

    const headers = { Accept: 'application/json' }
    const key = apiKey()
    if (key) headers['x-api-key'] = key

    if (method === 'GET' && op === 'order') {
      const inputMint = (url.searchParams.get('inputMint') || '').trim()
      const outputMint = (url.searchParams.get('outputMint') || '').trim()
      const amount = (url.searchParams.get('amount') || '').trim()
      const taker = (url.searchParams.get('taker') || '').trim()
      const slippageBps = (url.searchParams.get('slippageBps') || '').trim()
      if (!inputMint || !outputMint || !amount || !taker) {
        send(res, 400, { message: 'INPUTMINT, OUTPUTMINT, AMOUNT AND TAKER REQUIRED' })
        return
      }
      const q = new URLSearchParams({ inputMint, outputMint, amount, taker })
      if (slippageBps) q.set('slippageBps', slippageBps)
      await passthrough(res, `${SWAP_BASE}/order?${q.toString()}`, {
        headers,
        signal: AbortSignal.timeout(20_000),
      })
      return
    }

    if (method === 'POST' && (op === 'execute' || url.searchParams.get('op') === 'execute')) {
      const body = await readJson(req)
      const signedTransaction = String(body.signedTransaction || '').trim()
      const requestId = String(body.requestId || '').trim()
      if (!signedTransaction || !requestId) {
        send(res, 400, { message: 'SIGNEDTRANSACTION AND REQUESTID REQUIRED' })
        return
      }
      await passthrough(res, `${SWAP_BASE}/execute`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedTransaction, requestId }),
        signal: AbortSignal.timeout(60_000),
      })
      return
    }

    if (method === 'GET' && op === 'search') {
      const query = (url.searchParams.get('query') || '').trim()
      if (!query) {
        send(res, 400, { message: 'QUERY REQUIRED' })
        return
      }
      await passthrough(res, `${TOKENS_BASE}/search?${new URLSearchParams({ query }).toString()}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      })
      return
    }

    if (method === 'GET' && op === 'price') {
      const ids = (url.searchParams.get('ids') || '').trim()
      if (!ids) {
        send(res, 400, { message: 'IDS REQUIRED' })
        return
      }
      await passthrough(res, `${PRICE_BASE}?${new URLSearchParams({ ids }).toString()}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      })
      return
    }

    send(res, op ? 400 : 405, { message: op ? 'UNKNOWN OP' : 'METHOD NOT ALLOWED' })
  } catch (e) {
    send(res, 500, { message: String(e.message || 'JUP PROXY ERROR').slice(0, 300) })
  }
}
