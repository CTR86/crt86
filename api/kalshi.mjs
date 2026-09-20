// /api/kalshi — same-origin Kalshi signer + forwarder.
//
// Why this exists: Kalshi's CORS preflight forbids KALSHI-* headers
// from browsers (verified OPTIONS 204 without them), so authenticated
// calls must be signed server-side. The user pastes their Key ID + RSA
// PEM per session in PREDICT.EXE; the browser sends them WITH EACH
// REQUEST over TLS; this proxy signs in-memory with node:crypto
// (RSA-PSS/SHA256 over timestamp+METHOD+path, query stripped, per the
// official docs) and forwards. NOTHING is stored, logged, or cached:
// no env secret exists, responses pass through untouched.
//
//   POST /api/kalshi   { method, path, query?, body?, keyId?, pem?, demo? }
//   GET  /api/kalshi?op=status  → { mode, bases } (no secrets involved)

import { createSign, createPrivateKey } from 'node:crypto'

const PROD = 'https://api.elections.kalshi.com'
const DEMO = 'https://demo-api.kalshi.co'
const PREFIX = '/trade-api/v2'

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  if (!chunks.length) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
  } catch {
    return null
  }
}

function signRsaPss(pem, text) {
  const key = createPrivateKey({ key: pem.trim(), format: 'pem' })
  const signer = createSign('sha256')
  signer.update(text, 'utf8')
  signer.end()
  // RSA-PSS, MGF1-SHA256, salt length = digest length (per Kalshi docs)
  return signer.sign({ key, padding: 6, saltLength: 32 }).toString('base64')
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

    if (method === 'GET' && ((url.searchParams.get('op') || '') === 'status' || url.searchParams.get('op') === '')) {
      send(res, 200, { mode: 'per-request-user-keys', demo: DEMO + PREFIX, prod: PROD + PREFIX })
      return
    }

    if (method !== 'POST') {
      send(res, 405, { message: 'METHOD NOT ALLOWED' })
      return
    }

    const body = await readJson(req)
    if (!body || typeof body !== 'object') {
      send(res, 400, { message: 'INVALID JSON BODY' })
      return
    }

    const m = String(body.method || 'GET').toUpperCase()
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(m)) {
      send(res, 400, { message: 'BAD METHOD' })
      return
    }
    let path = String(body.path || '')
    if (!path.startsWith(PREFIX + '/')) {
      send(res, 400, { message: 'PATH MUST START WITH /trade-api/v2/' })
      return
    }
    // Sign the path WITHOUT query parameters (per official docs).
    const signPath = path.split('?')[0]
    const query = body.query && typeof body.query === 'object' ? body.query : {}
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])),
    ).toString()
    const keyId = String(body.keyId || '').trim()
    const pem = String(body.pem || '')
    const demo = body.demo === true
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' }

    if (keyId || pem) {
      if (!keyId || !pem) {
        send(res, 400, { message: 'KEYID AND PEM REQUIRED TOGETHER' })
        return
      }
      const ts = String(Date.now())
      let sig
      try {
        sig = signRsaPss(pem, ts + m + signPath)
      } catch {
        send(res, 400, { message: 'INVALID RSA PRIVATE KEY (need PKCS8 PEM)' })
        return
      }
      headers['KALSHI-ACCESS-KEY'] = keyId
      headers['KALSHI-ACCESS-TIMESTAMP'] = ts
      headers['KALSHI-ACCESS-SIGNATURE'] = sig
    }

    const target = (demo ? DEMO : PROD) + signPath + (qs ? `?${qs}` : '')
    let r
    try {
      r = await fetch(target, {
        method: m,
        headers,
        body: m === 'GET' ? undefined : JSON.stringify(body.body ?? {}),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (e) {
      send(res, 502, { message: 'KALSHI UNREACHABLE — ' + String(e.message || e).slice(0, 160) })
      return
    }
    const text = await r.text().catch(() => '')
    if (!r.ok) {
      let msg = `KALSHI HTTP ${r.status}`
      try {
        const j = JSON.parse(text)
        msg = j?.message || j?.error || msg
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
    send(res, 500, { message: String(e.message || 'KALSHI PROXY ERROR').slice(0, 300) })
  }
}
