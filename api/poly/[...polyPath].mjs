// /api/poly — same-origin Polymarket forwarder. Browser SDK calls
// (Gamma discovery, CLOB public books, CLOB L1/L2 authed calls) go
// through here so every browser works regardless of upstream CORS.
// Strict host allowlist — nothing else is reachable. No secrets live
// here: L1/L2 auth material is per-user, wallet-signed or derived in
// the browser, and only transits TLS. Nothing is logged.
//
// Two shapes are accepted (the second is the new, Vercel-safe one):
//   /api/poly/<base>/<upstream-path>?<query>   (legacy, via catch-all)
//   /api/poly?base=<gamma|clob|data>&path=/<upstream-path>&<query>
// All request headers except hop-by-hop ones are forwarded (the SDK's
// POLY_* auth headers pass through untouched).

const BASES = {
  gamma: 'https://gamma-api.polymarket.com',
  clob: 'https://clob.polymarket.com',
  data: 'https://data-api.polymarket.com',
}

const HOP = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade'])

function send(res, status, body, isJson = true) {
  res.statusCode = status
  res.setHeader('Content-Type', isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(isJson ? JSON.stringify(body) : String(body))
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (!chunks.length) return null
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return { json: JSON.parse(raw), raw }
  } catch {
    return { json: null, raw }
  }
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', 'http://local')
    const method = (req.method || 'GET').toUpperCase()

    if (method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }

    let base = url.searchParams.get('base')
    let upPath = url.searchParams.get('path')
    let extraQs = ''
    if (base && upPath) {
      if (!BASES[base]) {
        send(res, 400, { message: 'BAD BASE — use gamma|clob|data' })
        return
      }
      if (!upPath.startsWith('/')) upPath = '/' + upPath
      const rest = new URLSearchParams(url.searchParams)
      rest.delete('base')
      rest.delete('path')
      extraQs = rest.toString() ? `?${rest.toString()}` : ''
      const upstream = BASES[base] + upPath + extraQs
      // stash for the fetch block below
      url.searchParams.set('__upstream', upstream)
      url.searchParams.set('__base', base)
    } else {
      const parts = url.pathname.split('/').filter(Boolean)
      // legacy: /api/poly/<base>/<upstream-path>?<query>
      if (parts[0] !== 'api' || parts[1] !== 'poly' || !BASES[parts[2]]) {
        send(res, 400, { message: 'BAD PROXY PATH — use /api/poly?base=<gamma|clob|data>&path=/<path> or /api/poly/<base>/<path>' })
        return
      }
      if (parts.length < 4) {
        send(res, 400, { message: 'UPSTREAM PATH REQUIRED' })
        return
      }
      const upstream = BASES[parts[2]] + '/' + parts.slice(3).join('/') + (url.search || '')
      url.searchParams.set('__upstream', upstream)
    }
    const upstream = url.searchParams.get('__upstream') || ''

    const headers = { Accept: 'application/json' }
    for (const [k, v] of Object.entries(req.headers || {})) {
      const low = k.toLowerCase()
      if (HOP.has(low) || v == null) continue
      // Node lowercases inbound headers; Polymarket expects POLY_* uppercase.
      // Preserve canonical case for poly headers so upstream never misses due to case.
      let outKey = k
      if (low.startsWith('poly_')) outKey = low.toUpperCase()
      else if (low === 'poly_address' || low === 'poly_signature' || low === 'poly_timestamp' || low === 'poly_nonce' || low === 'poly_api_key' || low === 'poly_passphrase') outKey = low.toUpperCase()
      headers[outKey] = Array.isArray(v) ? v.join(', ') : String(v)
    }

    let r
    try {
      const init = { method, headers, signal: AbortSignal.timeout(30_000) }
      if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
        const parsed = await readBody(req)
        if (parsed) {
          init.body = typeof parsed.json !== 'undefined' && parsed.json !== null ? JSON.stringify(parsed.json) : parsed.raw;
          if (!headers['content-type'] && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
        }
      }
      r = await fetch(upstream, init)
    } catch (e) {
      send(res, 502, { message: 'POLYMARKET UNREACHABLE — ' + String(e.message || e).slice(0, 160) })
      return
    }
    const text = await r.text().catch(() => '')
    if (!r.ok) {
      let msg = `POLYMARKET HTTP ${r.status}`
      try {
        const j = JSON.parse(text)
        msg = j?.error || j?.message || j?.errorMsg || msg
      } catch {
        if (text) msg = text.slice(0, 300)
      }
      send(res, r.status, { message: String(msg).slice(0, 400) })
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(text || '{}')
  } catch (e) {
    send(res, 500, { message: String(e.message || 'POLY PROXY ERROR').slice(0, 300) })
  }
}
