/* Engine registry — first production implementation is Meteora.
   Raydium stays registered as a PLANNED adapter (throws until enabled). */

import { MeteoraLaunchEngine } from './meteora'
import { RaydiumLaunchEngine } from './raydium'
import type { EngineId, LaunchEngine } from './types'

const REGISTRY: Record<EngineId, LaunchEngine> = {
  'meteora-dbc': new MeteoraLaunchEngine(),
  'raydium-launchlab': new RaydiumLaunchEngine(),
}

export function getEngine(id: EngineId): LaunchEngine {
  return REGISTRY[id]
}

export function listEngines(): LaunchEngine[] {
  return Object.values(REGISTRY)
}

export type { EngineId, LaunchEngine }
