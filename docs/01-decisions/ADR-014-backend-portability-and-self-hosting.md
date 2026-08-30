# ADR-014 — Backend portability: Cloudflare primary, self-hosted Node on Windows as a supported second target

**Status:** Approved 2026-08-30. Amends ADR-005 and ADR-006. Details in
`02-architecture/10-backend-architecture.md`.

## Context

After the baseline was written the owner added a requirement: the app must also be able
to run on a **Windows PC with a static IP**, and if Cloudflare turns out too limited or
too slow, switching to an alternative must be **easy**. Nothing may be bought.

Cloudflare-specific pieces in the baseline design: the Durable Object actor model
(single-instance objects with their own SQLite and WebSocket hibernation), D1, Workers
static assets, cron triggers, and the secrets/bindings mechanism. Everything else (Hono
routes, auth, permission table, protocol, Zod schemas, the engine) is plain TypeScript.

## Options considered

| Option | Assessment |
|--------|-----------|
| Cloudflare only; port later if needed | The DO model leaks into every stream handler; a later port is a rewrite of the backend core. Violates the new requirement. |
| Node-only, self-hosted from day one | Loses free, always-on, globally reachable hosting; a home PC has uptime, bandwidth and update-reboot problems; still needs TLS. Rejected as primary. |
| Containers (Docker) as the universal runtime | Cloudflare Workers are not containers (Cloudflare Containers are a paid product); would force a non-Cloudflare primary. Rejected. |
| **Small runtime ports with two adapters, both built and conformance-tested in Phase 2 (chosen)** | The backend core is written once against interfaces; adapter A = Cloudflare, adapter B = single Node process. Switching = run adapter B and move data. |

## Decision

### Runtime ports (interfaces the backend core depends on)

| Port | Responsibility | Adapter A: Cloudflare | Adapter B: Node |
|------|----------------|-----------------------|-----------------|
| `StreamHost` | Address a stream by id and run its handler with a **single-writer guarantee** | Durable Object namespace (`get(id)`) | In-process `Map<id, StreamActor>` with a per-actor async mutex |
| `StreamStore` | `append / read(fromSeq, limit) / head / meta / packs` | DO SQLite (`state.storage.sql`) | `better-sqlite3` (or Node's built-in `node:sqlite` if verified stable) — one `streams.sqlite` in WAL mode keyed by `(stream_id, seq)` |
| `Connections` | Accept, tag, attach state to, enumerate and send to sockets | Hibernation API (`acceptWebSocket`, `getWebSockets`, attachments) | `ws` server; in-memory socket set per actor |
| `Db` | Accounts, sessions, indexes | D1 via Drizzle ORM (sqlite dialect, `d1` driver) | SQLite file via Drizzle ORM (`better-sqlite3` driver) — **same schema and queries** |
| `RateLimit` | Sliding windows per scope | `RateLimiterDO` | In-memory map |
| `Scheduler` | Daily maintenance | Cron Trigger → `scheduled()` | `setInterval` / `node-cron` |
| `Secrets`/`Config` | Pepper, HMAC key, origin | Worker secrets/bindings | `.env` file |
| `StaticAssets` | Serve the Angular build | Workers static assets | `@hono/node-server/serve-static` from `apps/web/dist` |
| `Rpc` (stream ↔ stream) | Campaign ↔ character notifications | DO RPC | Direct in-process method call |

The Hono app, auth, permission table, quotas, protocol handling and all tests target
these ports only. A **conformance suite** runs the same API/DO tests against both
adapters in CI.

### Adapter B deployment recipe (Windows PC, static IP, zero cost)

1. Node 24 installed natively (no WSL or Docker required).
2. `herokeep-server` = one process: Hono on `@hono/node-server` (HTTP on 127.0.0.1:8787),
   `ws` for sockets, SQLite files under `%ProgramData%\Herokeep\data\`.
3. TLS: **Caddy** (free, single Windows binary) as reverse proxy with automatic
   Let's Encrypt certificates. A certificate needs a hostname, not a bare IP, so use a
   free dynamic-DNS name (DuckDNS or FreeDNS/afraid.org — verify availability) pointed
   at the static IP; router forwards 80/443 to the PC; Windows Firewall rules for Caddy.
   PWAs require HTTPS, so this step is mandatory.
4. Run both as Windows services with **NSSM** (free) so they survive reboots; set the
   PC's power plan to never sleep.
5. Backups: Task Scheduler runs a nightly script copying `data\` (SQLite files in WAL
   mode are safe to copy after `PRAGMA wal_checkpoint`) to a second location. Users'
   devices remain full replicas, so a PC failure stalls live sync but loses nothing that
   any device has.

### Switching between targets

- Clients need no change: the app is always served from the same origin as its API and
  uses relative URLs; a switch is a DNS/hostname change.
- `herokeep-admin export --out <dir>` dumps accounts (minus sessions) and every stream's
  events as newline-delimited JSON; `herokeep-admin import --in <dir>` loads them into
  the other adapter. Streams are append-only, so the copy is exact; users re-login.
- Either target can also be the *dev* runtime: the Node adapter runs unit/e2e tests
  without `wrangler`, which is faster; `wrangler dev` remains the fidelity check for
  Cloudflare.

### What is deliberately not portable

- Cloudflare's cost model (hibernation, 20:1 message counting, 10 ms CPU) — irrelevant
  on a PC; the code must not *depend* on hibernation semantics beyond the `Connections`
  port.
- Global edge latency — irrelevant for ~50 users in one region.

## Consequences

- Phase 2 grows by: the port interfaces, adapter B, the conformance suite, the admin
  export/import CLI, and the Windows recipe document. This is the price of "easy switch".
- Drizzle ORM (sqlite dialect) becomes the single query layer for accounts on both
  targets; versions are pinned at scaffold time (unverified in this session).
- ADR-006's "the home PC is not part of the plan" is superseded: it is the supported
  second target; Cloudflare stays primary because it is free, always on and needs no
  maintenance.

## Open points

- `node:sqlite` (Node's built-in SQLite) vs `better-sqlite3`: verify stability on Node 24
  and Windows prebuilt binaries at scaffold time.
- Let's Encrypt certificates for bare IP addresses (announced 2025) — status unverified;
  the free hostname route does not need them.
- Which free dynamic-DNS provider is still operating at scaffold time (DuckDNS, FreeDNS).
