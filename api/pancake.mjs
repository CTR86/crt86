// /api/pancake — same-origin PancakeSwap proxy slot. The server injects
// the key so a future PancakeSwap API credential never touches the bundle.
// Supports:
//   GET  /api/pancake?op=status
// Future (only when credentials are provided — see .env.example):
//   GET  /api/pancake?op=quote&chainId&tokenIn&tokenOut&amount
//   POST /api/pancake?op=build   { ... }
// TODAY: PANCAKE.EXE quotes + builds fully on-chain (V2 router
// getAmountsOut over public RPC), so this proxy honestly reports
// { configured: false, mode: 'onchain' }. When a PancakeSwap API key /
// routing endpoint is supplied, wire the quote/build ops here behind
// the server-side key and flip the frontend to prefer it.
// Env: PANCAKESWAP_API_KEY (server, never VITE_).
// Never logs the key, never returns it.

const EXTRA_BASE = (process.env.PANCAKESWAP_API_BASE || '').trim()

function apiKey() {
  return (process.env.PANCAKESWAP_API_KEY || '').trim()
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
      send(res, 200, {
        configured: apiKey().length > 0 && EXTRA_BASE.length > 0,
        mode: 'onchain',
        gateway: 'onchain PancakeSwap V2 router (no API key required)',
      })
      return
    }

    // No credentialed upstream is configured — say so explicitly instead
    // of faking a quote. Required to enable: PANCAKESWAP_API_KEY +
    // PANCAKESWAP_API_BASE in server env (Vercel env / .env.local).
    send(res, 501, {
      message: 'PANCAKESWAP API NOT CONFIGURED — PANCAKE.EXE uses on-chain quotes. Missing: PANCAKESWAP_API_KEY and PANCAKESWAP_API_BASE.',
    })
  } catch (e) {
    send(res, 500, { message: String(e.message || 'PANCAKE PROXY ERROR').slice(0, 300) })
  }
}
