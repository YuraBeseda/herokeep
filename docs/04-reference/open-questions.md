# Open questions and decisions still owed

Items the owner must decide, or facts that must be verified before the phase that needs
them. Nothing here blocks Phase 1a.

## Owner decisions — resolved 2026-08-30

| # | Question | Decision |
|---|----------|----------|
| 1 | Product name | **Herokeep** (package scope `@hk/*`, Worker/service name `herokeep`) |
| 2 | Source-code license | **MIT** for code; **CC-BY-4.0** for the project's own content packs |
| 3 | Body font | **Inter** for now (re-evaluate on device in Phase 1a if Cyrillic rendering disappoints) |
| 4 | Buy a domain / any paid service | **No.** Nothing is bought; `workers.dev` on Cloudflare, a free dynamic-DNS hostname for self-hosting |
| 5 | Tailwind | **Out** (additive at any time if ever wanted) |
| 6 | Repository visibility | **Public** (free unlimited GitHub Actions minutes) |
| 7 | Ability-score generation | **All of standard array, point buy, manual entry and dice rolling (4d6 drop lowest)**, defined as data in the system entity; rolls are recorded in the character timeline |
| 8 | Roll-log visibility default | **Everyone** (`visibility.rolls = everyone`); private rolls allowed per campaign setting |
| 9 | Self-hosting | **Required as a supported second target** on a Windows PC with a static IP; switching away from Cloudflare must be easy → ADR-014 |

## Facts to verify (with the phase that needs them)

| # | Fact | Why it matters | Phase |
|---|------|----------------|-------|
| V1 | Cloudflare free plan: credit card required at signup? | zero-budget promise | 2 |
| V2 | Workers Rate Limiting binding availability on the free plan | could replace `RateLimiterDO` | 2 |
| V3 | `@cloudflare/vitest-pool-workers` compatibility with Vitest 4.x | conformance suite | 2 |
| V4 | DO SQLite point-in-time recovery on the free plan | nice-to-have safety net | 2 |
| V5 | Exact wrangler 4.x version and `wrangler.jsonc` schema at scaffold time | scaffolding | 2 |
| V6 | iOS Safari: time from screen lock to WebSocket close; `visibilitychange` behaviour in Home-Screen apps | reconnect tuning | 3 |
| V7 | Real-device timings for `reduce`/`derive` | Web Worker decision | 1b |
| V8 | open5e `srd-2024` fixture completeness for class progression details (choices per level, starting equipment options) — may need manual supplementation from the SRD PDF | import tool scope | 1a |
| V9 | Ukrainian SRD community translation licensing (5esrd.kyiv.ua) — contact the maintainer if terminology alignment is wanted | translations | 5 |
| V10 | Web Share with files in iOS Home-Screen (standalone) mode reliability | export UX | 1b |
| V11 | Drizzle ORM + drizzle-kit versions; `drizzle-orm/d1` and `drizzle-orm/better-sqlite3` driver status | accounts DB on both adapters | 2 |
| V12 | `better-sqlite3` prebuilt binaries for Node 24 on Windows x64, or stability of Node's built-in `node:sqlite` | Node adapter | 2 |
| V13 | Free dynamic-DNS providers still operating (DuckDNS, FreeDNS/afraid.org); Caddy Windows build + automatic HTTPS via HTTP-01 on port 80 | self-host TLS | 2 |
| V14 | Let's Encrypt certificates for bare IP addresses (status) | optional; hostname route avoids it | 2 |
| V15 | NSSM current release and Windows 10 compatibility | run as services | 2 |

## Deferred design topics (not questions — recorded so they are not forgotten)

- Compaction of very long histories (`history.compacted`).
- Owner-uploaded snapshots for faster first sync.
- WebRTC LAN fast-path for blob transfer.
- Passkeys; E2E encryption with explicit data-loss consent.
- Multi-campaign characters (West Marches).
- Community pack registry (server holds pack JSON only).
- Metric units display toggle (rules stay in feet/pounds).
- Cloudflare Tunnel as a third way to expose a self-hosted instance without a static IP.
