/* Proxy contract tests — shape, validation, and honest no-key behavior
   for every /api/* serverless handler. No network calls: only `status`
   and validation-error paths are exercised (quote/swap passthroughs
   need live upstream + keys and are covered by manual verification).
   @ts-nocheck — sibling .mjs handlers are untyped by design; runtime
   is verified by vitest, and api/handlers.d.ts covers editors. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The sibling .mjs handlers are untyped by design (plain Node functions).
// ts-ignore per import: Vercel's function validator type-checks this file
// without sibling .d.ts files; runtime is verified by vitest itself.
// @ts-ignore: untyped handler
import bpHandler from './bp.mjs'
// @ts-ignore: untyped handler
import jupHandler from './jup.mjs'
// @ts-ignore: untyped handler
import lendHandler from './lend.mjs'
// @ts-ignore: untyped handler
import uniswapHandler from './uniswap.mjs'
// @ts-ignore: untyped handler
import pancakeHandler from './pancake.mjs'
import bpHandler from './bp.mjs'
import jupHandler from './jup.mjs'
import lendHandler from './lend.mjs'
import uniswapHandler from './uniswap.mjs'
import pancakeHandler from './pancake.mjs'

type Handler = (req: unknown, res: unknown) => Promise<void>

interface MockRes {
  statusCode: number
  headers: Record<string, string>
  body: string
  setHeader(k: string, v: string): void
  end(b: string): void
}

function mockReq(url: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const req = {
    url,
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  }
  return req
}

function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k: string, v: string) {
      res.headers[k] = v
    },
    end(b: string) {
      res.body = b
    },
  }
  return res
}

async function call(h: Handler, url: string, method = 'GET', body?: unknown, headers?: Record<string, string>) {
  const res = mockRes()
  await h(mockReq(url, method, body, headers), res)
  return { status: res.statusCode, json: JSON.parse(res.body || '{}') as Record<string, unknown> }
}

const ENV_KEYS = [
  'BACKPACK_API_KEY',
  'BACKPACK_API_SECRET',
  'BACKPACK_API_NAME',
  'BP_OPERATOR_TOKEN',
  'JUPITER_API_KEY',
  'VITE_JUPITER_API_KEY',
  'UNISWAP_API_KEY',
  'UNISWAP_API_BASE',
  'PANCAKESWAP_API_KEY',
  'PANCAKESWAP_API_BASE',
]

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('bp proxy (Backpack)', () => {
  it('reports unconfigured without keys, never a fake status', async () => {
    const r = await call(bpHandler, '/api/bp?op=status')
    expect(r.status).toBe(200)
    expect(r.json.configured).toBe(false)
    expect(r.json.gated).toBe(false)
  })

  it('rejects balances without keys instead of faking', async () => {
    const r = await call(bpHandler, '/api/bp?op=balances')
    expect(r.status).toBe(503)
  })

  it('gates trade ops when BP_OPERATOR_TOKEN is set', async () => {
    process.env.BP_OPERATOR_TOKEN = 'opaque-operator-secret'
    process.env.BACKPACK_API_KEY = 'k'
    process.env.BACKPACK_API_SECRET = Buffer.alloc(32).toString('base64')
    const st = await call(bpHandler, '/api/bp?op=status')
    expect(st.json.gated).toBe(true)
    const denied = await call(bpHandler, '/api/bp?op=balances')
    expect(denied.status).toBe(403)
    const allowed = await call(bpHandler, '/api/bp?op=balances', 'GET', undefined, {
      'x-operator-token': 'opaque-operator-secret',
    })
    // passes the gate (fails later on fake Backpack creds — proves gate, not fill)
    expect(allowed.status).not.toBe(403)
  })
})

describe('jup proxy (Jupiter)', () => {
  it('reports configured flag honestly and proxies anonymously', async () => {
    const r = await call(jupHandler, '/api/jup?op=status')
    expect(r.status).toBe(200)
    expect(r.json.configured).toBe(false)
  })

  it('validates order params before touching upstream', async () => {
    const r = await call(jupHandler, '/api/jup?op=order&inputMint=a')
    expect(r.status).toBe(400)
  })
})

describe('lend proxy (Jupiter Lend)', () => {
  it('reports configured flag honestly', async () => {
    const r = await call(lendHandler, '/api/lend?op=status')
    expect(r.status).toBe(200)
    expect(r.json.configured).toBe(false)
  })
})

describe('uniswap proxy (Trading API)', () => {
  it('reports onchain mode without a key', async () => {
    const r = await call(uniswapHandler, '/api/uniswap?op=status')
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ configured: false, mode: 'onchain' })
  })

  it('returns honest 501 for quote without a key (never fakes)', async () => {
    const r = await call(
      uniswapHandler,
      '/api/uniswap?op=quote',
      'POST',
      { chainId: 56, tokenIn: '0x0000000000000000000000000000000000000000', tokenOut: '0x55d398326f99059fF775485246999027B3197955', amount: '1000', swapper: '0x000000000000000000000000000000000000dEaD' },
    )
    expect(r.status).toBe(501)
  })

  it('validates quote shape when a key IS set (no upstream hit)', async () => {
    process.env.UNISWAP_API_KEY = 'test-key-never-sent'
    const bad = await call(uniswapHandler, '/api/uniswap?op=quote', 'POST', { chainId: 56 })
    expect(bad.status).toBe(400)
  })
})

describe('pancake proxy (slot)', () => {
  it('reports onchain mode and honest 501s', async () => {
    const st = await call(pancakeHandler, '/api/pancake?op=status')
    expect(st.status).toBe(200)
    expect(st.json).toMatchObject({ configured: false, mode: 'onchain' })
    const q = await call(pancakeHandler, '/api/pancake?op=quote')
    expect(q.status).toBe(501)
  })
})
