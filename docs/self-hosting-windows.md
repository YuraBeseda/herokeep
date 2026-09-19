# Self-hosting Herokeep on a Windows PC (Adapter B)

This is the operator runbook for ADR-014's Adapter B deployment recipe: running the herokeep
backend yourself, on a Windows PC with a static (or effectively static, via dynamic DNS) network
presence, at zero cost, instead of Cloudflare. Read `docs/01-decisions/ADR-014-*.md` for the design
rationale; this document is only the step-by-step "what to actually type" version.

Everything below was checked against the shipped code on 2026-09-19 (`apps/api/src/adapters/node/`,
`apps/api/scripts/seed-api.ts`, `apps/api/src/cli/admin.ts`, `.github/workflows/deploy.yml`) — most
of it by actually running it (a zip-layout install, a server boot, a seed, an admin export, and the
two PowerShell scripts) against a simulated copy of the real bundle. Where a step could not be run
here (things that need a second machine, a router, or elevated/administrator rights this session
did not have), that is called out explicitly.

## Who this is for

You have a Windows PC that can stay on and reachable (a home server, an always-on desktop) and
would rather run your own copy of the backend than rely on Cloudflare. You don't need Docker, WSL,
or a Linux box — this runs Node natively on Windows.

## Prerequisites

- **Node 24** (matches `package.json`'s `engines.node: ">=24.15.0 <25"`). Install from
  [nodejs.org](https://nodejs.org) (the Windows installer) or via a version manager. Verify with
  `node -v`.
- **A native build toolchain**, if `better-sqlite3`'s prebuilt binary doesn't match your exact Node
  version (see "Install the server" below for why this matters) — Visual Studio Build Tools
  ("Desktop development with C++" workload) and Python 3. Skip this and try the install first; only
  install these if `pnpm install` fails trying to compile `better-sqlite3`.
- **pnpm**, via corepack: `corepack enable` (ships with Node).
- Administrator rights on the PC, for the firewall and NSSM service steps later.
- A router you can configure port forwarding on.

## 1. Getting the server

Two ways to get a copy of the server to run:

**A. Download the release artifact** — every push to `main` runs
`.github/workflows/deploy.yml`'s `build-server-artifact` job, which uploads a
`herokeep-server-<version>` GitHub Actions artifact (a zip). Download it from the Actions run's
Summary page, and unzip it to somewhere like `C:\Herokeep\herokeep-server`.

**B. Build from source** — clone the repo, then from the repo root:

```powershell
pnpm install
pnpm --filter web build
```

then copy `apps\api\src`, `apps\api\scripts`, `apps\api\package.json`, `apps\api\.env.example`,
`packages\protocol\dist`, `packages\protocol\package.json`, and `apps\web\dist` into your target
layout yourself, matching what `build-server-artifact` assembles (see that job's `run:` step for
the exact list — it's short).

Either way, you end up with this layout:

```
herokeep-server-<version>\
  apps\api\src\...
  apps\api\scripts\...
  apps\api\package.json
  apps\api\.env.example
  apps\web\dist\...
  packages\protocol\dist\...
  packages\protocol\package.json
  pnpm-workspace.yaml
```

### Install step

The zip ships **server source, not `node_modules`** — you install dependencies once, on the target
machine. This needed one real fix to actually work, which is now baked into the bundle: `apps/api`'s
`package.json` depends on `@hk/protocol: workspace:*`, and a zip containing only `apps/api`'s own
source has no workspace for that to resolve against — a plain `pnpm install` there fails outright
with `Cannot resolve package from workspace because workspace packages were not loaded into the
resolver` (reproduced verbatim while writing this doc). The bundle now also carries a pre-built,
dist-only copy of `packages/protocol` and a minimal `pnpm-workspace.yaml` naming both packages, so
the install below actually works — verified end to end (install, boot, seed, `herokeep-admin
export`) against a simulated copy of the real bundle layout on 2026-09-19.

```powershell
cd herokeep-server-<version>\apps\api
pnpm install --prod
```

This pulls `@hono/node-server`, `better-sqlite3`, `drizzle-orm`, `hono`, and `ws` (`apps/api`'s own
`dependencies`), and links `@hk/protocol` to the vendored copy alongside it. `better-sqlite3` has a
native module: pnpm tries a prebuilt binary first and falls back to compiling from source via
`node-gyp` if none matches your exact Node build — that fallback is what this test actually
exercised (a full native compile ran, ~20s, needing MSBuild + Python, both of which happened to
already be present on the machine this was tested on). If `pnpm install` fails on `better-sqlite3`'s
`node-gyp rebuild` step, install Visual Studio Build Tools ("Desktop development with C++") and
Python 3, then retry.

Verify the install worked:

```powershell
$env:HK_PORT = 8787
node src\adapters\node\server.ts
```

You should see `herokeep node adapter listening on http://127.0.0.1:8787 (data: ...)` — Ctrl-C to
stop it; you'll run it as a service shortly. (This first run will actually fail with a "Missing
required config value" error until you've done the next step — that's expected and correct;
`assertConfigured` refuses to boot on a placeholder/missing secret. Come back to this check after
step 2.)

## 2. Configure `.env`

Copy `apps\api\.env.example` to `apps\api\.env` and replace every value:

```powershell
Copy-Item apps\api\.env.example apps\api\.env
```

### The three secrets

`SESSION_PEPPER` and `SALT_HMAC_KEY` are independent random values (ADR-012's exact auth design) —
generate each with a fresh run of one of these (any of the three is fine; use a different one for
each of the two secrets):

```powershell
# PowerShell (Windows PowerShell 5.1-compatible -- .NET 5+'s RandomNumberGenerator.Fill /
# Convert.ToHexString are NOT available on 5.1, so this uses the older RNGCryptoServiceProvider
# API instead. Verified to run on 2026-09-19.)
$bytes = New-Object byte[] 32
$rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
$rng.GetBytes($bytes)
-join ($bytes | ForEach-Object { $_.ToString("x2") })
```

```powershell
# node (also documented in .env.example itself)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
# openssl, if you have Git for Windows or WSL handy
openssl rand -hex 32
```

Paste the resulting 64-hex-character string as `SESSION_PEPPER`, run it again for a different value
as `SALT_HMAC_KEY`.

### `APP_ORIGIN`

Set this to `https://<your-dynamic-dns-hostname>` (no trailing slash) — the origin Caddy will serve
the app from once you've completed the Caddy + dynamic DNS steps below. It's checked against the
WebSocket upgrade's `Origin` header (`apps/api/src/core/routes/characters.ts`), so it must match
exactly. If you're only testing locally before setting up Caddy/DNS, leave it as the example's
`http://127.0.0.1:8787` for now and come back to change it once you have a real hostname —
`HK_HOST`/`HK_PORT` (below) stay `127.0.0.1:8787` either way, since Caddy is what's actually
internet-facing.

### Server bind settings

Leave `HK_HOST=127.0.0.1` and `HK_PORT=8787` as shipped — the Node server should stay
loopback-only; Caddy is the only thing that should ever be reachable from outside this machine.
`HK_DATA_DIR` and `HK_WEB_DIST_DIR` can stay commented out (defaults) for a first local test; the
NSSM service step below points `HK_DATA_DIR` at `%ProgramData%\Herokeep\data` explicitly.

## 3. First boot and seeding

```powershell
cd herokeep-server-<version>\apps\api
node src\adapters\node\server.ts
```

Confirm `herokeep node adapter listening on http://127.0.0.1:8787 (data: ...)`, then in a second
terminal:

```powershell
Invoke-WebRequest http://127.0.0.1:8787/api/health
```

should return `{"ok":true}`. Optionally seed a test account + sample character:

```powershell
node scripts\seed-api.ts
```

prints a `seed-hero` / dev-only password and a sample character id — useful to confirm registration,
login, and the character stream all actually work before going further. Ctrl-C the server once
you're satisfied.

## 4. Install as a Windows service (NSSM)

[NSSM](https://nssm.cc) ("the Non-Sucking Service Manager") wraps an ordinary process as a Windows
service so it survives reboots and restarts itself if it crashes. Download it from nssm.cc, unzip,
and put the right-architecture `nssm.exe` (the `win64` folder, on a 64-bit PC) somewhere on `PATH`
(or note its full path for `-NssmExe` below). NSSM's own install syntax, verified against its
official docs (nssm.cc/usage, nssm.cc/commands) on 2026-09-19: `nssm install <name> <program>
[args]` to create a service, `nssm set <name> <parameter> <value>` to configure it afterward.

This repo ships `apps\api\src\adapters\node\service\install-service.ps1`, which wraps exactly that
for the herokeep server (see the script's own header comment for full parameter docs):

```powershell
cd herokeep-server-<version>\apps\api\src\adapters\node\service
.\install-service.ps1 -InstallDir C:\Herokeep\herokeep-server -DataDir C:\ProgramData\Herokeep\data
```

It refuses to install if `apps\api\.env` is missing (would only crash-loop on boot), creates
`-DataDir` and a `logs` subfolder, and configures the service's `HK_HOST`/`HK_PORT`/`HK_DATA_DIR`/
`HK_WEB_DIST_DIR` environment, stdout/stderr log files, auto-start, and crash-restart. It does
**not** start the service — do that once you're ready:

```powershell
nssm start HerokeepServer
Get-Service HerokeepServer
Get-Content C:\ProgramData\Herokeep\data\logs\server.out.log -Wait
```

Also set the PC's power plan to never sleep (`powercfg /change standby-timeout-ac 0` and the
equivalent in Settings → Power & sleep) — a sleeping PC stops answering entirely.

## 5. Caddy reverse proxy (TLS)

A PWA requires HTTPS, and a Let's Encrypt certificate needs a real hostname (not a bare IP) — that's
what the dynamic-DNS step right after this one is for. [Caddy](https://caddyserver.com) is a single
Windows binary that gets you automatic Let's Encrypt HTTPS with almost no configuration.

1. Download `caddy_windows_amd64.zip` from [caddyserver.com/download](https://caddyserver.com/download)
   (or GitHub releases), unzip `caddy.exe` to e.g. `C:\Herokeep\caddy\`.
2. Copy `apps\api\src\adapters\node\service\Caddyfile.template` to `C:\Herokeep\caddy\Caddyfile`
   and replace `YOUR-SUBDOMAIN.duckdns.org` with your real hostname (next step). It's one
   `reverse_proxy 127.0.0.1:8787` line — verified against Caddy's own Caddyfile `reverse_proxy`
   syntax (caddyserver.com/docs/caddyfile/directives/reverse_proxy,
   caddyserver.com/docs/quick-starts/reverse-proxy) on 2026-09-19: a site block whose address is a
   real hostname gets automatic HTTPS for free once DNS points here and 80/443 are reachable — no
   extra TLS config needed.
3. Install Caddy as its own NSSM service (it takes no herokeep-specific arguments, so it doesn't
   need its own wrapper script):

   ```powershell
   nssm install HerokeepCaddy C:\Herokeep\caddy\caddy.exe "run --config C:\Herokeep\caddy\Caddyfile"
   nssm set HerokeepCaddy AppDirectory C:\Herokeep\caddy
   nssm set HerokeepCaddy Start SERVICE_AUTO_START
   nssm start HerokeepCaddy
   ```

## 6. Dynamic DNS

A certificate needs a real hostname pointed at your PC's public IP. Two free providers ADR-014
names as candidates — **checked today, 2026-09-19**, via web search:

- **DuckDNS** ([duckdns.org](https://www.duckdns.org)) — still operational, handling large query
  volumes on donated AWS infrastructure (free, ad-free, funded by optional donations). Status
  monitors show it currently up; the project does note occasional latency/outage blips since it
  runs on donated infrastructure, but it is an actively maintained, currently-working service as of
  this check.
- **FreeDNS** (afraid.org, [freedns.afraid.org](https://freedns.afraid.org)) — also still
  operational; status monitors show no reported issues in the last 24h as of this check. Its
  dynamic-DNS flow is at `freedns.afraid.org/dynamic/v2/`, which issues a per-subdomain update URL.

Either is a reasonable choice; DuckDNS's setup is slightly simpler (one token, one subdomain,
straightforward update client/scheduled task). Sign up, claim a subdomain (e.g.
`yourname.duckdns.org`), and set up its update client/scheduled task per its own instructions so
your DNS record tracks your PC's current public IP automatically (both providers document a small
update-ping client or a scheduled `curl`/PowerShell call for this — follow their own current
instructions, since this is exactly the kind of detail that can drift).

Use that hostname in `Caddyfile` (step 5) and `APP_ORIGIN` (step 2).

## 7. Router port-forward + Windows Firewall

Forward external ports **80** and **443** on your router to this PC's local IP, both pointed at the
same ports (Caddy listens on 80/443 and handles the ACME HTTP-01/TLS-ALPN-01 challenge + the actual
HTTPS traffic). Router UIs vary too much to script generically — look for "Port Forwarding" /
"Virtual Server" in your router's admin page.

Allow those ports through Windows Firewall (run as Administrator — this needs elevation this
session didn't have, so the syntax below is standard, well-documented `NetSecurity`/`netsh` syntax,
not independently re-verified against a live elevated run here):

```powershell
New-NetFirewallRule -DisplayName "Herokeep Caddy HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "Herokeep Caddy HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

or the older `netsh` equivalent:

```powershell
netsh advfirewall firewall add rule name="Herokeep Caddy HTTP" dir=in action=allow protocol=TCP localport=80
netsh advfirewall firewall add rule name="Herokeep Caddy HTTPS" dir=in action=allow protocol=TCP localport=443
```

Once DNS, port-forwarding, and the firewall rules are all in place, browse to
`https://<your-hostname>/api/health` from OUTSIDE your network (e.g. phone on cellular data) and
confirm `{"ok":true}` over a real HTTPS connection.

## 8. Backups

**Why checkpoint-then-copy, not stop-then-copy:** `accounts.sqlite` and `streams.sqlite` are opened
in WAL mode (`apps/api/src/adapters/node/db.sqlite.ts`, `store.sqlite-file.ts`) specifically so
readers/writers don't block each other — and WAL mode is designed for safe multi-*process* access.
A side process (this backup script) can open its own connection to the same file and run `PRAGMA
wal_checkpoint(TRUNCATE)` — folding the WAL back into the main file and truncating it — while the
running server keeps serving requests the whole time; SQLite's own locking protocol arbitrates the
two connections. The plain file copy that follows then captures a self-consistent snapshot without
ever stopping the service. (Stopping the service and copying is also safe, and is a fine manual
fallback, but costs a nightly outage the checkpoint approach doesn't need to pay.) There is no
`sqlite3.exe` in this recipe — `better-sqlite3` has no CLI, so the checkpoint step reuses the native
module already installed under the server's own `node_modules` via a small Node script, rather than
requiring a separate SQLite CLI install.

`apps\api\src\adapters\node\service\backup.ps1` does exactly this — checkpoint both database files,
then `robocopy` the whole data directory to a dated folder under `-BackupRoot`, then (optionally)
prune backups older than `-RetainDays`. Verified end to end (checkpoint + copy, both exit-code
paths) against a simulated data directory on 2026-09-19.

```powershell
.\backup.ps1 -DataDir C:\ProgramData\Herokeep\data -ApiDir C:\Herokeep\herokeep-server\apps\api -BackupRoot D:\HerokeepBackups
```

`-BackupRoot` should be a second physical location — a different drive, a mapped network share, an
external drive — not just another folder on the same disk.

### Nightly Task Scheduler registration

```powershell
schtasks /create /tn "HerokeepNightlyBackup" /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Herokeep\herokeep-server\apps\api\src\adapters\node\service\backup.ps1 -DataDir C:\ProgramData\Herokeep\data -ApiDir C:\Herokeep\herokeep-server\apps\api -BackupRoot D:\HerokeepBackups" /sc daily /st 03:00 /rl HIGHEST
```

(`/create`/`/query`/`/delete` syntax verified by actually registering and removing a test task on
2026-09-19; adjust the file paths above to match your actual install.) Verify it's registered with
`schtasks /query /tn "HerokeepNightlyBackup"`, and check `D:\HerokeepBackups` the following morning
for a new dated folder.

## 9. Updating

1. Download the new `herokeep-server-<version>.zip` (step 1A) or rebuild from source (step 1B).
2. Stop the service: `nssm stop HerokeepServer`.
3. Replace the old install directory's `apps\api\src`, `apps\api\scripts`, `apps\api\package.json`,
   `apps\web\dist`, `packages\protocol\dist`, and `packages\protocol\package.json` with the new
   bundle's copies — **keep your existing `apps\api\.env`** (it's not part of the bundle; don't
   overwrite it) and your existing `data` directory untouched.
4. Re-run the install step (`cd apps\api; pnpm install --prod`) in case dependencies changed.
5. Start the service: `nssm start HerokeepServer`, confirm `/api/health` again.

## 10. Moving to/from Cloudflare

`herokeep-admin` (`apps\api\src\cli\admin.ts`) is the switching tool — it never invokes `wrangler`
itself:

- **Node → Cloudflare**: `node src\cli\admin.ts export --out <dir>` on this machine (dumps users,
  characters, recovery-code hashes, and every character's event stream as NDJSON — never sessions,
  never a raw recovery code), then hand that directory to whoever runs the Cloudflare side; they
  import it via D1/DO tooling on their end (this CLI only ever touches Node's own on-disk sqlite
  files).
- **Cloudflare → Node**: produce a local copy of the Cloudflare data shaped like a Node data
  directory — `wrangler d1 export` for the accounts half, a Durable Object storage backup/replay
  for the stream half (Cloudflare has no bulk "dump every DO" primitive; this is inherently a
  per-DO, manual step) — then `node src\cli\admin.ts import --in <dir>` against a **fresh, empty**
  `--data-dir` here (the CLI refuses to merge into a populated store; see `admin.ts --help`).
- Either direction: users re-login afterward (sessions are never exported); clients need no code
  change, since the app always uses relative URLs against whatever origin it's served from — only
  the DNS hostname changes.

## Known gaps

- **PR-preview deploys are not implemented.** `docs/02-architecture/10-backend-architecture.md`
  once described `wrangler versions upload --env staging` for PR previews; the actual
  `.github/workflows/deploy.yml` only deploys on push to `main` (gated on a `CLOUDFLARE_API_TOKEN`
  secret being present, skipping gracefully otherwise) and always builds the self-host server
  artifact. There is no PR-preview deploy today — this doc and the workflow are what's real; treat
  any staging-preview mention elsewhere as aspirational until that's actually built.
- This doc's router/firewall commands (section 7) could not be run to completion in the environment
  used to write it (no administrator elevation, no real router) — the syntax is standard and
  documented, but wasn't independently re-verified end-to-end here the way the install/boot/seed/
  backup steps were.
