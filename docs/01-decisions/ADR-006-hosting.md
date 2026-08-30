# ADR-006 — Hosting: Cloudflare free plan, GitHub Actions

**Status:** Approved 2026-08-30; **amended the same day by ADR-014** — self-hosting on a
Windows PC is a supported second target, Cloudflare remains primary. Depends on ADR-001,
ADR-005. Limits verified 2026-08-29 (`04-reference/hosting-research.md`).

## Context

Zero budget. Needs: static PWA hosting, a server that holds ~40 long-lived WebSockets,
per-stream durable storage for small JSON, an accounts table, and CI/CD. At the time of
this ADR no static IP was available at home; the owner later required a self-hosted
Windows target anyway — see ADR-014, which adds it without changing the primary choice
below.

## Options considered

| Need | Cloudflare (chosen) | Alternatives and why not |
|------|---------------------|--------------------------|
| Static PWA | Workers Static Assets: unlimited requests and bandwidth, 20k files, 25 MiB/file, 500 builds/mo | GitHub Pages (100 GB/mo soft cap, non-commercial only), Vercel Hobby (100 GB), Netlify (credits, ~15 GB) — all fine but separate from the API origin, which would force token auth instead of cookies |
| WebSocket server | Durable Objects on the free plan: 100k requests/day (incoming WS messages 20:1), 13k GB-s/day, hibernation makes idle sockets free | Fly.io (no free tier), Render Free (sleeps 15 min, ~1 min cold start), Railway ($1/mo credit), Koyeb (card, scale-to-zero), Oracle Always Free (card, halved quota, idle reclamation, capacity errors), Cloud Run / Azure Container Apps (monthly grants that a WebSocket keeps burning), Deno Deploy (viable, but no per-object durable storage) |
| Durable per-stream storage | DO SQLite: 5 GB/account, 10 GB/object, 5M reads + 100k writes/day | Same providers' DBs or Turso/Neon free tiers — extra moving parts |
| Accounts / metadata | D1: 5 GB, 5M reads + 100k writes/day | — |
| TURN (not in v1) | free 1,000 GB/mo; STUN free unlimited | Metered Open Relay 20 GB/mo |
| CI/CD | GitHub Actions (free for public repos; 2,000 min/mo private) | — |

## Decision

One Cloudflare account, one Worker (`herokeep`) that serves the Angular build as
static assets **and** the `/api/*` routes, so the app and API share an origin (cookies
work, no CORS). Bindings: D1 `DB`; Durable Object namespaces `CHARACTER_STREAM`,
`CAMPAIGN_STREAM`, `RATE_LIMITER`; secrets `SESSION_PEPPER`, `SALT_HMAC_KEY`.

Environments:

- `production` — `herokeep.<account>.workers.dev` until a domain is bought (a domain
  is the only non-free item on the horizon; optional).
- `preview` — deployed from pull requests with `wrangler versions upload`; separate D1
  and DO namespaces via a `staging` environment in `wrangler.jsonc`.
- local — `wrangler dev` (Miniflare/workerd) for API + DO + D1, `ng serve` with a proxy
  for `/api` in development; Playwright tests run against `wrangler dev`.

Pipeline (GitHub Actions): on PR — lint, typecheck, unit tests (engine, web, api with
`vitest-pool-workers`), build, Playwright smoke; on `main` — the same, then D1 migrations
(`wrangler d1 migrations apply`) and `wrangler deploy`. Secrets stored as GitHub Actions
secrets (Cloudflare API token scoped to the account).

Content packs (SRD core) are static assets under `/packs/<id>/<version>/pack.json`,
immutable per version and precached by the service worker.

## Budget math (free plan)

Per day, 10 sessions × 4 h × ~6 devices, each sending ~2 messages/min of live play:
10 × 240 min × 6 × 2 = 28,800 incoming messages → 1,440 requests (20:1). Add HTTP
requests (app loads, login, lists) ~5,000/day. Total well under 100k. DO duration:
hibernation means an object is only "awake" while handling a message; 28,800 messages ×
~20 ms = ~10 minutes of wall time per day against a 13,000 GB-s budget (≈ 28 object-hours
at 128 MB). Storage: a character's full history for a year is ~1–3 MB; 50 users × 5
characters × 3 MB = 750 MB of the 5 GB.

## Consequences

- No servers to patch, no containers, no TLS to manage, no sleeping instances.
- All configuration is in `apps/api/wrangler.jsonc` and versioned.
- If usage ever exceeds the free plan, Workers Paid is $5/month; nothing needs to change.
- A self-hosted Node adapter on a Windows PC is the supported second target (ADR-014);
  Cloudflare Tunnel remains a third option for exposing it without a static IP.

## Open points

- Credit-card requirement for the Cloudflare free plan is not stated on official pages
  (third parties say none). Verify at signup.
- Availability of the Workers Rate Limiting binding on the free plan is unverified; the
  design uses a `RateLimiterDO` which needs no special binding.
