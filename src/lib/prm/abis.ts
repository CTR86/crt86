import type { Abi } from 'viem'

/* ABIs downloaded from https://www.prm.market/docs/abi/ (SDK-exposed surface) */

import routerJson from './abis/router.json'
import memeCurveJson from './abis/meme-curve.json'
import memeFactoryJson from './abis/meme-factory.json'
import subjectFactoryJson from './abis/subject-factory.json'
import erc20Json from './abis/erc20.json'

export const ROUTER_ABI = routerJson as unknown as Abi
export const MEME_CURVE_ABI = memeCurveJson as unknown as Abi
export const MEME_FACTORY_ABI = memeFactoryJson as unknown as Abi
export const SUBJECT_FACTORY_ABI = subjectFactoryJson as unknown as Abi
export const ERC20_ABI = erc20Json as unknown as Abi
