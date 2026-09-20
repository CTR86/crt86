/* Engine registry — production implementation is Meteora DBC (direct rail).
   Third-party engines (StonkFun, Ember) live in their own clients. */

import { MeteoraLaunchEngine } from './meteora'
import type { EngineId, LaunchEngine } from './types'

const REGISTRY: Record<EngineId, LaunchEngine> = {
  'meteora-dbc': new MeteoraLaunchEngine(),
}
export function getEngine(id: EngineId): LaunchEngine {
  return REGISTRY[id]
}

export function listEngines(): LaunchEngine[] {
  return Object.values(REGISTRY)
}

export type { EngineId, LaunchEngine }
