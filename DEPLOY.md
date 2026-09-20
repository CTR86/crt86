# DEPLOY.md — How to deploy updates to Vercel (AI agent runbook)

> **Always use this method. It works. Do not use any other deploy path.**
>
> Context: the GitHub account and the Vercel account have **different
> names/emails**. Any deploy path that touches git identity gets blocked
> with: *"the commit email could not be matched to a GitHub account."*
> The method below sends **zero git metadata** to Vercel, so the email
> check never triggers. No git config changes, no history rewrites, ever.

## Prerequisites (one-time, already done)

- Vercel CLI installed and authenticated: `vercel whoami` shows
  `iamatulkumar67-8695` (CLI token auth — never `vercel login` via GitHub).
- Project linked: `.vercel/project.json` exists (`neon-launch-86`).
- Project has **no Git repository connected**
  (`vercel git disconnect` reports "No Git repository connected" — keep it that way).

## Step 0 — New server env vars first (if any)

If the update introduces a new server-side secret, add it to Vercel
**before** deploying. Never print the value. Pull it from `.env.local`
into a temp file, pipe it via stdin, delete the temp file:

```powershell
$line = Select-String -Path ".env.local" -Pattern '^VAR_NAME=' | Select-Object -First 1
$val = $line.Line -replace '^VAR_NAME="?([^"]*)"?$','$1'
$tmp = "$env:TEMP\opencode\deploy_key.txt"
Set-Content -NoNewline -Path $tmp -Value $val
Get-Content $tmp -Raw | vercel env add VAR_NAME production
Remove-Item $tmp -Force
```

Verify with `vercel env ls` (values show as `Encrypted`).

Notes:
- `preview` env prompts for a git branch interactively and is unreliable
  over stdin — Production is what matters; preview falls back gracefully.
- `.env.local` is gitignored and must **never** be uploaded (see Step 1).

## Step 1 — Build a clean, git-less deploy copy

```powershell
$src = "C:\Users\monkey\Desktop\zaiproject\80's launchpad"
$dst = "$env:TEMP\opencode\crt86-deploy"
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
New-Item -ItemType Directory -Path $dst | Out-Null
robocopy $src $dst /E /XD .git node_modules dist .vercel tmp-verify .zcode /XF .env.local /NFL /NDL /NJH /NJS
New-Item -ItemType Directory -Path "$dst\.vercel" | Out-Null
Copy-Item "$src\.vercel\project.json" "$dst\.vercel\project.json"
```

Excluded and why: `.git` (the whole point — no commit metadata),
`node_modules`/`dist` (rebuilt remotely), `.env.local` (**live secrets**),
`.vercel` (stale state; only `project.json` link is re-added).

## Step 2 — Secret-scan the copy (mandatory, blocks deploy on hit)

```powershell
$hits = Get-ChildItem -Path $dst -Recurse -File |
  Where-Object { $_.Name -notmatch '^(DEPLOY|AUDIT_REPORT)\.md$' } |
  Select-String -Pattern "HxBw78rUwMZ|cc2bef94|jup_4e298e|lMxWYlaTx|VFLYRVfn" |
  Select-Object -First 3
if ($hits) { Write-Output "SECRETS FOUND - ABORT" } else { Write-Output "CLEAN - deploying" }
```

> Note: this doc itself is excluded from the scan because it contains the
> pattern fragments above. Never paste a real key value into any doc file.
> Extend the pattern list whenever a new secret format is introduced.

## Step 2b — Gates must be green (mandatory)

```powershell
npm run typecheck; npm test; npm run lint; npm run build
```

All four must pass locally before deploying. `lint` allows its 4 known
exhaustive-deps warnings (exit 0); any error blocks the deploy.

## Step 3 — Deploy from the copy

```powershell
vercel deploy --prod --yes 2>&1 | Tee-Object -FilePath "$env:TEMP\opencode\vercel_deploy.log"
```

Expect: upload → remote `npm install` → `tsc && vite build` → `✓ Ready in ~40s`
→ aliased to `https://www.crt86.com`. The command may take several minutes;
do not abort it early (an aborted client does not stop the remote build,
but you lose the result line).

## Step 4 — Verify production (anonymous, like a visitor)

```powershell
Invoke-WebRequest -Uri "https://www.crt86.com/" -UseBasicParsing -TimeoutSec 20
Invoke-WebRequest -Uri "https://www.crt86.com/api/uniswap?op=status" -UseBasicParsing -TimeoutSec 20
Invoke-WebRequest -Uri "https://www.crt86.com/api/jup?op=status" -UseBasicParsing -TimeoutSec 20
```

For authenticated/bypass checks (Deployment Protection walls raw
`*.vercel.app` URLs): `vercel curl /api/uniswap?op=status`.

## Step 5 — Cleanup

```powershell
Remove-Item "$env:TEMP\opencode\crt86-deploy" -Recurse -Force
```

## How to read deployment states (`vercel ls`)

| Status | Meaning | Action |
|---|---|---|
| `● Ready` | Live (or superseded) build, healthy | None |
| `UNKNOWN`, no duration, no logs | **Blocked** — Vercel rejected it (e.g. git-email mismatch). It will never build. Production alias stays on the last Ready deploy. | Redeploy with this runbook |
| `UNKNOWN` right after deploy | May still be building — wait, then `vercel inspect <id>` | Wait 2–3 min, re-check |

## Forbidden paths (they get blocked)

- `git push` expecting auto-deploy (no repo connected — nothing happens).
- `vercel git connect` (re-links identity checks).
- Changing `git config user.email` or rewriting history to satisfy matching.
- `vercel login` via GitHub (wrong account — different email).
- Deploying from the repo directory directly (sends git commit metadata).
- Uploading `.env.local` anywhere, ever.
