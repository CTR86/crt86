/* debug script: replay discovery + quote path against the live RPC */
import { createPublicClient, http, formatUnits } from 'viem'
import { readContract } from 'viem/actions'
import { defineChain } from 'viem'

const rhChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
})

const MEME_FACTORY = '0x34fb85aF7588dB97Fd6db6508Aa387D0f088564c'
const ROUTER = '0x08A59435c8359A45F4F5dC8D91DF893Cc33DaF29'

const ERC20_ABI = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
]
const FACTORY_ABI = [
  { type: 'function', name: 'memeCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'memeTokens', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'getMeme', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ name: 'subjectId', type: 'bytes32' }, { name: 'token', type: 'address' }, { name: 'curve', type: 'address' }, { name: 'creator', type: 'address' }, { name: 'graduationDesk', type: 'address' }, { name: 'createdAt', type: 'uint256' }] },
]
const ROUTER_ABI = [
  { type: 'function', name: 'quoteMemeExactIn', stateMutability: 'nonpayable', inputs: [{ name: 'meme', type: 'address' }, { name: 'buy', type: 'bool' }, { name: 'useEth', type: 'bool' }, { name: 'amountIn', type: 'uint256' }], outputs: [{ name: 'output', type: 'uint256' }, { name: 'inputUsed', type: 'uint256' }, { name: 'stockRefund', type: 'uint256' }] },
]

const client = createPublicClient({ chain: rhChain, transport: http('https://rpc.mainnet.chain.robinhood.com', { timeout: 20000 }) })

const count = await readContract(client, { address: MEME_FACTORY, abi: FACTORY_ABI, functionName: 'memeCount' })
console.log('memeCount:', count)

// find DOGE among the newest 8
for (let i = Number(count) - 1; i >= Number(count) - 8; i--) {
  const token = await readContract(client, { address: MEME_FACTORY, abi: FACTORY_ABI, functionName: 'memeTokens', args: [BigInt(i)] })
  const m = await readContract(client, { address: MEME_FACTORY, abi: FACTORY_ABI, functionName: 'getMeme', args: [token] })
  const [subjectId, tokenAddr, curve, creator] = m
  const symbol = await readContract(client, { address: tokenAddr, abi: ERC20_ABI, functionName: 'symbol' })
  const decimals = await readContract(client, { address: tokenAddr, abi: ERC20_ABI, functionName: 'decimals' })
  console.log(`#${i} ${symbol} decimals=${decimals} token=${tokenAddr} curve=${curve}`)
  if (i === Number(count) - 1) {
    const block = await client.getBlockNumber()
    console.log('block:', block)
    try {
      const q = await client.simulateContract({
        address: ROUTER,
        abi: ROUTER_ABI,
        functionName: 'quoteMemeExactIn',
        args: [tokenAddr, true, true, parseAmount('0.01', Number(decimals))],
        blockNumber: block,
      })
      console.log('QUOTE OK:', q.result, '-> output:', formatUnits(q.result[0], Number(decimals)))
    } catch (e) {
      console.log('QUOTE FAILED:', String(e).slice(0, 800))
    }
  }
}

function parseAmount(s, dec) {
  // viem parseUnits equivalent
  const [whole, frac = ''] = s.split('.')
  if (frac.length > dec) throw new Error('too many decimals for ' + dec)
  return BigInt(whole + frac.padEnd(dec, '0'))
}
