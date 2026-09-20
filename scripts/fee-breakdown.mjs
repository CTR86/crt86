/* Inspect what the 0.29 SOL launch cost is made of.
   prepare() only RETURNS a quote — nothing is charged until submit. */
import { Keypair } from '@solana/web3.js'

const BASE = 'https://www.stonkfun.xyz/api/public/v1'
const logo =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const wallet = Keypair.generate().publicKey.toBase58()
const body = {
  creatorWallet: wallet,
  quoteMint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', // TSLAX
  name: 'FeeTest',
  symbol: 'FTST',
  logo,
  mode: 'standard',
  feeTier: '2%',
}

async function prepare(label, extra) {
  const res = await fetch(BASE + '/launches/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, ...extra }),
  })
  const j = await res.json()
  console.log('=== ' + label + ' (status ' + res.status + ') ===')
  if (j.error) console.log(JSON.stringify(j.error))
  else {
    const d = j.data
    // drop the giant base64 tx for readability
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { paymentTransaction, signedQuote, ...rest } = d
    console.log(JSON.stringify(rest, null, 1))
    console.log('lamports in SOL:', d.payment?.lamports != null ? Number(d.payment.lamports) / 1e9 : 'n/a')
  }
  console.log('')
}

await prepare('BASE — no dev buy, no airdrop', {})
await prepare('WITH devBuySol 0.25', { devBuySol: '0.25' })
