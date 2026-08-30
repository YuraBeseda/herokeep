# Backend architecture (`apps/api`)

Hono in TypeScript; the backend core targets a small set of **runtime ports** (ADR-014)
with two adapters: **Cloudflare** (Workers + Durable Objects + D1 — primary, free) and
**Node** (single process with SQLite — self-hosted on a Windows PC with a static IP).
The backend never runs the rules engine.

## Layout

```
apps/api/
  package.json                   scripts: dev:cf (wrangler dev), dev:node, test, test:conformance, build:cf, build:node
  wrangler.jsonc                 Cloudflare bindings, DO migrations, environments, assets dir
  src/
    core/                        runtime-agnostic (imports only ./ports and @hk/protocol)
      app.ts                     Hono app factory: createApp(ports) → routes + middleware
      auth/                      register, salt, login, logout, recover, reset, sessions, cookies
      routes/                    me, characters, campaigns, packs, health, admin (export/import)
      streams/
        stream-actor.ts          StreamActor: append pipeline (validate → permission → dedupe → seq → store → fan-out), hello/catch-up, subscriptions
        character-actor.ts       owner/DM checks, campaign notify
        campaign-actor.ts        membership, gateway forwarding, packs, blob relay, presence
      permissions.ts             (type → allowed actors) from @hk/protocol
      quotas.ts, validate.ts, ids.ts, crypto.ts, errors.ts
      db/
        schema.ts                Drizzle ORM sqlite schema (users, sessions, recovery_codes, characters, campaigns, memberships, usage_daily)
        queries.ts               typed queries used by routes (same on both adapters)
        migrations/              generated SQL (drizzle-kit), applied by each adapter
    ports/                       interfaces: StreamHost, StreamStore, Connections, Db, RateLimit, Scheduler, Config, StaticAssets, Rpc
    adapters/
      cloudflare/
        worker.ts                fetch(): static assets + createApp(cfPorts); scheduled(): daily job
        character-stream.do.ts   DurableObject subclass → wraps CharacterActor with DO storage + Hibernation API
        campaign-stream.do.ts
        rate-limiter.do.ts
        store.sqlite-do.ts       StreamStore over state.storage.sql
        connections.do.ts        Connections over acceptWebSocket/getWebSockets/attachments
        db.d1.ts                 Drizzle d1 driver
      node/
        server.ts                @hono/node-server + ws upgrade handling + serve-static; loads .env
        stream-host.ts           Map<id, actor> + per-actor mutex; Rpc = direct calls
        store.sqlite-file.ts     StreamStore over better-sqlite3 (streams.sqlite, WAL)
        connections.ws.ts        Connections over ws.WebSocketServer
        db.sqlite.ts             Drizzle better-sqlite3 driver (accounts.sqlite)
        rate-limit.memory.ts, scheduler.interval.ts
        service/                 NSSM install script, Caddyfile template, backup script (PowerShell)
    cli/
      admin.ts                   herokeep-admin export/import (NDJSON), user tools (reset recovery codes)
  test/
    core/                        unit tests against in-memory port fakes
    conformance/                 the same API + stream tests run against both adapters (vitest-pool-workers for Cloudflare; plain Vitest for Node)
```

## Runtime ports (summary; signatures live in `src/ports/*.ts`)

| Port | Methods |
|------|---------|
| `StreamHost` | `get(streamId): StreamHandle` where `StreamHandle.append(events, actor)`, `.read(fromSeq, limit)`, `.head()`, `.notify(fromStream, events)`; guarantees one writer per stream at a time |
| `StreamStore` | `append(batch) → {seq…}`, `read(fromSeq, limit)`, `head()`, `getMeta/setMeta`, `putPack/getPack/listPacks` |
| `Connections` | `accept(ws, attachment)`, `all()`, `byTag(tag)`, `send(conn, frame)`, `close(conn, code, reason)`, `getAttachment/setAttachment` |
| `Db` | a Drizzle database instance (sqlite dialect) — both drivers expose the same query API |
| `RateLimit` | `check(scope, limit, windowMs) → {ok, retryAfterMs}` |
| `Scheduler` | `daily(fn)` |
| `Config` | `get(name)` for `SESSION_PEPPER`, `SALT_HMAC_KEY`, `APP_ORIGIN` |
| `StaticAssets` | `fetch(request) → Response \| null` |

The `StreamActor` class is the only place stream semantics live; adapters instantiate it
with their `StreamStore` + `Connections` and forward socket events to it.

## Request routing (both adapters)

- `GET /*` → static assets with SPA fallback to `index.html`; `/packs/**` and
  `/schema/**` are static.
- `/api/*` → Hono. Middleware: security headers, session cookie → `user`, JSON body limit
  (64 KB), `X-Requested-With` check on non-GET, rate limit for auth routes.
- WebSocket: `GET /api/characters/:id/ws` and `/api/campaigns/:id/ws` verify session +
  ownership/membership (Db), check `Origin`, then hand the upgrade to
  `StreamHost.get(id)` with `{userId, role}`.
  - Cloudflare: forwarded to the DO which performs the upgrade with the Hibernation API.
  - Node: `ws` handles the upgrade; the socket is registered with the actor's
    `Connections`.

## Stream actors

### StreamActor (base)

`append(events, actor)` runs under the host's single-writer guarantee: validate each
event (schema by `(type, v)`, size), check `permissions.allowed(type, actor.role)`,
dedupe by `id`, assign `seq`, store in one transaction, update `meta.bytes_used`, then fan
out to connections with read-visibility filtering (DM notes, private rolls). `hello`
handles subscriptions, catch-up paging (200 events/frame) and pending flush.

### CharacterActor

`meta`: `ownerId`, `campaignId?`, `pins`, `archived`. Accepts owner events on direct
sockets and DM events only via the campaign's `Rpc`. After each commit, if `campaignId`
is set, calls `StreamHost.get(campaignId).notify(...)` so campaign sockets receive
character events that originated on solo sockets.

### CampaignActor

`meta`: `dmId`, `settings`, `members`, `characters`, `packs`. Gateway: `append` frames
whose events target `char:` streams are forwarded via `Rpc` to that character's handle
with the stamped actor; acks relayed. Blob relay: in-memory `holders: Map<hash,
Set<connId>>`, one in-flight per requester; binary frames forwarded without parsing
beyond the header. Presence: `members` frame on connect/close, throttled to one per 5 s.

## Accounts database (Drizzle ORM, sqlite dialect)

Schema in `02-domain-model-and-events.md`. One schema, one set of queries, two drivers
(`drizzle-orm/d1`, `drizzle-orm/better-sqlite3`). Migrations generated by `drizzle-kit`
and applied by `wrangler d1 migrations apply` (Cloudflare) or at Node startup.

## Daily maintenance

Usage counters → `usage_daily`; expired sessions purge; orphan check. Cloudflare: Cron
Trigger `0 3 * * *`; Node: `Scheduler.daily`.

## Local development

- `pnpm dev` → `ng serve` (proxying `/api` and `/packs`) + the **Node adapter** (fast,
  no wrangler needed). `pnpm dev:cf` → the Cloudflare adapter under `wrangler dev` for
  fidelity checks before deploying.
- Seed script creates a test user and a sample campaign on either adapter.

## Deployment

### Cloudflare (primary)

GitHub Actions → `wrangler deploy` on `main`; `wrangler versions upload --env staging` for
PR previews; DO migrations in `wrangler.jsonc` (`new_sqlite_classes`); rollback with
`wrangler rollback` (append-only data makes rollbacks safe).

### Windows PC with static IP (adapter B)

See ADR-014 for the recipe: Node 24 native, `herokeep-server` + Caddy (auto-HTTPS with a
free dynamic-DNS hostname), both as NSSM services, router forwards 80/443, nightly
backup of `data\` via Task Scheduler. The GitHub Actions workflow also produces a
`herokeep-server-<version>.zip` artifact (server bundle + `apps/web/dist` + scripts) so
a self-host update is "download, stop service, unzip, start service".

## Switching targets

`herokeep-admin export --out <dir>` (accounts minus sessions + every stream as NDJSON)
→ `herokeep-admin import --in <dir>` on the other adapter → point the hostname at the
new target. Clients use relative URLs and reconnect with `hello {lastSeq}`; nothing
client-side changes.

## Portability tests

`test/conformance/` runs identical scenarios (auth, append/read, permissions, quotas,
dedupe, transactions, hello/catch-up, blob relay forwarding, rate limits) against both
adapters in CI. A change that passes on one and fails on the other blocks the merge.
