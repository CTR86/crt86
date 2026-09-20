# CRT86 Codebase Implementation Audit

**Scope:** `C:\Users\monkey\Desktop\zaiproject\80's launchpad` (Vite 7 + React 19 + TS 5.9 strict).
**Method:** read-only forensic audit. Every claim below was verified by reading source files;
anything not provable from code is marked NOT VERIFIED. Three parallel deep-dives covered
launchpad, trading modules, and infra; swap/perp-infra, docs, routes, and all toolchain runs
were verified directly. **Nothing was modified for this audit.**
**Date basis:** working tree state including uncommitted changes (see §19).

---

## 1. Executive Summary

CRT86 is a single-page CRT terminal (HashRouter SPA + 5 Vercel serverless proxies, no database,
no backend beyond the proxies). What it **actually is today**: a Solana launchpad frontend
(StonkFun/Ember delegated launches + a disabled local Meteora rail), a Jupiter Solana swap
terminal, two EVM swap terminals (Uniswap API-first, PancakeSwap on-chain), a dual-venue perp
terminal (Hyperliquid + Aster, **default mainnet, trade execution never observed live**), a
Relay bridge terminal, a Jupiter Lend terminal, a Backpack RFQ stock terminal, a StonkFun market
wire, a playable Snake game, and static/info windows.

- **No mocks or fake fills found anywhere.** `TODO|FIXME|XXX|HACK|DUMMY|LOREM|example.com`
  grep over `src/` returns zero hits. Stubs that exist throw honestly
  (`src/lib/launch/raydium.ts:24-33`).
- **Recurring pattern: code-complete execution paths whose live on-chain leg was never
  observed in this audit.** Quote → sign → submit → confirm flows exist for swaps, perps,
  lending, bridging, RFQ, and launches, but without funded-wallet live runs they are PARTIAL,
  not VERIFIED WORKING.
- **Dead/parked weight is real:** a full Jupiter-Perps engine (`src/lib/perp/`, `src/os/PerpWindow.tsx`,
  `src/hooks/perp.ts`) has no route; the Robinhood-Chain system is flag-gated off; Raydium
  LaunchLab is a throwing stub; the DIRECT Meteora flow is code-complete but unconfigured and
  UI-unreachable.
- **Docs are stale:** `README.md` still describes PERP.EXE as "Jupiter Perps (parked as SOON)"
  and DEX.EXE as "parked as SOON" — both false today. `SettingsWindow.tsx:73` claims
  "DEX SOON · BRIDGE SOON · TERMINAL SOON" — all three are live.
- **Security posture is disciplined:** high-value keys are server-only (`api/*.mjs` inject
  `x-api-key`/ED25519 signatures); browser `VITE_JUPITER_API_KEY`/`VITE_RELAY_API_KEY` are
  documented local-dev/rate-limit fallbacks. Weak spots: Aster/HL agent private keys persist
  in **plaintext localStorage** (browser-only by design, XSS-theft surface), and `.env.local`
  with live keys sits in the working tree (gitignored — verified via `git check-ignore`).
- **Toolchain is green:** `typecheck` clean, `111/111` Vitest tests pass (incl. proxy contracts + live reads), `npm run lint` 0 errors, `vite build` succeeds.
  No lint script is configured.

---

## 2. Current Architecture

```
Browser SPA (Vite + React 19 + HashRouter + Zustand + React Query)
│
├─ Solana: @solana/web3.js (injected Phantom/Solfare/Backpack, raw providers, no adapter lib)
├─ EVM: viem (raw EIP-1193 window.ethereum, no WalletConnect/Coinbase SDK)
├─ Solana program SDK: @meteora-ag/dynamic-bonding-curve-sdk (DIRECT engine only)
├─ Encoding: bs58 (lazy), bn.js (DBC amounts only), @msgpack/msgpack (HL action hashing)
│
├─ Same-origin serverless (api/*.mjs, Vercel functions; vite dev middleware mirrors them)
│   /api/bp      Backpack ED25519 signer (server keys)
│   /api/jup     Jupiter swap/tokens/price (server key, anonymous fallback)
│   /api/lend    Jupiter Lend gateway (server key, anonymous fallback)
│   /api/uniswap Uniswap Trading API (server key; honest 501 without)
│   /api/pancake PancakeSwap slot (status only; on-chain today)
│
├─ Direct-from-browser third parties (CORS verified for fapi.asterdex.com *,
│   api.hyperliquid.xyz *, stonkfun.xyz): StonkFun, Ember (via /ember rewrite),
│   Relay, Aster, Hyperliquid, Backpack tape, CoinGecko, Binance, Solscan links
│
└─ Persistence: NONE server-side. localStorage (settings, snake high, Aster/HL agent
   keys) + sessionStorage (boot flag, module-loader handoff). No database, no ORM,
   no cron/workers/queues (grep for supabase|firebase|prisma|drizzle|indexeddb: zero hits).
```

Deploys go out via Vercel CLI from a **git-less copy** (no commit metadata) because the
repo's git author email (`328566743+ieatdollargy@users.noreply.github.com`,
`git log -3`: `0144852`, `a870c8f` noreply; older `3d1d0f3` etc. `social86@silenttransfer.com`)
does not match any GitHub account and Vercel blocks git-attributed deployments.
Procedure is documented in `DEPLOY.md` (repo root). Working tree is currently uncommitted.

---

## 3. Executable Inventory

Source: `src/os/Desktop.tsx:16-34` (17 entries) × `src/App.tsx:100-129` (routes). No dead internal routes.

| Executable | Route | Window / Component | Ready flag |
|---|---|---|---|
| LAUNCHPAD.EXE | `/launchpad`, `/launchpad/launch`, `/launchpad/vault`, `/launchpad/portfolio` | `src/pages/Hub.tsx`, `LaunchDeck.tsx`, `FeeVault.tsx`, `Portfolio.tsx` | ready |
| MONEY.EXE | `/money` | `src/os/MoneyWindow.tsx` | ready |
| STOCK.EXE | `/stock` | `src/os/StockWindow.tsx` | ready |
| PERP.EXE | `/perp` | `src/os/PerpTradeWindow.tsx` (Aster + Hyperliquid) | ready |
| GACHA.EXE | *removed from product* | — | removed |
| JUP.EXE | `/jup` (legacy `/dex` → redirect) | `src/os/DexWindow.tsx` | ready |
| UNISWAP.EXE | `/uniswap` | `src/os/UniswapWindow.tsx` + shared `src/os/EvmSwapWindow.tsx` | ready |
| PANCAKE.EXE | `/pancake` | `src/os/PancakeWindow.tsx` + shared `EvmSwapWindow.tsx` | ready |
| LEND.EXE | `/lend` | `src/os/LendWindow.tsx` | ready |
| BRIDGE.EXE | `/bridge` | `src/os/BridgeWindow.tsx` | ready |
| TERMINAL.EXE | `/terminal` | `src/os/TerminalWindow.tsx` → `src/pages/Markets.tsx` | ready |
| FAQ.TXT | `/faq` | `src/os/FaqWindow.tsx` | ready |
| ROADMAP.EXE | `/roadmap` | `src/os/RoadmapWindow.tsx` | ready |
| X.EXE | `/x` | `src/os/XWindow.tsx` (external `https://x.com/crt86vibe`) | ready |
| GITHUB.EXE | `/github` | `src/os/GitHubWindow.tsx` (external `https://github.com/CTR86/crt86`) | ready |
| SNAKE.EXE | `/snake` | `src/os/SnakeWindow.tsx` | ready |
| SHOOT.EXE | `/shoot` | `src/os/ShootWindow.tsx` | ready |
| SETTINGS.EXE | `/settings` | `src/os/SettingsWindow.tsx` | ready |

All executables render inside the existing CRT shell (`CrtShell` + `Panel` + `SystemDialog` +
`bevel-btn`/`stat-row`/`telemetry`/`warn-strip`). No separate landing pages were introduced
for any executable (verified: no new top-level layouts; windows share `src/design/ui.tsx`).

Per-executable verdicts with evidence are in §5–§11. Summary:
FULLY IMPLEMENTED (code-verified, no auth needed): SNAKE, TERMINAL shell+feed, FAQ, ROADMAP, X/GITHUB redirects, SETTINGS.
PARTIAL (real reads + code-complete execution, live leg not observed): LAUNCHPAD, STOCK, PERP (Aster/HL), JUP, UNISWAP, PANCAKE, LEND, BRIDGE.
UI-ONLY: MONEY (display + outbound links), GACHA (ComingSoon).

---

## 4. Blockchain Support

A chain counts only with wired functionality, not a bare chain ID. Token lists alone do not count.

| Chain | ID | RPC (code) | Explorer | Wallet | Swap | Bridge | Launch | Perp | Lend | Testnet |
|---|---|---|---|---|---|---|---|---|---|---|
| Solana mainnet-beta | — | `VITE_SOLANA_RPC_URL` → `api.mainnet-beta.solana.com`, `solana-rpc.publicnode.com` (`SolanaWallet.tsx:40-48`, `lib/dex/config.ts:38-43`) | Solscan links | Phantom/Solflare/Backpack | Jupiter (JUP.EXE) | Relay in/out | StonkFun/Ember/DIRECT-devnet | Jupiter engine parked; Aster/HL sign from any EVM wallet | Jupiter Lend | devnet RPC + DIRECT engine (unconfigured) |
| BNB Chain | 56 | `bsc-dataseed.binance.org`, `bsc-dataseed1`, `bsc.llamarpc.com` (`swap/chains.ts`) | bscscan.com | EVM injected | Uniswap API + V3 on-chain; Pancake V2 on-chain | Relay | — | Aster + HL API | — | HL testnet; Aster testnet |
| Ethereum | 1 | `eth.llamarpc.com`, `ethereum-rpc.publicnode.com` | etherscan.io | EVM injected | Uniswap API + V3 on-chain; Pancake V2 on-chain | Relay | — | HL (chain-agnostic signing) | — | HL testnet; Aster testnet |
| Base | 8453 | `mainnet.base.org`, `base.llamarpc.com` | basescan.org | EVM injected | Uniswap API; Pancake V2 on-chain | Relay | — | HL | — | HL testnet |
| Arbitrum | 42161 | `arb1.arbitrum.io/rpc`, `arbitrum.llamarpc.com` | arbiscan.io | EVM injected | Uniswap API; Pancake V2 on-chain | Relay | — | HL | — | HL testnet |
| Polygon | 137 | `polygon-rpc.com`, `polygon.llamarpc.com` | polygonscan.com | EVM injected | Uniswap API + V3 on-chain | Relay | — | HL | — | HL testnet |
| Avalanche | 43114 | `api.avax.network/ext/bc/C/rpc`, `avalanche.llamarpc.com` | snowtrace.io | EVM injected | Uniswap API | Relay | — | HL | — | HL testnet |
| Optimism | 10 | `mainnet.optimism.io` (`relay.ts:49`) | optimistic.etherscan.io | EVM injected | — | Relay | — | HL | — | — |
| Robinhood Chain | 4663 | `rpc.mainnet.chain.robinhood.com` (`relay.ts:26-33`, `prm/chain.ts:5`) | routescan 4663 | EVM injected | PRM engine (gated) | Relay default chain | — | — | — | NOT VERIFIED |
| Aster venues | — | REST `fapi.asterdex.com` / testnet `fapi.asterdex-testnet.com` (no chain RPC used) | — | agent key (browser) | — | — | — | Aster perps | — | testnet host verified |
| Hyperliquid | HyperCore | REST `api.hyperliquid.xyz` / testnet (no EVM RPC needed) | — | any EVM wallet signs (domain chainId 1337 fixed) | — | — | — | HL perps | — | testnet verified live |
| Arc | — | — | — | — | — | — | — | — | — | No references in `src/` (grep `\bArc\b\|\bARC\b`: zero hits) |

Notes:
- Hyperliquid/Aster positions live on their own chains; the "wallet support" column means which key signs, not an RPC connection.
- Chain switching is implemented generically (`EvmWallet.tsx:109-120` `wallet_switchEthereumChain` → `wallet_addEthereumChain` fallback) and used by swaps/bridge (`EvmSwapWindow`, `BridgeWindow.tsx:377-382`).
- `VITE_*_RPC_URL` overrides exist for BSC/ETH/Base/Arbitrum/Polygon/Avalanche (`swap/chains.ts`); Polygon/Avalanche overrides are missing from `.env.example` (see §16).

---

## 5. DEX / Swap Integrations

SDK-installed vs SDK-used was checked per integration. No 0x, Raydium-swap, Drift, or other aggregator integrations exist (grep collisions only).

### 5.1 Jupiter (JUP.EXE — Solana). PARTIAL.
- Transport: `src/lib/dex/api.ts:291-379` `fetchOrder`/`executeOrder` → same-origin `/api/jup` proxy first (`jup.mjs:87-121` injects `x-api-key` server-side), direct `https://api.jup.ag/swap/v2` fallback with one retry (`api.ts:315-340`). Endpoints verified in proxy: `/swap/v2/order`, `/swap/v2/execute`, `/tokens/v2/search`, `/price/v3`.
- Flow (`DexWindow.tsx:227-371`): validate → order → parse (`parseOrder`, `api.ts:194-223`) → confirm dialog → stale re-quote (30s, `api.ts:226-231`) → wallet signs base64 VersionedTransaction (`sol.signTx`) → POST execute → Solscan link. No approval step exists (Jupiter txs are self-contained — correct, not missing).
- Slippage AUTO/0.5/1/3% (`DexWindow.tsx:526-532`), price impact + router + route labels + min-receive displayed from real fields only, MAX keeps `SOL_FEE_RESERVE` (`dex/config.ts:77`).
- Error mapping is code-matched on router+code, never message text (`api.ts:153-187`); wallet rejection, expiry, balance, gas cases covered.
- Live mainnet swap execution NOT VERIFIED (no funded run in audit). Unit suite `dex/api.test.ts` covers math/validation/errors/transport (see §18).

### 5.2 Uniswap (UNISWAP.EXE — 6 EVM chains). PARTIAL.
- API-first: `src/lib/swap/uniswap.ts:58-102` tries Trading API when proxy reports configured, falls back to on-chain. Client `src/lib/swap/uniswapApi.ts`: CLASSIC-only gate (`isExecutableRouting`, DUTCH/PRIORITY/BRIDGE/WRAP/UNWRAP/CHAINED honestly rejected), strict parsers for quote/swap responses. Proxy `api/uniswap.mjs:99-200` validates (HEX40, base-unit amount, swapper) and forwards to `trade-api.gateway.uniswap.org/v1` with `x-universal-router-version: 2.0`, `BEST_PRICE`, `protocols [V2,V3,V4]`.
- Approval model: gasless Permit2 EIP-712 (`signUniswapPermit`, `uniswap.ts`) with classic-approve→re-quote fallback to `PERMIT2_ADDRESS` (`uniswap.ts:38`).
- On-chain fallback: QuoterV2 `quoteExactInputSingle` across fee tiers `[500,3000,10000]`, SwapRouter02 `exactInputSingle` multicall (+`unwrapWETH9`/`refundETH`). Router addresses verified per-chain against official Uniswap deployment docs (BSC/ETH/Polygon in `swap/chains.ts`; Base/Arbitrum/Avalanche API-only by documented decision).
- Production proxy verified live during build sessions: `/api/uniswap?op=status` → `configured:true, mode:api`; real CLASSIC quote observed (0.01 BNB → V3 route). Live user swap NOT VERIFIED.

### 5.3 PancakeSwap (PANCAKE.EXE — BSC/ETH/Base/Arbitrum). PARTIAL.
- Pure on-chain V2: `getAmountsOut` (direct, WBNB fallback via `pancakePathCandidates`, `pancakeswap.ts:44-53`) + `swapExactETHForTokens`/`swapExactTokensForETH`/`swapExactTokensForTokens` with 20-min deadline (`pancakeswap.ts:60-127`). Router addresses verified from Pancake docs (`chains.ts`).
- Proxy `api/pancake.mjs` is status-only by design (honest 501 otherwise). Live swap NOT VERIFIED.

### 5.4 Shared EVM plumbing (both). VERIFIED WORKING at code level.
`src/lib/swap/evm.ts`: viem fallback transport across per-chain RPCs, ERC20/QuoterV2/SwapRouter02/PancakeV2 ABIs, `readTokenMeta`, balances, allowance, `walletSendTx` via EIP-1193, receipt polling with revert detection (`waitForEvmReceipt`), custom-token verification (bytecode check in `EvmSwapWindow.tsx:156-185`, non-contracts rejected). UI `EvmSwapWindow.tsx` mirrors JUP.EXE patterns (confirm dialog, stale re-quote, telemetry, explorer links).

---

## 6. Launchpad / Token Launch

### 6.1 StonkFun engine. PARTIAL (real sign + delegated broadcast; server on-chain leg NOT VERIFIED).
`LaunchDeck.tsx:307-367` → `stonkfun.ts:154-163,236-246` `POST /launches/prepare` (base `https://www.stonkfun.xyz/api/public/v1`, `stonkfun.ts:6`) → wallet signs payment tx (`SolanaWallet signBase64`) → `POST /launches/submit` → poll `GET /launches/{sig}` (`stonk.ts:79-90`, 2.5s). Mint/pool construction and broadcast are StonkFun server-side — not provable from this repo. Metadata is inline base64 logo (`stonkfun.ts:138`), no IPFS upload. Fee figures (`0.2904 SOL`, `LaunchDeck.tsx:51`) are server economics, NOT VERIFIED on-chain.

### 6.2 Ember engine. PARTIAL (same delegated pattern).
`LaunchDeck.tsx:370-402` → `ember.ts:54-92` prepare (returns txs + pre-assigned mint/pool) → sign N txs → submit by `launchId`. Proxied same-origin (`/ember` → `embercurve.fun`, `vercel.json:7`, `vite.config.ts:63-67`). Graduation thresholds (`$25K/$35K/$40K`) and 80% fee share are server-side selections, NOT VERIFIED.

### 6.3 DIRECT Meteora DBC engine. VERIFIED WORKING code path — but DISABLED and UI-UNREACHABLE.
Real local SDK flow: `Keypair.generate()` mint → `DynamicBondingCurveClient.createPool/createPoolWithFirstBuy` (`meteora.ts:62-107`) → simulate → `signTx` → `sendRawTransaction` → `confirmSignature` → `verifyLaunch` mint+pool existence gating SUCCESS (`LaunchDeck.tsx:428-482`, `transactions.ts:32-90`). BUT: requires empty `VITE_METEORA_DBC_CONFIG_*` (`meteora.ts:50-60` throws honestly) AND the UI hides it (`LaunchDeck.tsx:524` filters `direct`; engine toggles only stonkfun|ember). Graduation reads are live (`getPoolStatus`, `meteora.ts:109-155`); migration is keepers-side by design — no `migrate()` in repo. `buildSwapTx` (`meteora.ts:157-197`) has zero callers.

### 6.4 Raydium LaunchLab. NOT IMPLEMENTED (honest).
`raydium.ts:24` `RAYDIUM_LAUNCHLAB_ENABLED=false`; all methods throw `notEnabled()` (`raydium.ts:39-53`); SDK not installed; UI card disabled (`LaunchDeck.tsx:556-569`).

### 6.5 FeeVault / Portfolio / Hub. PARTIAL / read-only.
Fee claim signs + submits via StonkFun prepare/submit (`FeeVault.tsx:30-52`) — delegated, vault payout NOT VERIFIED. Hub/Portfolio are read-only queries.

### 6.6 Launch env vars.
`VITE_METEORA_DBC_CONFIG_SOL|_USDC|_DEFAULT` (empty → honest disabled), `VITE_PLATFORM_FEE_BPS=0` (client charges nothing; `platformFeeOnAmount` never called in launch path), `VITE_SOLANA_DEVNET_RPC_URL` (derived fallback), `VITE_SOLANA_CLUSTER` (explorer links only). No fake-data fallbacks.

---

## 7. Bridge

BRIDGE.EXE (Relay, SOL↔EVM). PARTIAL — quotes VERIFIED WORKING at code level; live relay fill NOT VERIFIED.
- Quote/status/index: `relay.ts:90-152` (`POST /quote/v2`, `/intents/status/v3`, `/transactions/index`), fill tracking `waitForRelayFill` (`relay.ts:154-189`, ~100×3s, refund/failure surfaced).
- SOL→EVM (`BridgeWindow.tsx:174-366`): re-quote → build V0 tx from Relay instructions + LUTs → dual-RPC simulate → Phantom sign with sign-and-send fallback → multi-RPC broadcast → 40× confirm → index → track. EVM→SOL (`368-440`): chain switch → `eth_sendTransaction` → index → track. Confirm dialogs always precede broadcast; SOL MAX keeps fee reserve.
- Chains: Solana (792703809) + RH 4663 (default) + ETH/Base/Arbitrum/Optimism/Polygon/BSC/Avalanche with hardcoded public RPCs (`relay.ts:26-53`). No Across/LayerZero/CCTP/Wormhole/Mayan code exists. Key optional (`VITE_RELAY_API_KEY`, rate limits only).

---

## 8. Perpetuals

No Drift/Lighter/GMX/dYdX/Paradex/GMX/Arcus integrations exist (grep: zero hits).

### 8.1 Aster + Hyperliquid (PERP.EXE, live route). PARTIAL.
- Market data public, browser-direct, CORS-verified during build: Aster `fapi.asterdex.com` (600 symbols observed) + testnet `fapi.asterdex-testnet.com`; HL `api.hyperliquid.xyz` (234 perps) + testnet (212 perps). Funding, marks, exchangeInfo/meta all real. **Live WS feeds added post-audit** (`lib/futures/live.ts`): HL `allMids` + `userEvents` sockets, Aster `@markPrice` + listenKey user-data stream (signed, 20-min keepalive), auto-reconnect with backoff, REST fallback, ● LIVE/○ POLL indicator.
- Auth: Aster = pasted Pro-API agent key, EIP-712 `AsterSignTransaction` v1 (chainId 1666/714 per network — verified from official docs examples), signed locally via viem, key in localStorage only **(or session-only in-memory mode, post-audit)**. HL = connected-wallet `eth_signTypedData_v4` per action (domain Exchange/1/1337) or 1-click on-chain `ApproveAgent` → local agent key; L1 construction (msgpack + keccak phantom agent) mirrors the official Python SDK exactly (`hyperliquid.ts`, `@msgpack/msgpack` dep).
- Orders: MARKET (HL: IOC ±2%; Aster: native MARKET) + LIMIT GTC, leverage presets clamped to market max with auto `updateLeverage`/`POST /fapi/v3/leverage`, positions + open orders + CLOSE (reduce-only) + CANCEL, confirm dialog, `-5050` deposit-gate and HL `$10`-minimum mapped to plain language. **TP/SL added post-audit:** reduce-only trigger panel (HL batched `tpsl` triggers in one signature; Aster `STOP_MARKET` + `TAKE_PROFIT_MARKET`).
- Defaults to MAINNET (`PerpTradeWindow.tsx:88`). Live trade execution with real funds NOT VERIFIED (never executed in audit). No TP/SL/trigger UI (both venues support trigger/algo orders — not wired).

### 8.2 Jupiter Perps engine. BUILT BUT NOT CONNECTED (parked, effectively dead).
`src/lib/perp/*` (config/types/math/api/transactions), `src/hooks/perp.ts`, `src/os/PerpWindow.tsx` have no route (`/perp` serves `PerpTradeWindow`; grep confirms zero importers outside themselves). Reads (JUP price → CoinGecko → Binance fallback, JLP info) are code-complete; `decodePosition` hardcodes `marketId:'UNKNOWN'` (`api.ts:185`), `enrichPositionsMarket` is a no-op (`api.ts:250-255`), `fetchHistoryForOwner` returns `[]` (`api.ts:285-287`), `priceSlippage` placeholder (`transactions.ts:103`). Open/close builders exist but are unreachable and NOT VERIFIED.

---

## 9. Stock / RWA

STOCK.EXE (Backpack). PARTIAL — tape VERIFIED WORKING at code level; RFQ trading code-complete, live fill NOT VERIFIED.
- Tape: `/api/v1/securities|market-sessions|market-holidays|markets|tickers` via `/backpack` proxy (`backpack/api.ts:83-101`, `vite.config.ts:68-72`, `vercel.json:10`), polled by `hooks/stock.ts`, session clock computed locally (`session.ts:28-84`).
- Trading: RFQ submit/accept/cancel UI (`StockWindow.tsx:261-324`, gated on `status.configured`) → `backpack/trade.ts` → `api/bp.mjs` which ED25519-signs server-side from `BACKPACK_API_KEY/SECRET` (never leaves server, `trade.ts:1-2`). Operator-key model: trades execute the **operator's** Backpack account, not each visitor's. No pasted keys, no wallet signatures.
- No portfolio/positions/settlement beyond balances + open RFQs (`bp.mjs:120-130`).

---

## 10. Gacha / Phygift

GACHA.EXE was **removed from the product** post-audit (icon, route, and the
now-unused `ComingSoon.tsx` deleted — it was a loader with no game behind it).
PHYGIFT INTEGRATION NOT IMPLEMENTED / NOT VERIFIED. Zero `gacha|phygift|gift|redeem`
references remain outside this report. No API client, no endpoints, no reward/payment/
inventory logic ever existed.

---

## 11. Games

SNAKE.EXE. VERIFIED WORKING (source-verified): canvas 20×20 loop (`SnakeWindow.tsx`, 140ms→70ms speedup), walls/self collision, +10/food, pause/resume/restart, arrows/WASD/Space/Enter + swipe + on-screen d-pad (mobile verified), `localStorage crt86-snake-high` persistence with NEW BEST badge. No leaderboard (local high only), no wallet association, no anti-cheat (none needed — local game). No Mario/Flappy/other games exist.

SHOOT.EXE (`src/os/ShootWindow.tsx`, wired post-audit at `/shoot` + desktop icon — source-verified): complete canvas space shooter (ready/running/paused/over phases, escalating waves, 3 foe types with HP, 3-hull lives + spawn invulnerability, auto-fire, score, `localStorage crt86-shoot-high` persistence with NEW BEST badge, keyboard + drag-steer touch + on-screen ◀▶ buttons, back-to-desktop). No leaderboard, no wallet association.

---

## 12. Wallets

Solana and EVM are handled separately (no shared abstraction).
- Solana (`SolanaWallet.tsx`): Phantom/Solflare/Backpack injected detection (priority order, `32-38`); connect, silent `onlyIfTrusted` reconnect, disconnect; SOL balance across RPC fallbacks with `balanceUnknown` state; `signTransaction` (legacy+versioned auto-detect), `signAndSendTransaction`; availability polled every 1.5s (no wallet events subscribed); no `signMessage`; no mobile deeplinks/WalletConnect.
- EVM (`EvmWallet.tsx`): raw `window.ethereum` (any injected wallet; only brand mention is MetaMask in an error string); `eth_requestAccounts`, local-only disconnect; `accountsChanged`/`chainChanged` listeners; `ethRequest` passthrough used for `eth_sendTransaction` (swaps/bridge), `eth_signTypedData_v4` (Uniswap permit in `swap/uniswap.ts:277`, HL signing in `futures/hyperliquid.ts:242,414`); generic `switchEvmChain` + RH-pinned `ensureChain`; balances left to consumers (viem).
- Minor inconsistency: taskbar hardcodes `PHANTOM` label even for Solflare/Backpack (`Desktop.tsx:127`; `Header.tsx:25` shows the real name).
- Live-wallet runtime NOT VERIFIED (source-verified only).

---

## 13. External APIs

| Provider | Purpose | Code location | Auth | Actually called? | Status |
|---|---|---|---|---|---|
| StonkFun `stonkfun.xyz/api/public/v1` | launch prepare/submit/status, pairs, fees | `lib/stonkfun.ts`, `hooks/stonk.ts`, `LaunchDeck/Hub/Portfolio/FeeVault` | none (CORS *) | yes (code) | production |
| Ember `embercurve.fun` via `/ember` | launch quotes/prepare/submit | `lib/ember.ts`, `vite.config.ts`, `vercel.json` | none | yes (code) | production |
| Jupiter Swap/Tokens/Price `api.jup.ag` | JUP.EXE quotes/execute | `lib/dex/*`, `api/jup.mjs` | server key, anonymous fallback | yes (code); proxy live `configured:true` | production |
| Jupiter Lend `api.jup.ag/lend/v1` | LEND.EXE earn/borrow | `lib/lend/*`, `api/lend.mjs` | server key, anonymous fallback | yes (code) | production |
| Uniswap Trading API `trade-api.gateway.uniswap.org/v1` | UNISWAP.EXE quotes/swap | `lib/swap/uniswap*.ts`, `api/uniswap.mjs` | server key (no anonymous) | yes (code); live CLASSIC quote observed | production |
| Relay `api.relay.link` | BRIDGE.EXE quotes/status | `lib/relay.ts`, `BridgeWindow` | optional key (limits) | yes (code) | production |
| Backpack `api.backpack.exchange` | STOCK tape + RFQ | `lib/backpack/*`, `api/bp.mjs` | tape: none; trade: server ED25519 | yes (code) | production |
| Aster `fapi.asterdex.com` (+testnet) | PERP markets/trading | `lib/futures/aster.ts` | agent EIP-712 (browser) | yes (code); 600 symbols observed | production |
| Hyperliquid `api.hyperliquid.xyz` (+testnet) | PERP markets/trading | `lib/futures/hyperliquid.ts` | wallet/agent EIP-712 (browser) | yes (code); 234/212 perps observed | production |
| Jupiter Perps/Price `perps-api.jup.ag`, `price.jup.ag` | parked engine reads | `lib/perp/*` (+ unused `vercel.json` rewrites) | keyless | code only, unreachable | parked |
| CoinGecko simple/price | SOL price labels | `hooks/useSolPrice.ts`, `BridgeWindow.tsx:82`, `lib/perp/api.ts` | none | yes (code) | production |
| Binance ticker/price | SOL fallback; JUP-perp fallback | `hooks/useSolPrice.ts`, `lib/perp/api.ts` | none | yes (code) | production |
| Solscan/pump.fun/x.com links | outbound only | various windows | n/a | links, not APIs | n/a |

No GraphQL, no WebSockets (REST polling everywhere; WS stream docs exist for Aster/HL but no WS client in repo — NOT IMPLEMENTED), no axios (fetch only).

---

## 14. Database

No database. No ORM, schema, migrations, queries. Grep for supabase|firebase|indexeddb|sqlite|prisma|drizzle: zero hits. Nothing is persisted server-side: users, wallets, transactions, launches, trades, positions, orders, scores, portfolios exist only as live API reads or in-memory/React Query cache. Browser persistence is five keys: `crt86-settings`, `crt86-snake-high`, `crt86.aster.creds.v1`, `crt86.hl.agent.v1` (localStorage), `neondos-booted`, `neondos-module` (sessionStorage).

---

## 15. Mock / Placeholder / Fake Data

Exhaustive grep (`TODO|FIXME|XXX|HACK|DUMMY|LOREM|example.com`, both cases; `mock|fake|placeholder|stub` reviewed per-hit): **no mock data paths, no fake prices/balances/hashes/addresses, no simulated success, no demo mode, no test fixtures in production.**

Honest stubs/placeholders that affect behavior (all fail loud, never fake):
- `src/lib/launch/raydium.ts:24-53` — Raydium adapter throws `notEnabled()`; UI card disabled.
- `src/lib/perp/transactions.ts:103` — `priceSlippage` placeholder constant in parked Jupiter tx builder (unreachable).
- `src/lib/swap/chains.ts` — `uniswapV3:null` for Base/Arbitrum/Avalanche restricts on-chain fallback; API still covers (documented decision, not a fake).
- Marketing-feel numbers that are NOT on-chain-verified (treat as copy, not proof): `0.2904 SOL` launch fee (`LaunchDeck.tsx:51`), `~$4,000` Ember liquidity (`LaunchDeck.tsx:57-58`), `80%` fee share, graduation `$25K/$35K/$40K`, `graduationProgress` bars (server-reported).
- `ComingSoon.tsx:12-21` fake 2.4s/99% loader — cosmetic, clearly a placeholder screen.

---

## 16. Environment Variables

Client reads use `import.meta.env` (server uses `process.env` in `api/*.mjs` only). Full table:

| Variable | Purpose | Required? | Used where | Missing risk | Exposure |
|---|---|---|---|---|---|
| `VITE_SOLANA_RPC_URL` | Solana RPC | No (public fallbacks) | SolanaWallet, dex/lend/launch/perp configs | degraded RPC | public endpoint |
| `VITE_SOLANA_CLUSTER` | explorer links | No | launch/config | cosmetic | public |
| `VITE_SOLANA_DEVNET_RPC_URL` | devnet RPC | No (derived) | launch/config | fallback | public endpoint |
| `VITE_METEORA_DBC_CONFIG_SOL|_USDC|_DEFAULT` | DIRECT pool configs | Yes for DIRECT | launch/config, meteora.ts | DIRECT honestly disabled | public (pool addrs) |
| `VITE_PLATFORM_FEE_BPS` / `_RECIPIENT` | fee policy (0) | No | launch/config (recipient unused in tx) | none | public |
| `VITE_DIRECT_DEFAULT_SLIPPAGE_BPS` | DIRECT slippage | No (=100) | meteora.ts | none | public |
| `VITE_JUPITER_API_KEY` | JUP/LEND browser fallback key | No (proxy preferred) | dex/lend/perp configs | rate limits | **client-exposed by design (dev fallback)** |
| `VITE_JUP_SWAP_API_URL` / `_TOKENS` / `_PRICE` | JUP endpoint override | No | dex/config | none | public |
| `VITE_JUPITER_PERPS_API_URL` / `VITE_JUP_PRICE_API_URL` | parked engine reads | No | perp/config | parked | public |
| `VITE_JUP_PERPS_PROGRAM_ID` / `_POOL_PUBKEY` / `_CUSTODY_*` / `_COLLATERAL_*` | parked engine on-chain ids | Yes for parked trading | perp/config, transactions.ts | parked | public |
| `VITE_PERP_RPC_URL` | shared Solana RPC | No | dex/lend/perp configs | fallback | public endpoint |
| `VITE_JUPITER_LEND_API_URL` | Lend override | No | lend/config | none | public |
| `VITE_RELAY_API_KEY` | Relay limits | No | relay.ts (client `x-api-key`) | rate limits | **client-exposed by design** |
| `VITE_BSC|ETH|BASE|ARBITRUM_RPC_URL` | EVM RPC overrides | No | swap/chains.ts | fallbacks | public endpoints |
| `VITE_POLYGON|AVALANCHE_RPC_URL` | EVM RPC overrides | No | swap/chains.ts | fallbacks | public; **missing from .env.example** |
| `JUPITER_API_KEY` | server JUP/LEND key | For quota | api/jup.mjs, api/lend.mjs | rate limits | server-only ✓ |
| `UNISWAP_API_KEY` (+`_BASE`) | server Uniswap key | For API routing | api/uniswap.mjs | on-chain fallback | server-only ✓ |
| `PANCAKESWAP_API_KEY` (+`_BASE`) | future Pancake key | No (unused) | api/pancake.mjs status only | none | server-only ✓ |
| `BACKPACK_API_KEY|_SECRET|_NAME` | server RFQ signer | For STOCK trading | tape-only mode | server-only ✓ |

`.env.example` gaps (all filled post-audit): `VITE_JUP_SWAP/TOKENS/PRICE_API_URL`, `VITE_POLYGON/AVALANCHE_RPC_URL`, `VITE_JUPITER_LEND_API_URL` documented, plus new `BP_OPERATOR_TOKEN` (optional gate). `DEX.EXE` comment refs renamed to JUP.EXE; Jupiter-perps section relabeled PARKED. No dead vars in example. Actual secret values never printed (per audit rule).

---

## 17. Routes / Pages

`src/App.tsx:100-129` (HashRouter). All reachable, no dead internal routes:

| Route | Renders | State |
|---|---|---|
| `/` | Desktop (17 icons; double-click desktop, tap mobile, Enter opens) | working shell |
| `/launchpad`, `/launchpad/launch`, `/launchpad/vault`, `/launchpad/portfolio` | Hub, LaunchDeck, FeeVault, Portfolio | working (see §6) |
| `/launchpad/trade`, `/trade` | TradeTerminal iff `RH_ENABLED`, else redirect | gated (see §3 parked) |
| `/faq`, `/roadmap`, `/x`, `/github`, `/stock`, `/money`, `/snake`, `/settings` | info/external/game/settings windows | working |
| `/perp` | **PerpTradeWindow (Aster/HL)** — parked Jupiter `JupPerpWindow` NOT routed | working (see §8) |
| `/shoot` | ShootWindow (wired post-audit) | working (see §11) |
| `/gacha` | ComingSoon | placeholder |
| `/jup`, `/dex→/jup`, `/uniswap`, `/lend`, `/bridge`, `/terminal` | swap/lend/bridge/market windows | working (see §5/§7) |
| `/launch`, `/markets`, `/vault`, `/portfolio` | legacy redirects | working |
| `*` | redirect `/` | working |
| `/launchpad/markets` | redirect `/terminal` | working |

API routes: `/api/bp|jup|lend|uniswap|pancake` (serverless in prod, vite middleware in dev). Rewrites: `/ember`, `/jup-perps`, `/jup-price`, `/backpack` (`vercel.json:6-11`; the two jup-* rewrites serve only parked code). Every executable uses the existing CRT window architecture — no standalone pages/deisgn systems introduced.

---

## 18. Tests

9 files — 7 pure unit suites plus `api/proxies.test.ts` (10 proxy contract tests:
status shapes, honest no-key 501s, validation rejections, BP operator gate) and
`src/lib/live-reads.test.ts` (3 live public-read tests: HL testnet meta, Aster testnet
exchangeInfo, StonkFun tokens). No wallet/signing tests, no Playwright/Cypress E2E.

| File | Covers | Result (run 2026 audit) |
|---|---|---|
| `lib/dex/api.test.ts` | amount math, swap validation, Jupiter error codes, transport fallback rules, quote parsing/staleness | pass |
| `lib/swap/swap.test.ts` | slippage bigint math, chain registry (verified-paths only, hex==id, unknown-chain reject), token lists, fee tiers, Pancake paths, EVM error map, input validation, quote staleness | pass |
| `lib/swap/uniswapApi.test.ts` | CLASSIC-only gate, quote/swap parsing, zero-output/failure rejection | pass |
| `lib/futures/perp.test.ts` | HL float_to_wire/size/price/wire key order/cloid/actions, order-status parsing, Aster rounding | pass |
| `lib/lend/api.test.ts` | amount math, APY formatting, earn/borrow validation, LTV guards | pass |
| `lib/launch/validation.test.ts` | launch validation, quote assets, graduation thresholds, fee math, tx states | pass |
| `lib/perp/math.test.ts` | parked Jupiter liq/pnl/leverage math | pass |

**111/111 pass (9 files).** Tests prove pure-function correctness, proxy contracts, and
live public reads; they do not prove any live trade, wallet flow, or signed execution.
Missing coverage: signing round-trips, wallet flows, E2E.

---

## 19. Build / Typecheck / Lint

Run during this audit (no configs modified):

| Command | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`, strict) | ✅ clean, zero errors |
| `npm test` (`vitest run`) | ✅ 9 files, 111/111 pass (unit + proxy contracts + live public reads) |
| `npm run lint` (eslint flat + ts + react-hooks) | ✅ 0 errors, 4 exhaustive-deps warnings in pre-existing code |
| `npm run build` (`tsc && vite build`) | ✅ succeeds (~3s local; ~24-27s on Vercel); pre-existing chunk-size warning (>500kB `web3.js` dynamic/static dual-import) and pre-existing `vite:reporter` dynamic-import notice — cosmetic |

Working tree is uncommitted (new: `src/lib/{swap,futures,lend}`, `api/{uniswap,pancake,lend}.mjs`, `EvmSwapWindow/UniswapWindow/PancakeWindow/PerpTradeWindow/LendWindow`, `DEPLOY.md`; modified: `App/Desktop/DexWindow/OsBoot/RoadmapWindow/Hub/Markets/stonk/vite.config/package files`, `.env.example`). Production deploys use the `DEPLOY.md` git-less CLI path; last deploy `✓ Ready`, alias `https://www.crt86.com`.

---

## 20. Security Findings

1. **Agent private keys in localStorage** — `crt86.aster.creds.v1`, `crt86.hl.agent.v1` (`lib/futures/types.ts:107-167`). Browser-only by design (never transmitted — verified: signing happens locally), but any XSS would exfiltrate full trading keys. **Mitigated post-audit:** session-only mode for both venues (in-memory keys, cleared on refresh; `PerpTradeWindow` SESSION ONLY switches), plus CSP headers in `vercel.json` (nosniff, no frames, https/wss-only connect). No XSS found in audit scope. Remaining: default could be flipped to session-only.
2. **Live secrets in working-tree `.env.local`** — gitignored (verified), but present on disk alongside the repo; the git-less deploy path exists partly to avoid leaking it. A `.vercelignore`/upload audit happens per deploy (`DEPLOY.md` Step 2). **Risk: low-medium (operational).**
3. **Client-exposed keys by design** — `VITE_JUPITER_API_KEY` (dev fallback), `VITE_RELAY_API_KEY` (rate limits). Blast radius limited (quotas/keys rotatable, documented). No private keys/seed phrases/mnemonics anywhere in `src/` (grep clean).
4. **Unrestricted server proxies** — `/api/*` have no per-user auth or rate limiting of their own; abuse is bounded by upstream quotas/IP limits. `/api/bp` trades the **operator's** Backpack account for any visitor when keys are loaded — **mitigated post-audit:** optional `BP_OPERATOR_TOKEN` gate (all ops except `status` require the `x-operator-token` header when set; operator pastes it once in STOCK.EXE, browser-only storage; unset = legacy open behavior).
5. **User-input handling is generally strict**: HEX40 address checks (`api/uniswap.mjs:133-147`, UI regexes for 0x40/0x64), amount digit regexes, slippage clamps, min-notional/min-lot enforcement, filter-exact rounding. No eval/innerHTML sinks seen.
6. **No auth on any route** — correct for this architecture (wallets/keys are the auth), but there is no CSRF concept needed (no cookies).
7. Secrets correctly server-side: `BACKPACK_*`, `JUPITER_API_KEY`, `UNISWAP_API_KEY`, `PANCAKESWAP_*` never appear as `VITE_` reads. No secret values printed in this report.

Nothing was exploited; findings are static-review only.

---

## 21. Dead / Unused Code

- **Parked Jupiter Perps engine** (biggest): `src/lib/perp/{api,config,math,transactions,types}.ts`, `src/hooks/perp.ts` (`usePerpTx` deliberate-throw stub, `usePerpInvalidate`), parked window renamed `src/os/JupPerpWindow.tsx` (was `PerpWindow.tsx`) — zero routes/importers. `math.test.ts` still passes but tests a parked engine.
- **Gated PRM system**: `TradeTerminal.tsx` unreachable (imported but route-guarded); `lib/prm/*` + `hooks/prm.ts` fetch paths dormant (`enabled=false`); RH taskbar/bays hidden. (Bridge still lists RH-Chain 4663 as default chain — intentional or leftover, worth a decision.)
- **Single dead exports**: `fetchEarnEarnings` (`lend/api.ts:491`), `listEngines` (`launch/engine.ts:17`), `buildSwapTx`/`derivePool`/`newBaseMint` (`launch/meteora.ts:157,201,207`), `DBC_PROGRAM_ID/DBC_POOL_AUTHORITY` (`launch/config.ts:25-26`), `PLATFORM_FEE_RECIPIENT`/`platformFeeOnAmount` (launch path), `fetchHistoryForOwner` (returns `[]`), `awaitImportBs58Sync` shim, `_envNum` helper, `enrichPositionsMarket` no-op.
- **Naming leftovers (resolved post-audit):** `DEX.EXE` survives only in `lib/dex/*` paths/comments and the `/dex→/jup` redirect (correct); parked window renamed to `JupPerpWindow.tsx`; **Raydium stub fully removed** (`raydium.ts` deleted, engine registration + `EngineId` narrowed, UI never listed it); **GACHA removed** (icon, route, and orphaned `ComingSoon.tsx` deleted).
- **Stale copy**: `SettingsWindow.tsx:73` (DEX/BRIDGE/TERMINAL "SOON"), `FaqWindow.tsx:16` (EVM wallets "when RH-CHAIN ships"), `README.md` module table (§22), `backpack/api.ts:1-4` comment (trading wired since).
- **Stray repo weight** (not dead code, flag for hygiene): `brand/` (~1.4MB media), `tmp-verify/` (screenshots), `scripts/` (2 debug scripts), `relay-chains.tmp.json`, `dist/` (build output committed? present in tree — check `.gitignore`), `.zcode/` (private plans note in README).

---

## 22. Promised vs Actually Implemented

| Promise (source) | Code found? | Real API? | Real tx? | Status |
|---|---|---|---|---|
| Launchpad StonkFun+Ember+Meteora (`README:27,49`, LaunchDeck blurbs) | yes | yes (delegated) | sign yes; broadcast server-side | 🟡 PARTIAL (DIRECT disabled) |
| PERP.EXE = Jupiter perps (`README:30,54,168`) | parked engine only | reads only | no (unreachable) | 🔴 promise stale — live perps are Aster/HL, README false |
| DEX.EXE spot swap/snipe (`README:32,55`) | renamed JUP.EXE, live | yes | code-complete, live leg not observed | 🟡 (name promise stale) |
| GACHA on-chain pulls (old README/Desktop) | removed post-audit — icon, route, placeholder deleted | — | — | 🟢 resolved (honest removal; Phygift formally dropped) |
| Bridge SOL↔7 EVMs (`README:33,52`) | yes | yes | code-complete, fill not observed | 🟡 |
| Snake + highscore (`README:35,56`) | yes | n/a (local) | n/a | 🟢 VERIFIED |
| "Real execution, no mocks" (README) | no mock paths found (post-audit grep still clean) | — | — | 🟢 holds for code present |
| "Keeper-fulfilled perps" (`README:41`) | no keeper code; HL/Aster fill off-exchange; Jupiter parked | partial | not observed | 🟡 misleading as stated |
| "Dual price-oracle fallback" (`README:41`) | JUP price→? (dex uses price API), SOL CoinGecko→Binance, JUP-perp triple fallback | yes | n/a | 🟢 mostly true |
| "No websocket dependency" (`README:166`) | true — zero WS clients | — | — | 🟢 true (also a gap: no live fills feed) |
| Roadmap: JUP → RH-CHAIN → BSC (`RoadmapWindow`) | JUP live; RH gated; BSC live for swaps/bridge only (no launch) | partial | — | 🟡 half true |
| "X.EXE @crt86vibe / GitHub CTR86/crt86" | redirect code verified | link liveness NOT VERIFIED | n/a | ❓ links unverified |
| OFFICIAL_CA "verified on Solscan" (`README:28`) | display + outbound links only; no on-chain verification in code | no | no | 🟠 UI-only; "verified" NOT VERIFIED |
| TESTNET-first perps (own convention) | testnet default was flipped to mainnet (`PerpTradeWindow.tsx:88`) | — | — | convention changed; testnet still one tap away |

---

## 23. MASTER FEATURE MATRIX

Status key: 🟢 VERIFIED WORKING · 🟡 PARTIAL · 🟠 UI/MOCK ONLY · 🔴 NOT IMPLEMENTED · ⚪ CODE EXISTS BUT NOT CONNECTED · ❓ COULD NOT VERIFY.

| Feature | UI | Backend | API | Blockchain | Real execution | DB | Tests | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| Launchpad StonkFun create | ✅ | delegated server | ✅ SF API | Solana (via server) | sign ✅, broadcast ❓ | — | — | 🟡 | `LaunchDeck.tsx:307-367`, `stonkfun.ts:236-246` |
| Launchpad Ember create | ✅ | delegated server | ✅ Ember API | Solana (via server) | sign ✅, broadcast ❓ | — | — | 🟡 | `LaunchDeck.tsx:370-402`, `ember.ts:84-92` |
| Launchpad DIRECT Meteora | ✅ (hidden) | none (SDK local) | RPC only | devnet code path | code ✅, disabled/unreachable | — | valid. | 🟡 (effectively ⚪) | `LaunchDeck.tsx:428-482`, `meteora.ts:62-107`, `LaunchDeck.tsx:524` |
| Launchpad Raydium | disabled card | — | — | — | throws | — | — | 🔴 | `raydium.ts:24-53` |
| Graduation migrate (client) | progress bars | — | — | keepers/server | none in repo | — | thresholds | 🟠/🟡 read-only | `meteora.ts:109-155`, `Hub.tsx:39` |
| FeeVault claim | ✅ | delegated | ✅ SF API | via server | sign ✅, payout ❓ | — | — | 🟡 | `FeeVault.tsx:30-52` |
| JUP.EXE swap | ✅ | `/api/jup` | ✅ Jup API | Solana wallet sign+execute | code ✅, live ❓ | — | ✅ unit | 🟡 | `DexWindow.tsx:227-371`, `dex/api.ts` |
| UNISWAP.EXE swap | ✅ | `/api/uniswap` | ✅ Trading API + on-chain | EVM sign+send | code ✅, live ❓ | — | ✅ unit | 🟡 | `EvmSwapWindow.tsx`, `swap/uniswap*.ts` |
| PANCAKE.EXE swap | ✅ | — (on-chain) | RPC | EVM sign+send | code ✅, live ❓ | — | ✅ unit | 🟡 | `swap/pancakeswap.ts` |
| PERP Aster/HL trade | ✅ | — (browser-direct) | ✅ both | wallet/agent EIP-712 | code ✅, live ❓ | — | ✅ unit | 🟡 | `PerpTradeWindow.tsx`, `futures/*` |
| Jupiter perps trade | ✅ (parked) | — | reads | — | unreachable | — | ✅ math | ⚪ | `os/PerpWindow.tsx`, `lib/perp/*` |
| LEND supply/borrow | ✅ | `/api/lend` | ✅ Lend API | Solana sign+broadcast | code ✅, live ❓ | — | ✅ unit | 🟡 | `LendWindow.tsx:293-462` |
| BRIDGE SOL↔EVM | ✅ | — (browser+Relay) | ✅ Relay | both wallets sign | code ✅, fill ❓ | — | — | 🟡 | `BridgeWindow.tsx:174-440` |
| STOCK tape | ✅ | `/backpack` rewrite | ✅ Backpack | — | reads ✅ | — | — | 🟢 | `StockWindow.tsx:54-81` |
| STOCK RFQ trade | ✅ (key-gated) | `/api/bp` ED25519 | ✅ Backpack | operator account | code ✅, fill ❓ | — | — | 🟡 | `backpack/trade.ts`, `api/bp.mjs` |
| TERMINAL/Markets feed | ✅ | — | ✅ StonkFun | — | reads ✅ | — | — | 🟢 | `Markets.tsx:196`, `stonkfun.ts:184-197` |
| MONEY coin | ✅ display | — | — | links only | — | — | — | 🟠 | `MoneyWindow.tsx` |
| GACHA | placeholder | — | — | — | — | — | — | 🟠 | `App.tsx:114` |
| SNAKE game | ✅ playable | — | — | — | local ✅ | local high | — | 🟢 | `SnakeWindow.tsx` |
| PRM/RH trading | ✅ (gated) | — | on-chain RPC | EVM (dormant) | unreachable | — | — | ⚪ | `TradeTerminal.tsx`, `config.ts:5` |
| Solana wallets | ✅ | — | RPC | sign ✅ (code) | runtime ❓ | — | — | 🟡 | `SolanaWallet.tsx` |
| EVM wallet | ✅ | — | RPC | sign/send ✅ (code) | runtime ❓ | — | — | 🟡 | `EvmWallet.tsx` |
| X/GitHub links | ✅ redirect | — | — | — | n/a | — | — | ❓ (link liveness) | `XWindow.tsx:24`, `GitHubWindow.tsx:21` |
| FAQ/Roadmap/Settings | ✅ static | — | — | — | n/a | local settings | — | 🟢 w/ stale copy | various `os/*Window.tsx` |

---

## 24. What Is Actually Production-Ready

Code-verified, needs no keys, no funds, no wallet to deliver value: SNAKE.EXE (game+highscore),
TERMINAL.EXE/Markets feed, STOCK tape, FAQ/ROADMAP/SETTINGS shells, X/GITHUB redirects (code),
Desktop/OS boot/module-loader chrome, mobile responsive shell. Code-complete execution paths
(swaps, perps, lend, bridge, RFQ, launches) are built to production standard (validation →
confirm → sign → submit → confirm → refresh, honest errors, no mocks) — what is missing for
each is only an observed live run, not more code.

---

## 25. What Is Partially Built

Everything with 🟡 above: all six trade-execution flows (JUP/UNISWAP/PANCAKE/PERP-Aster/PERP-HL/LEND/BRIDGE/RFQ/StonkFun/Ember/FeeVault) — real reads plus complete sign-and-submit
plumbing, live settlement unobserved. DIRECT Meteora (complete but unconfigured+hidden).
PRM system (complete but flag-gated). Jupiter-perps reads (complete but parked).

---

## 26. What Is Missing

- Any live-trade verification record (no testnet/mainnet run log exists in repo).
- GACHA decisively (UI placeholder only); Phygift entirely (zero references).
- Raydium LaunchLab (stub); DIRECT mainnet config + UI enablement; client-side migration tx.
- TP/SL/trigger-order UI for Aster/HL (protocols support it).
- WebSocket live feeds (orders/fills/positions) on both perp venues.
- LINT tooling; integration/E2E tests; wallet e2e; proxy e2e.
- `.env.example` gaps (§16); `README.md`/Settings/FAQ copy refresh (§22).
- Dead-code removal or revival decision for the parked Jupiter engine.
- CSP/security headers; operator gate on `/api/bp` trade ops; agent-key storage hardening.
- Preview-env `UNISWAP_API_KEY` (production only at audit time).

---

## 27. Recommended Engineering Backlog

**Missing functionality:** GACHA build-or-remove decision; Phygift verdict; Raydium adapter or delete stub; DIRECT mainnet config + unhide; TP/SL UI for perps; WS user-data streams (Aster listenKey, HL `wss://api.hyperliquid.xyz/ws`); operator gate for `/api/bp`.
**Partial functionality:** live verification runs (testnet first) for all six execution flows with a run log; DIRECT devnet end-to-end once configs exist; PRM flag-flip decision + RH liquidity check.
**Integration work:** `.env.example` gaps; Settings/FAQ/README copy refresh; rename parked `PerpWindow` file; decide RH-Chain default in Bridge; single shared `SwapProvider`-style interface for perps (HL/Aster already share `PerpProvider` — extend to Jupiter engine or delete it).
**Bugs:** Desktop taskbar `PHANTOM` hardcode (`Desktop.tsx:127`); HL limit-price 5-decimal cap vs on-chain tick rules (server rejects loudly — confirm worst cases); Aster close ignoring `markPx` param (passed but unused — actually fine, MARKET close; remove param or use for slippage guard).
**Testing:** integration tests against testnets (quote→sign→submit on HL/Aster testnets, Jupiter devnet, Relay small amounts); proxy contract tests for `/api/*` (status/validation/error shapes); wallet-mock signing round-trip tests; E2E smoke (boot→desktop→open each EXE) via Playwright.
**Security:** CSP + `X-Content-Type-Options` headers (vercel.json); encrypt or session-scope agent keys (offer in-memory-only mode); audit `/api/bp` operator exposure; document Vercel Authentication boundary (raw `*.vercel.app` URLs wall, custom domain public — observed during deploys).
**Infrastructure:** add `npm run lint` (eslint + config) and wire into `DEPLOY.md`; `.vercelignore` to codify upload excludes (currently relies on `DEPLOY.md` robocopy excludes); remove or gitignore `dist/` + `tmp-verify/` + `relay-chains.tmp.json` from the tree; decide `brand/` + `scripts/` + `.zcode/` publishing boundary (README already marks brand/.zcode unpublished — verify `.gitignore` covers them).

---

# CRT86 — REAL BUILD STATUS

## 🟢 VERIFIED WORKING
SNAKE.EXE (playable, persistent highscore) · SHOOT.EXE (playable wave shooter, persistent
highscore, wired post-audit) · TERMINAL.EXE market wire over live StonkFun feed ·
STOCK.EXE public tape · Desktop/OS boot/module-loader/window chrome · FAQ/ROADMAP/SETTINGS shells ·
X/GITHUB redirect code · toolchain (typecheck clean, 98/98 tests, build green) · zero-mock codebase
discipline (stubs throw, errors honest).

## 🟡 PARTIALLY BUILT
JUP.EXE · UNISWAP.EXE (API live + on-chain fallback) · PANCAKE.EXE · PERP.EXE Aster + Hyperliquid ·
LEND.EXE earn/borrow · BRIDGE.EXE both directions · STOCK RFQ · StonkFun/Ember launches · FeeVault
claim — all with real reads and complete sign→submit→confirm plumbing; live settlement unobserved.

## 🟠 UI / MOCK ONLY
MONEY.EXE (display + outbound links) · graduation displays (server
numbers, no client migration) · OFFICIAL_CA "verified" claim (no on-chain check in code).
(GACHA.EXE removed post-audit; was UI-only.)

## 🔴 NOT BUILT
Phygift (zero references — formally dropped post-audit) · LAUNCH.EXE/MARKET.EXE/DEX.EXE as
names (never existed; DEX renamed) · any database · WebSocket *order* submission is N/A
(markets/user-events WS live; submission stays REST by venue design).

## ⚪ BUILT BUT NOT CONNECTED
Jupiter Perps engine (`lib/perp`, `hooks/perp`, `os/PerpWindow` — no route) · PRM/Robinhood system
(`RH_ENABLED=false`; engine + terminal complete, bridge still lists 4663) · DIRECT Meteora flow
(complete, unconfigured, UI-hidden) · `fetchEarnEarnings`, `buildSwapTx`, misc dead exports (§21) ·
`/jup-perps` + `/jup-price` prod rewrites (serve parked code only).

## ❓ NOT VERIFIED
Live trade/swap/bridge/lend/RFQ/launch fills (no funded runs) · X/GitHub URL liveness · server-side
broadcast legs (StonkFun/Ember pool creation, vault payouts) · on-chain fee enforcement · live-wallet
runtime behavior (mobile wallets especially) · Jupiter-perp PDA/discriminator correctness.

---

# TOP 20 THINGS TO FINISH (post-completion status)

**Missing functionality**
1. ~~Decide GACHA~~ — DONE (icon, route, and orphaned `ComingSoon.tsx` removed).
2. ~~Phygift verdict~~ — DONE (formally dropped; zero references remain).
3. ~~Raydium LaunchLab~~ — DONE (`raydium.ts` deleted, registration + `EngineId` narrowed).
4. DIRECT mainnet: deploy pool configs, set `VITE_METEORA_DBC_CONFIG_*`, unhide the engine card — **OPEN (needs a funded on-chain deployment; not doable from code alone).**
5. ~~TP/SL + trigger orders UI~~ — DONE (reduce-only triggers both venues + UI panel).
6. ~~WebSocket user-data streams~~ — DONE (HL allMids/userEvents, Aster markPrice/listenKey, auto-reconnect + REST fallback).
7. Client-side migration/graduation transactions (keepers/server-only today) — OPEN.

**Partial functionality**
8. Live verification runs — PARTIAL (public reads verified live; signed trade execution still needs funded wallets + user signatures).
9. PRM decision: flip `RH_ENABLED` with liquidity check, or remove the system + bridge default — OPEN (strategy call).
10. Parked Jupiter engine: revive (route + custody) or delete — OPEN (kept; file renamed `JupPerpWindow.tsx`).

**Integration work**
11. ~~Fill `.env.example` gaps~~ — DONE (incl. `BP_OPERATOR_TOKEN`).
12. ~~Refresh stale copy~~ — DONE (README table/structure/env, Settings, FAQ, Backpack header, JUP/parked labels).
13. ~~codify upload excludes~~ — DONE (`.vercelignore` added).

**Bugs**
14. ~~Desktop taskbar `PHANTOM` hardcode~~ — DONE (shows real `walletName`).
15. HL limit-price tick behavior at extremes — documented as server-enforced with loud rejections; extremes unobserved — OPEN (minor).
16. ~~Aster close `markPx`~~ — DONE (shared-interface param; MARKET close needs no price).

**Testing**
17. ~~Integration + proxy tests~~ — DONE (`api/proxies.test.ts`, `live-reads.test.ts`); still missing: signing round-trips, wallet flows.
18. Playwright E2E smoke — OPEN (no browser harness installed).

**Security**
19. ~~CSP headers, session-only keys, `/api/bp` gate~~ — DONE. Remaining: consider defaulting agent keys to session-only.

**Infrastructure**
20. ~~Lint~~ — DONE (`npm run lint`, 0 errors, 4 warnings). ~~Preview `UNISWAP_API_KEY`~~ — still manual (CLI branch prompt); ~~tree cleanup~~ — verified all gitignored + `.vercelignore`. Wire lint into DEPLOY.md — DONE (Step 2b gate).

---

## 28. Post-Audit Completion Log

Everything above marked DONE was executed after the audit with zero git-history changes
(all work uncommitted, deploys via the `DEPLOY.md` git-less path). Final gates:
`typecheck` clean, `111/111` tests pass (9 files), `lint` 0 errors, `vite build` green.
Live-verified post-completion: Uniswap CLASSIC quote (BSC), Jupiter quote with tx,
Lend earn tokens + borrow vaults, Backpack tape, HL/Aster testnet reads (automated in
`live-reads.test.ts`). Signed trade execution remains user-side (funded wallets required).

Deliberately left OPEN (need human/funds/strategy, not more code): DIRECT mainnet configs,
PRM flag decision, parked-Jupiter revive-or-delete, funded live-trade runs, Playwright E2E,
Preview `UNISWAP_API_KEY` (manual dashboard step), session-only as default, client-side
migration txs.
