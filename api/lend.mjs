// /api/lend — same-origin Jupiter Lend proxy. The server injects x-api-key so the
// browser bundle never carries the secret. Supports:
//   GET  /api/lend?op=status
//   GET  /api/lend?op=/earn/tokens
//   GET  /api/lend?op=/earn/positions&users=a,b
//   GET  /api/lend?op=/earn/earnings&user=X&positions=a,b
//   POST /api/lend?op=/earn/deposit   { asset, amount, signer }
//   POST /api/lend?op=/earn/withdraw  { asset, amount, signer }
//   POST /api/lend?op=/earn/mint      { asset, signer, shares }
//   POST /api/lend?op=/earn/redeem    { asset, signer, shares }
//   GET  /api/lend?op=/borrow/vaults&market=main
//   GET  /api/lend?op=/borrow/positions&users=a,b&market=main
//   POST /api/lend?op=/borrow/operate[&market=main] { vaultId, positionId, signer, colAmount, debtAmount, positionOwner? }
// Env: JUPITER_API_KEY (server, preferred) or VITE_JUPITER_API_KEY fallback.
// Never logs the key, never returns it.

const LEND_BASE = 'https://api.jup.ag/lend/v1'

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
    send(res, 502, { message: 'JUPITER LEND UNREACHABLE — ' + String(e.message || e).slice(0, 160) })
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
    const msg = json?.error || json?.message || `JUPITER LEND HTTP ${r.status}`
    send(res, r.status, { message: String(msg).slice(0, 500), error: String(msg).slice(0, 500) })
    return
  }
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(text || '{}')
}

function requireStr(v, name, res) {
  const s = String(v ?? '').trim()
  if (!s) {
    send(res, 400, { message: `${name} REQUIRED` })
    return null
  }
  return s
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
      send(res, 200, { configured: apiKey().length > 0, gateway: LEND_BASE })
      return
    }

    const headers = { Accept: 'application/json' }
    const key = apiKey()
    if (key) headers['x-api-key'] = key

    // ---------- Earn reads ----------
    if (method === 'GET' && op === '/earn/tokens') {
      await passthrough(res, `${LEND_BASE}/earn/tokens`, { headers, signal: AbortSignal.timeout(20_000) })
      return
    }

    if (method === 'GET' && op === '/earn/positions') {
      const users = requireStr(url.searchParams.get('users'), 'USERS', res)
      if (users == null) return
      await passthrough(res, `${LEND_BASE}/earn/positions?${new URLSearchParams({ users }).toString()}`, {
        headers,
        signal: AbortSignal.timeout(20_000),
      })
      return
    }

    if (method === 'GET' && op === '/earn/earnings') {
      const user = requireStr(url.searchParams.get('user'), 'USER', res)
      if (user == null) return
      const positions = requireStr(url.searchParams.get('positions'), 'POSITIONS', res)
      if (positions == null) return
      await passthrough(
        res,
        `${LEND_BASE}/earn/earnings?${new URLSearchParams({ user, positions }).toString()}`,
        { headers, signal: AbortSignal.timeout(20_000) },
      )
      return
    }

    // ---------- Earn transactions ----------
    if (method === 'POST' && (op === '/earn/deposit' || op === '/earn/withdraw')) {
      const body = await readJson(req)
      const asset = String(body.asset || '').trim()
      const amount = String(body.amount || '').trim()
      const signer = String(body.signer || '').trim()
      if (!asset || !amount || !signer) {
        send(res, 400, { message: 'ASSET, AMOUNT AND SIGNER REQUIRED' })
        return
      }
      await passthrough(res, `${LEND_BASE}${op}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, amount, signer }),
        signal: AbortSignal.timeout(30_000),
      })
      return
    }

    if (method === 'POST' && (op === '/earn/mint' || op === '/earn/redeem')) {
      const body = await readJson(req)
      const asset = String(body.asset || '').trim()
      const signer = String(body.signer || '').trim()
      const shares = String(body.shares || '').trim()
      if (!asset || !signer || !shares) {
        send(res, 400, { message: 'ASSET, SIGNER AND SHARES REQUIRED' })
        return
      }
      await passthrough(res, `${LEND_BASE}${op}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, signer, shares }),
        signal: AbortSignal.timeout(30_000),
      })
      return
    }

    // ---------- Borrow reads ----------
    if (method === 'GET' && op === '/borrow/vaults') {
      const market = (url.searchParams.get('market') || 'main').trim() || 'main'
      await passthrough(res, `${LEND_BASE}/borrow/vaults?${new URLSearchParams({ market }).toString()}`, {
        headers,
        signal: AbortSignal.timeout(20_000),
      })
      return
    }

    if (method === 'GET' && op === '/borrow/positions') {
      const users = requireStr(url.searchParams.get('users'), 'USERS', res)
      if (users == null) return
      const market = (url.searchParams.get('market') || 'main').trim() || 'main'
      await passthrough(
        res,
        `${LEND_BASE}/borrow/positions?${new URLSearchParams({ users, market }).toString()}`,
        { headers, signal: AbortSignal.timeout(20_000) },
      )
      return
    }

    // ---------- Borrow operate ----------
    if (method === 'POST' && op.startsWith('/borrow/operate')) {
      const body = await readJson(req)
      const vaultId = Number(body.vaultId)
      const positionId = Number(body.positionId)
      const signer = String(body.signer || '').trim()
      const colAmount = String(body.colAmount ?? '').trim()
      const debtAmount = String(body.debtAmount ?? '').trim()
      if (!Number.isFinite(vaultId) || !Number.isFinite(positionId) || !signer || colAmount === '' || debtAmount === '') {
        send(res, 400, { message: 'VAULTID, POSITIONID, SIGNER, COLAMOUNT AND DEBTAMOUNT REQUIRED' })
        return
      }
      const market = (url.searchParams.get('market') || body.market || 'main').toString().trim() || 'main'
      const payload = { vaultId, positionId, signer, colAmount, debtAmount }
      if (body.positionOwner) payload.positionOwner = String(body.positionOwner)
      const suffix = op === '/borrow/operate-instructions' ? '/borrow/operate-instructions' : '/borrow/operate'
      await passthrough(res, `${LEND_BASE}${suffix}?${new URLSearchParams({ market }).toString()}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      })
      return
    }

    send(res, op ? 400 : 405, { message: op ? 'UNKNOWN OP' : 'METHOD NOT ALLOWED' })
  } catch (e) {
    send(res, 500, { message: String(e.message || 'LEND PROXY ERROR').slice(0, 300) })
  }
}
