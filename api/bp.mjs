import { createPrivateKey, sign as nodeSign } from 'node:crypto'

const BP = 'https://api.backpack.exchange'
const WINDOW = 5000
const NAME = () => (process.env.BACKPACK_API_NAME || 'crt2').trim()

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

function creds() {
  const apiKey = (process.env.BACKPACK_API_KEY || '').trim()
  const secret = (process.env.BACKPACK_API_SECRET || '').trim()
  return { apiKey, secret }
}

function configured() {
  const { apiKey, secret } = creds()
  return apiKey.length > 0 && secret.length > 0
}

function privateKey() {
  const { secret } = creds()
  const seed = Buffer.from(secret, 'base64')
  if (seed.length !== 32) throw new Error('BACKPACK SECRET MUST BE A 32-BYTE ED25519 SEED')
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' })
}

function signingString(instruction, params, ts) {
  const parts = [`instruction=${instruction}`]
  const keys = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
  for (const k of keys) parts.push(`${k}=${params[k]}`)
  parts.push(`timestamp=${ts}`, `window=${WINDOW}`)
  return parts.join('&')
}

async function signed(method, path, instruction, params = {}) {
  const { apiKey } = creds()
  if (!configured()) {
    const err = new Error('BACKPACK KEY NOT LOADED')
    err.status = 503
    throw err
  }
  const ts = Date.now()
  const msg = signingString(instruction, params, ts)
  const signature = nodeSign(null, Buffer.from(msg), privateKey()).toString('base64')
  const headers = {
    'X-API-Key': apiKey,
    'X-Signature': signature,
    'X-Timestamp': String(ts),
    'X-Window': String(WINDOW),
  }
  let url = `${BP}${path}`
  let body
  if (method === 'GET' || method === 'DELETE') {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
    }
    const s = qs.toString()
    if (s) url += `?${s}`
  } else {
    headers['Content-Type'] = 'application/json; charset=utf-8'
    body = JSON.stringify(params)
  }
  const r = await fetch(url, { method, headers, body })
  const text = await r.text()
  let json = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      json = { message: text }
    }
  }
  if (!r.ok) {
    const err = new Error(json?.message || `BACKPACK ${r.status}`)
    err.status = r.status
    err.payload = json
    throw err
  }
  return json
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

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
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
      send(res, 200, { configured: configured(), name: NAME() })
      return
    }

    if (method === 'GET' && op === 'balances') {
      const data = await signed('GET', '/api/v1/capital', 'balanceQuery')
      send(res, 200, data)
      return
    }

    if (method === 'GET' && op === 'rfqs') {
      const data = await signed('GET', '/api/v1/rfqs', 'rfqQuery')
      send(res, 200, data)
      return
    }

    if (method === 'POST') {
      const body = await readJson(req)
      const action = body.op || op

      if (action === 'rfq') {
        const symbol = String(body.symbol || '').trim()
        const side = body.side === 'Ask' ? 'Ask' : 'Bid'
        const quantity = String(body.quantity || '').trim()
        if (!symbol || !quantity) {
          send(res, 400, { message: 'SYMBOL AND QUANTITY REQUIRED' })
          return
        }
        const data = await signed('POST', '/api/v1/rfq', 'rfqSubmit', { symbol, side, quantity })
        send(res, 200, data)
        return
      }

      if (action === 'accept') {
        const quoteId = String(body.quoteId || '').trim()
        const rfqId = String(body.rfqId || '').trim()
        if (!quoteId || !rfqId) {
          send(res, 400, { message: 'RFQ AND QUOTE ID REQUIRED' })
          return
        }
        const data = await signed('POST', '/api/v1/rfq/accept', 'quoteAccept', { rfqId, quoteId })
        send(res, 200, data)
        return
      }

      if (action === 'cancel') {
        const rfqId = String(body.rfqId || '').trim()
        if (!rfqId) {
          send(res, 400, { message: 'RFQ ID REQUIRED' })
          return
        }
        const data = await signed('POST', '/api/v1/rfq/cancel', 'rfqCancel', { rfqId })
        send(res, 200, data)
        return
      }

      send(res, 400, { message: 'UNKNOWN OP' })
      return
    }

    send(res, 405, { message: 'METHOD NOT ALLOWED' })
  } catch (e) {
    send(res, e.status && Number.isInteger(e.status) ? e.status : 500, {
      message: e.message || 'BACKPACK ERROR',
    })
  }
}
