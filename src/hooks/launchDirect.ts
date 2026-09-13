import { useQuery } from '@tanstack/react-query'
import { Connection, PublicKey } from '@solana/web3.js'
import { getEngine } from '../lib/launch/engine'
import { devnetRpcCandidates } from '../lib/launch/config'
import type { PoolStatus } from '../lib/launch/types'

/** Live graduation / reserve status for a DIRECT (Meteora DBC) pool.
 *  TESTING: reads devnet while DIRECT is badged TESTNET. */
export function useDirectPoolStatus(pool: string | null, enabled = true) {
  return useQuery<PoolStatus>({
    queryKey: ['direct-pool-status', pool],
    queryFn: async () => {
      const conn = new Connection(devnetRpcCandidates()[0], 'confirmed')
      return getEngine('meteora-dbc').getPoolStatus(conn, new PublicKey(pool as string))
    },
    enabled: enabled && !!pool,
    refetchInterval: 10_000,
  })
}
