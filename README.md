# CRT86 — Decentralized CRT Trading Terminal

> **CRT-DOS 6.86** — Launch, trade, bridge and play without leaving the terminal. Retro by design, Solana-native by execution. Live at **https://www.crt86.com**.

CA :

![License: MIT](https://img.shields.io/badge/License-MIT-pink.svg)
![Build](https://img.shields.io/badge/build-vite%20%2B%20react%2019-cyan)
![Solana](https://img.shields.io/badge/Solana-mainnet--beta-purple)

CRT86 is an **all-in-one decentralized terminal** that packs launchpad, market wire, bridge, perpetuals and mini-games into a single CRT. No tab hell — `DEV → TRADE → PLAY` in one session, one wallet popup, one neon screen.

This repo is the **public, decentralized release** of the CRT86 frontend. Community-owned, MIT-licensed, verifiable.

**Organization:** [`CTR86`](https://github.com/CTR86) · **Repo:** [`CTR86/crt86`](https://github.com/CTR86/crt86) · **Handle:** `@crt86vibe` on X

---

## Why CRT86

**1. Retro is retention.** `#08010f` void, `Press Start 2P + VT323`, `bevel-btn`, scanlines, SFX on every click, monochrome phosphor night mode, Konami hyper mode. In a sea of glassmorphism clones, the terminal you *remember* is the terminal you return to.

**2. All-in-one terminal, not a page.** Others make you jump: launch on A → verify on B → bridge on C → trade on D. CRT86 is:

```
CRT-DOS 6.86
├── LAUNCHPAD.EXE  · Multi-engine launcher (StonkFun + Ember + Meteora DBC devnet)
├── MONEY.EXE      · Official coin — CA + Solscan links
├── STOCK.EXE      · Backpack tokenized US stocks — public tape; RFQ needs server key
├── PERP.EXE       · Hyperliquid + Aster perps — long/short, leverage, TP/SL (mainnet)
├── JUP.EXE        · Jupiter Solana swaps (order → sign → execute)
├── UNISWAP.EXE    · Uniswap Trading API (CLASSIC) + on-chain V3 fallback · 6 EVM chains
├── PANCAKE.EXE    · PancakeSwap V2 on-chain swaps
├── LEND.EXE       · Jupiter Lend — earn supply/withdraw + borrow operate
├── BRIDGE.EXE     · Relay — SOL ↔ EVMs, tracked fills
├── TERMINAL.EXE   · Market wire (StonkFun feed)
├── SNAKE.EXE      · Wire worm — highscore in localStorage
├── SHOOT.EXE      · Star ranger — waves, hull, highscore in localStorage
├── X.EXE          · @crt86vibe
├── GITHUB.EXE     · source — github.com/CTR86/crt86
└── FEE VAULT / PORTFOLIO / HUB / ROADMAP / FAQ
```

**3. Real execution, no mocks.** Multi-RPC broadcast, simulation before sign, keeper-fulfilled perps, Relay indexing + fill tracking, dual price-oracle fallback, honest `NOT-CONFIGURED` states instead of fake data.

---

## Features

| Module | Status | Stack |
|---|---|---|
| **Launchpad** | Live (StonkFun + Ember delegated; Meteora DBC devnet, unconfigured) | StonkFun `api/public/v1` + Ember (`embercurve.fun`) + Meteora DBC SDK · `ZERO PLATFORM FEE` |
| **Money.exe** | Live (display + links) | Official CA · Pump/Solscan links |
| **Stock.exe** | Live tape, RFQ needs key | Backpack `api.backpack.exchange` via `/backpack` + `/api/bp` ED25519 server signer |
| **Perp.exe** | Live (mainnet default, testnet toggle) | Hyperliquid (wallet/agent EIP-712) + Aster (agent key, browser-only) · market/limit/TP/SL/close · WS live marks |
| **Jup/Uniswap/Pancake.exe** | Live | Jupiter `/api/jup` proxy · Uniswap Trading API via `/api/uniswap` + V3 fallback · Pancake V2 on-chain |
| **Lend.exe** | Live (reads + wallet tx) | Jupiter Lend `api.jup.ag/lend/v1` via `/api/lend` proxy |
| **Bridge.exe** | Live | Relay `api.relay.link` · quote → confirm → sign → `waitForRelayFill` |
| **Terminal / Hub / Portfolio / Fee Vault** | Live | `@tanstack/react-query` polling, block-chart `Scope` canvas |
| **Snake.exe / Shoot.exe** | Live | Canvas, keyboard + touch, `crt86-snake-high` / `crt86-shoot-high` persistence |

Desktop is fully responsive — grid snaps `4 → 3 → 2` columns, mobile `TAP TO OPEN`, OS taskbar with `PHANTOM` / `CA` / `SOON` badges.

---

## Tech Stack

- **Runtime:** Vite 7 + React 19 + TypeScript 5.9 (strict) + React Router 7 (HashRouter) + Zustand
- **Chain:** `@solana/web3.js` 1.98 + `viem` 2.38 + `@tanstack/react-query` 5.90 + `bs58` + `bn.js` + `@msgpack/msgpack` (Hyperliquid action hashing)
- **Curve:** `@meteora-ag/dynamic-bonding-curve-sdk` 1.5 + `@fontsource/*`
- **Infra:** Vercel (serverless `/api/bp|jup|lend|uniswap|pancake` + rewrites `/ember/*`, `/backpack/*`), Helius RPC primary, public fallbacks
- **Testing:** Vitest 5 — launch validation, dex/swap/uniswap/futures/lend parsing + math (7 files, 98 tests)

---

## Getting Started

```bash
# 1. Clone (org: CTR86)
git clone https://github.com/CTR86/crt86.git
cd crt86

# 2. Install
npm install

# 3. Configure — copy and fill secrets locally (never commit .env.local)
cp .env.example .env.local
# edit .env.local: VITE_SOLANA_RPC_URL, VITE_JUPITER_API_KEY, etc.

# 4. Run
npm run dev        # http://localhost:5173
npm run build      # tsc && vite build → dist/
npm run preview
npm run typecheck  # tsc --noEmit
npm test           # vitest run
```

**Wallets:** Phantom / Solflare / Backpack (Solana) for launch + fees + perps; any EVM wallet (MetaMask etc.) for Bridge / future RH-Chain.

**Live:** https://www.crt86.com · **X:** https://x.com/crt86vibe · **GitHub:** https://github.com/CTR86/crt86

---

## Environment

Copy `.env.example` → `.env.local`. High-value secrets are server-only (`/api/*`
proxies inject them); `VITE_*` is public by design — `VITE_JUPITER_API_KEY` and
`VITE_RELAY_API_KEY` exist only as local-dev/rate-limit fallbacks.

Key variables: `VITE_SOLANA_RPC_URL`, `VITE_SOLANA_CLUSTER`,
`VITE_METEORA_DBC_CONFIG_*` (DIRECT engine, empty = honestly disabled),
`VITE_PLATFORM_FEE_BPS=0`, `JUPITER_API_KEY` (server, JUP+LEND),
`UNISWAP_API_KEY` (server, API-first routing), `BACKPACK_API_KEY|_SECRET|_NAME`
(server ED25519 RFQ signer), `VITE_RELAY_API_KEY` (optional limits),
`VITE_{BSC,ETH,BASE,ARBITRUM,POLYGON,AVALANCHE}_RPC_URL` (optional overrides).
Full list with docs in `.env.example`.

No `.env.local` is committed. The public repo ships only `.env.example`.

```ini
VITE_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
VITE_SOLANA_CLUSTER=mainnet-beta
VITE_SOLANA_DEVNET_RPC_URL=
VITE_METEORA_DBC_CONFIG_SOL=
VITE_METEORA_DBC_CONFIG_USDC=
VITE_METEORA_DBC_CONFIG_DEFAULT=
VITE_PLATFORM_FEE_BPS=0
VITE_PLATFORM_FEE_RECIPIENT=
VITE_DIRECT_DEFAULT_SLIPPAGE_BPS=100
VITE_JUPITER_PERPS_API_URL=https://perps-api.jup.ag
VITE_JUP_PRICE_API_URL=https://price.jup.ag
VITE_JUPITER_API_KEY=
VITE_PERP_RPC_URL=
VITE_JUP_PERPS_PROGRAM_ID=PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu
VITE_JUP_POOL_PUBKEY=5BUwFW4nRbftYTDMbgSyAoCjRmVdJiuPACx2A9GPeDCW
VITE_JUP_CUSTODY_SOL=7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz
VITE_JUP_CUSTODY_ETH=AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn
VITE_JUP_CUSTODY_WBTC=5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm
VITE_JUP_COLLATERAL_CUSTODY_USDC=G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa
VITE_RELAY_API_KEY=
```

No `.env.local` is committed. The public repo ships only `.env.example`.

---

## Project Structure

```
public/              # favicon.svg, brand assets
api/                 # serverless: bp (Backpack signer), jup, lend, uniswap, pancake
src/
  App.tsx            # HashRouter + NeonOs + LaunchpadModule + routes
  config.ts          # RH_ENABLED (false) + OFFICIAL_CA
  design/            # CrtShell, Panel/Readout/Field/SystemDialog, MobileNotice
  components/        # Header, StatusBar, TickerTape
  hooks/             # stonk / stock / prm / perp (parked) / useSolPrice / launchDirect
  lib/
    stonkfun.ts      # SF_BASE public API, no key, CORS *
    ember.ts         # /ember proxy
    relay.ts         # Relay v2 quote/index/status, decimal fix for SOL 9 vs EVM 18
    format.ts        # fmtUsd/Price/Addr/blocks
    launch/          # config + validation + Meteora DBC engine + tx builders
    dex/             # Jupiter swap client (JUP.EXE)
    swap/            # shared EVM plumbing + Uniswap (API-first) + PancakeSwap V2
    futures/         # Hyperliquid + Aster clients, Solana-free EIP-712 signing
    backpack/        # Backpack tape + RFQ trade client (server signs)
    lend/            # Jupiter Lend earn/borrow client
    perp/            # PARKED Jupiter-perps engine (no live route)
    prm/             # Robinhood Chain 4663 chain/abis/discovery/quotes/swaps (flag-gated)
  os/                # Desktop, ModuleLoader, OsBoot, Money/Snake/Shoot/Bridge/Stock/Lend/
                     # Jup/Uniswap/Pancake shared EvmSwapWindow, PerpTradeWindow,
                     # JupPerpWindow (parked), Faq/Roadmap/Terminal/X/GitHub/Settings
  pages/             # Hub, LaunchDeck, TradeTerminal (gated), FeeVault, Portfolio, Markets
  wallets/           # SolanaWallet (Phantom/Solflare/Backpack) + EvmWallet (EIP-1193)
  store/             # ui / settings / terminal
  styles/            # theme.css / components.css / crt.css / base.css
  sound/             # WebAudio sfx (click/boot/coin/alert/launch/win/error/open)
brand/               # (not published — marketing sources, gitignored)
.zcode/              # (not published — private plans, gitignored)
vercel.json          # rewrites: /ember, /backpack (+ parked /jup-perps, /jup-price)
vite.config.ts       # dev: /api/* middleware + /ember + /backpack proxies
```

---

## Architecture Notes

- **Wallet:** Single Solana wallet (`SolanaWalletProvider`) injected via `window.phantom/solflare/backpack`. `signTx` + `signAndSendTransaction` both supported; Launch flows `sign` then multi-RPC `sendRawTransaction`; Bridge falls back to `signAndSend` when Phantom blocks pure sign.
- **Data:** `useQuery` with `retry:1`, `staleTime`/`refetchInterval` tuned per feed (tokens 10s, JLP 30s, prices 20s). No websocket dependency (RH-Chain has none).
- **Trading flow (honest):** `validate → quote/preview → SystemDialog confirm → wallet sign (once) → send → confirm → refresh`. Simulation (`simulateTransaction`) before sign; never auto-sign; never fake `txHash` or mock positions.
- **Perps:** Hyperliquid (wallet or 1-click on-chain agent, EIP-712) and Aster (browser-only agent key). Leverage set on order, reduce-only close + TP/SL triggers, WS live marks with REST fallback. Testnet toggle, mainnet default — real PnL only on mainnet. (Legacy Jupiter-perps engine parked, no route.)
- **Bridge decimal bug fixed:** `currencyOutHuman` reads `currencyOut.currency.decimals` (Relay v2) with `SOL→9` fallback — fixes `0.00000 SOL` quotes.

---

## Security

- No private keys, mnemonics or secrets are logged or committed. Credentials are referenced by path only.
- `VITE_*` is public by design — if a key must stay server-side, move it to `/api/*` and proxy.
- No auto-sign, no `eth_sendTransaction` without user popup, no mock success.
- Report issues privately: open an issue with `security` label or DM `@crt86vibe`.

---

## Contributing

PRs welcome — this is a decentralized codebase.

1. Fork `CTR86/crt86` → branch `feat/your-exe`
2. `npm install && npm run typecheck && npm test && npm run build`
3. Keep the CRT system: reuse `Panel`/`Readout`/`Field`/`bevel-btn`/`warn-strip`/`SystemDialog` — do not introduce a second design system.
4. No secrets in PRs. Update `.env.example` with placeholders only.
5. Open PR with screenshots for desktop + mobile (≤820px).

---

## License

MIT © 2026 CRT86 — see [LICENSE](./LICENSE). Not affiliated with StonkFun, Jupiter, Relay, Robinhood or 1986.

*Boot the CRT. Stay in the terminal.*

