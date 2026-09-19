# Phase 2 Plan 7 — Accounts & Sync Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **STATUS: EXECUTED 2026-09-19, merged @ 57ed208.**

**Goal:** Ship the Phase-2 server: `apps/api` — username/password/recovery-code accounts and character-stream sync over WebSocket, written once against runtime ports with BOTH adapters (Cloudflare Workers/DO/D1 and self-hosted Node/SQLite) passing one conformance suite, plus the `herokeep-admin` export/import CLI and the Windows self-host recipe. Client integration (auth UI, SyncService, upload-on-first-login) is the NEXT plan — this plan ends with a server a curl/ws test can drive end-to-end.

**Architecture:** Hono app factory `createApp(ports)`; all stream semantics in one `StreamActor` (append pipeline: validate → permission → dedupe → seq → store-tx → fan-out; hello/catch-up paging); ports per ADR-014's table; Drizzle ORM (sqlite dialect) as the single accounts query layer over d1/better-sqlite3 drivers; the backend NEVER runs the rules engine and never trusts a client-sent actor. Campaign streams, blob relay, and presence are Phase 3 — this plan builds CharacterActor only, with the `Rpc` port defined but unused.

**Tech Stack:** Hono, @hono/node-server, ws, better-sqlite3 (verify vs `node:sqlite` on Node 24/Windows at scaffold — ADR-014 open point; pick whichever has stable prebuilt binaries, record the choice in the ledger), Drizzle ORM + drizzle-kit, wrangler, @cloudflare/vitest-pool-workers, Zod (existing), Vitest 4. ALL new dependency versions verified from npm at execution time and pinned exactly (plan-6 fflate precedent).

**Spec:** `docs/03-roadmap/phases.md` Phase-2 row (deliverable); `docs/02-architecture/10-backend-architecture.md` (BINDING layout, ports table, actor semantics, routing, deployment — the executor reads it in full); `docs/02-architecture/03-sync-protocol.md` (BINDING message catalog, ordering/commit rules, quota signalling, versioning); `docs/01-decisions/ADR-012-identity-and-security.md` + `docs/02-architecture/08-security-permissions-quotas.md` (BINDING auth/crypto/limits — executor reads 08 in full for exact quota semantics); `docs/01-decisions/ADR-014-backend-portability-and-self-hosting.md` (ports/adapters/recipe); `docs/02-architecture/02-domain-model-and-events.md` (accounts + stream table shapes). ADRs are never edited.

## Global Constraints

- Repo non-negotiables (CLAUDE.md) hold: TDD failing-test-first with captured RED evidence; Conventional Commits with scope (`feat(api): …`, `feat(protocol): …`); commit attribution = the EXECUTING session's host trailer (none embedded here); events immutable; all wire inputs validated with shared Zod schemas from `@hk/protocol`.
- `src/core/` imports ONLY `./ports` types and `@hk/protocol` — enforce with an ESLint boundary rule (like the engine-determinism rule): no `cloudflare:*`, `node:*`, `ws`, `better-sqlite3`, `drizzle-orm/d1`, `drizzle-orm/better-sqlite3` imports inside `apps/api/src/core/**`. Adapters live in `src/adapters/{cloudflare,node}/`.
- Auth exact values (ADR-012, BINDING): usernames 3–32 chars, Unicode letters/digits/`_`/`-`, uniqueness on NFKC-case-folded form; NO email/name/phone anywhere. Client-side PBKDF2 is the CLIENT plan's job — this server accepts a 32-byte verifier, stores `SHA-256(pepper ‖ verifier)`, compares constant-time. Salt endpoint returns `HMAC(SALT_HMAC_KEY, username)` for unknown users (no existence oracle); real salts random 16 bytes. Sessions: random 256-bit token, stored as `SHA-256(token)`, 180-day sliding expiry, cookie `HttpOnly; Secure; SameSite=Lax; Path=/`. Six one-time recovery codes, 10 chars base32 grouped, stored as SHA-256; reset = username + code → new salt+verifier, burns the code, deletes ALL sessions. Rate limits: 5 failures/username → exponential lockout 1 min→1 h; 30 auth requests/min/IP. CSRF: `X-Requested-With` required on non-GET; `Origin` checked on WS upgrade. JSON body limit 64 KB.
- Quotas (ADR-012; exact per-stream vs per-user semantics from doc-08, executor verifies): 50 characters/user; 10 MB events (doc-08 authority on scope); 16 KB/event; 128 KB/message; `welcome.streams[].quota = {bytesUsed, bytesMax, eventCount}`; `notice quota.warning` at 80 %, reject code `quota` at 100 %.
- Sync protocol exact semantics (doc-03, BINDING): `hello {rid, proto: 1, app, streams[{id,lastSeq}], have[], pending[]}` → `welcome {rid, serverTime, streams[{id, headSeq, quota}]}` → `events` frames paged ≤ 200, then ack/reject per pending. `append {rid, events[]}` 1–50 events; per-stream all-or-nothing; txId groups commit contiguously or reject all (single-stream only). seq strictly increasing; duplicates (same event id) acked with the EXISTING seq (idempotent). Reject codes: `forbidden | quota | invalid | duplicate | stream_closed`. `bye {reason}` on session expiry. Phase-2 scope: character streams only, owner role only on direct sockets; `subscribe/unsubscribe`, blob frames, `presence`, `members` are schema-defined but the server implementation may reject them with `forbidden`/ignore per doc-03 until Phase 3 — document each.
- Server stamps `actor` from the session — any client-sent actor field is ignored/rejected. Permission table from ADR-012 §Authorization; in Phase 2 only the Owner column of "Character stream" is reachable.
- Conformance: `test/conformance/` runs identical scenarios against BOTH adapters (auth, append/read, permissions, quotas, dedupe, tx atomicity, hello/catch-up paging, rate limits). A scenario passing on one adapter and failing on the other is a merge blocker. Cloudflare side runs under `@cloudflare/vitest-pool-workers`; Node side under plain Vitest.
- Security of logs: no request bodies, no usernames in logs; counters and error classes only.
- Root `pnpm check` gains the api package (format/lint/typecheck/test) and stays the single gate. Web `gzip ≤ 600 KB` budget untouched (this plan adds no web code).
- Secrets (`SESSION_PEPPER`, `SALT_HMAC_KEY`, `APP_ORIGIN`) via the `Config` port: Worker secrets on Cloudflare, `.env` (gitignored, `.env.example` committed) on Node. NEVER commit a real secret; conformance/unit tests use fixed test values.

## File Structure

Exactly doc-10's layout (§Layout) — `apps/api/{package.json, wrangler.jsonc, src/{core/{app.ts, auth/, routes/, streams/{stream-actor.ts, character-actor.ts}, permissions.ts, quotas.ts, validate.ts, ids.ts, crypto.ts, errors.ts, db/{schema.ts, queries.ts, migrations/}}, ports/, adapters/{cloudflare/, node/}, cli/admin.ts}, test/{core/, conformance/}}` — plus `packages/protocol/src/sync/` (message schemas) and `docs/self-hosting-windows.md`. `campaign-actor.ts`, blob relay, presence: NOT created (Phase 3); `permissions.ts` ships the full table (it is protocol-derived data) with only owner paths exercised.

---

### Task 1: Sync protocol schemas in `@hk/protocol`

**Files:** Create `packages/protocol/src/sync/{messages.ts, index.ts}`, `packages/protocol/test/sync.test.ts`; modify `packages/protocol/src/index.ts`.

**Interfaces — Produces (consumed by every later task):** Zod strictObject schemas + inferred types for every doc-03 message: client→server `HelloMsg, AppendMsg, SubscribeMsg, UnsubscribeMsg, BlobHaveMsg, BlobRequestMsg, BlobCancelMsg, PresenceMsg`; server→client `WelcomeMsg, EventsMsg, AckMsg, RejectMsg, BlobPullMsg, BlobUnavailableMsg, MembersMsg, NoticeMsg, ByeMsg`; discriminated unions `ClientMessageSchema`/`ServerMessageSchema` on `t`; `parseClientMessage(value)` returning `{ok, message}|{ok:false, issues}` (mirror parseEvent/parseHeroManifest); `RejectCode = 'forbidden'|'quota'|'invalid'|'duplicate'|'stream_closed'`; `ActorSchema {userId, role: 'owner'|'dm'|'member'}`; `PROTO_VERSION = 1`. Field shapes verbatim from doc-03's two tables (events inside frames validated by the existing `parseEvent`). Size caps as schema `.max()` where doc-03/ADR-012 name them (append ≤ 50 events; message ≤ 128 KB enforced at transport, not schema).

- [ ] **Step 1:** Failing tests: accept/reject per message (unknown `t`, extra keys, bad reject code, append with 0 or 51 events), round-trip of a hello with pending events, parseClientMessage result shape. → RED.
- [ ] **Step 2:** Implement; export from index. Green. **Step 3:** `pnpm check`; commit `feat(protocol): sync message schemas`.

### Task 2: `apps/api` scaffold, ports, and core primitives

**Files:** Create `apps/api/{package.json, tsconfig.json, tsconfig.build.json, eslint config per repo pattern, vitest config}`, `src/ports/{index.ts, stream.ts, connections.ts, db.ts, infra.ts}`, `src/core/{errors.ts, ids.ts, crypto.ts}`; modify root `package.json`/`pnpm-workspace.yaml`/root vitest+check wiring, root eslint (core-boundary rule).

**Interfaces — Produces:** the port interfaces verbatim from doc-10's table: `StreamHost {get(streamId): StreamHandle}`, `StreamHandle {append(events, actor), read(fromSeq, limit), head(), notify(fromStream, events)}`, `StreamStore {append(batch): {firstSeq,lastSeq}, read(fromSeq, limit), head(), getMeta(key), setMeta(key, value), putPack/getPack/listPacks}`, `Connections {accept(ws, attachment), all(), byTag(tag), send(conn, frame), close(conn, code, reason), getAttachment/setAttachment}`, `Db` (Drizzle sqlite database type), `RateLimit {check(scope, limit, windowMs): {ok, retryAfterMs}}`, `Scheduler {daily(fn)}`, `Config {get(name)}`, `StaticAssets {fetch(request): Response|null}`, `Rpc` (character↔campaign; typed but unused this phase). `core/crypto.ts`: `sha256Hex(bytes)`, `hmacSha256Hex(key, msg)`, `constantTimeEqual(a, b)`, `randomToken(bytes)` — WebCrypto only (works on Workers AND Node ≥ 20). `core/errors.ts`: `ApiError(status, code)` taxonomy. `core/ids.ts`: uuidv7 (share/port the web helper's algorithm).

- [ ] **Step 1:** Failing tests for crypto primitives (known vectors, constant-time equal behavior) and the ESLint boundary rule (a fixture file importing `ws` inside core FAILS lint). → RED. **Step 2:** Implement; wire `pnpm check` to include api. Green. **Step 3:** Commit `feat(api): scaffold runtime ports and core primitives`.

### Task 3: Accounts DB — Drizzle schema, queries, migrations

**Files:** Create `src/core/db/{schema.ts, queries.ts}`, `drizzle.config.ts`, generated `src/core/db/migrations/*`; test `test/core/db.test.ts` (over better-sqlite3 in-memory or the chosen driver).

**Interfaces — Produces:** tables verbatim from doc-02 §Entities: `users(id, username, username_folded UNIQUE, salt, verifier_hash, created_at, quota_bytes_used, flags)`, `sessions(token_hash PK, user_id, device_label, created_at, last_seen_at, expires_at)`, `recovery_codes(user_id, code_hash, used_at)`, `characters(id PK, owner_id, name, system, campaign_id NULL, archived_at NULL, bytes_used, event_count, updated_at)`, `usage_daily(...per doc-10 daily job needs — day, metric, value)`; `campaigns`/`memberships` DEFERRED to Phase 3 (do not create — additive migration later; note in schema comment). Typed query functions in `queries.ts` used by routes (`findUserByFoldedName`, `insertSession`, `touchSession`, `deleteSessionsForUser`, `listSessions`, `listCharactersForOwner`, `upsertCharacterIndexRow`, `countCharactersForOwner`, …).

- [ ] **Step 1:** Failing tests: NFKC-folded uniqueness (register 'Alice' then 'alice' collides; 'ＡＬＩＣＥ' full-width folds equal), session expiry query, character count. → RED. **Step 2:** Implement schema + generate migrations via drizzle-kit; green. **Step 3:** Commit `feat(api): accounts database schema and queries`.

### Task 4: Auth core — register, salt, login, sessions, recovery, devices

**Files:** Create `src/core/auth/{register.ts, login.ts, sessions.ts, recovery.ts, middleware.ts}` (split as fits), `src/core/routes/{auth.ts, me.ts}`; test `test/core/auth.test.ts` (Hono app + in-memory port fakes).

**Interfaces — Consumes:** T2 ports/crypto, T3 queries. **Produces (HTTP, all under `/api/auth` + `/api/me`):** `POST /api/auth/register {username, verifier, salt}` → 201 `{userId, recoveryCodes: string[6]}` (codes returned ONCE, stored hashed); `GET /api/auth/salt?username=` → `{salt}` (real or HMAC fake — indistinguishable); `POST /api/auth/login {username, verifier, deviceLabel}` → session cookie + `{userId}`; `POST /api/auth/logout`; `POST /api/auth/logout-all`; `POST /api/auth/reset {username, recoveryCode, newSalt, newVerifier}` → burns code, new credentials, deletes all sessions; `GET /api/me` → `{userId, username}`; `GET /api/me/sessions` → devices list `[{deviceLabel, createdAt, lastSeenAt, current}]`; `DELETE /api/me/sessions/:tokenPrefix?` per doc conventions (executor picks the cleanest single-session-revoke shape and documents it). Middleware: session-cookie → `c.get('user')`, sliding `lastSeenAt/expiresAt` touch (throttled to 1/day), `X-Requested-With` gate on non-GET, security headers, 64 KB body limit, `RateLimit` on auth routes per ADR-012 exact values. Username validation + NFKC folding in ONE function shared with T3's uniqueness.

- [ ] **Step 1:** Failing tests (each red-first): register happy path returns 6 base32 codes; duplicate folded username 409; unknown-user salt is stable and fake (two calls equal, differs from a real user's); login wrong verifier 401 with constant-time compare (behavioral: timing not asserted, code-reviewed); lockout after 5 failures; session cookie flags exact; reset burns the code (second use 401) and kills sessions; devices list shows labels; missing X-Requested-With 403 on POST; body over 64 KB 413. → RED. **Step 2:** Implement. Green. **Step 3:** Commit `feat(api): username password and recovery-code auth`.

### Task 5: StreamActor — the append pipeline and catch-up

**Files:** Create `src/core/streams/stream-actor.ts`, `src/core/{permissions.ts, quotas.ts, validate.ts}`; test `test/core/stream-actor.test.ts` (in-memory StreamStore + Connections fakes).

**Interfaces — Consumes:** T1 sync schemas, T2 ports. **Produces:** `class StreamActor { constructor(deps: {store: StreamStore, connections: Connections, quotas, permissions}); handleMessage(conn, raw); append(events, actor): AppendResult; hello(conn, msg) }` implementing doc-10 §StreamActor + doc-03 rules EXACTLY: per event — parseEvent schema check by `(type, v)`, 16 KB size cap, `permissions.allowed(type, actor.role)`, dedupe by id (ack existing seq), then per-stream: txId groups contiguous-or-reject-all, seq assign, ONE store transaction, `meta.bytes_used` update, fan-out `events` frame to other connections (read-visibility filtering is a pass-through in Phase 2 — no DM notes exist on solo streams; leave the hook). `hello`: subscription registration, catch-up paging ≤ 200 events/frame from `lastSeq+1`, then pending flush through the same append path, `welcome` with `{headSeq, quota}`. Gap rule is client-side (next plan). `permissions.ts`: the full ADR-012 table as data `{eventTypePattern → roles[]}`. `quotas.ts`: `checkAppend(meta, events) → ok | warning | reject` with 80 %/100 % thresholds from doc-08 exact values.

- [ ] **Step 1:** Failing tests: append assigns 1..n; duplicate id acked with existing seq and stored once; oversized event rejected `invalid`; non-owner actor rejected `forbidden`; txId group with one invalid event rejects ALL; quota 100 % rejects `quota`, 80 % emits `notice quota.warning` once; hello catch-up pages 450 events as 200/200/50 in order; pending in hello are committed and acked; fan-out reaches a second connection but not the sender. → RED. **Step 2:** Implement. Green. **Step 3:** Commit `feat(api): stream actor append pipeline and catch-up`.

### Task 6: CharacterActor + character routes + WS wiring in core

**Files:** Create `src/core/streams/character-actor.ts`, `src/core/routes/{characters.ts, health.ts}`, `src/core/app.ts` (createApp(ports) factory tying middleware+routes+WS handoff); test `test/core/characters.test.ts`.

**Interfaces — Consumes:** T4 auth middleware, T5 StreamActor. **Produces:** `CharacterActor extends/wraps StreamActor` with `meta {ownerId, campaignId?, pins, archived}`; owner-only on direct sockets (doc-03 §Permission enforcement); after-commit campaign notify is a no-op hook this phase. Routes: `GET /api/characters` (index rows for the session user), `POST /api/characters {id, name, system}` (registers ownership; 50-char quota), `DELETE /api/characters/:id` (hard delete stream + index row — frees quota per doc-03 §Quota), `POST /api/characters/:id/archive` (sets archived_at, keeps data), `GET /api/health`. WS: `GET /api/characters/:id/ws` verifies session + ownership (Db) + `Origin` before `StreamHost.get(id)` handoff with `{userId, role: 'owner'}` — the handoff SHAPE is a core function; each adapter supplies the actual upgrade. `app.ts`: `createApp(ports): Hono` — the ONLY composition point; `index.ts` of core exports it plus the actors for adapters.

- [ ] **Step 1:** Failing tests: character create/list/delete lifecycle updates index + quota count; delete removes stream data (via fake store); non-owner WS handoff refused 403; bad Origin refused; archived character still readable, appends still allowed (archive is cosmetic in Phase 2 — VERIFY against doc-08 and adjust if it says frozen; document). → RED. **Step 2:** Implement. Green. **Step 3:** Commit `feat(api): character actor routes and socket handoff`.

### Task 7: Node adapter

**Files:** Create `src/adapters/node/{server.ts, stream-host.ts, store.sqlite-file.ts, connections.ws.ts, db.sqlite.ts, rate-limit.memory.ts, scheduler.interval.ts, static.ts, config.env.ts}`, `.env.example`; test `test/core/node-adapter.test.ts` (store + host contract tests).

**Interfaces — Consumes:** every port; core `createApp`. **Produces:** doc-10 §node exactly: `@hono/node-server` on 127.0.0.1:8787 with `ws` upgrade handling routed through the core handoff; `Map<id, actor>` + per-actor async mutex (single-writer guarantee — a simple promise-chain mutex like CharacterStore's queue); `streams.sqlite` WAL keyed `(stream_id, seq)` with the doc-02 events/meta/packs tables; Drizzle better-sqlite3 (or node:sqlite — the T-scaffold decision) for `accounts.sqlite`, migrations applied at startup; serve-static from `apps/web/dist` with SPA fallback; `.env` config. Scripts: `pnpm --filter api dev:node`.

- [ ] **Step 1:** Failing contract tests: store append/read/head over a temp sqlite file survives process-level reopen; mutex serializes two concurrent appends (deterministic seqs); adapter boots createApp and serves /api/health. → RED. **Step 2:** Implement. Green. **Step 3:** Commit `feat(api): node adapter with sqlite stream store`.

### Task 8: Cloudflare adapter

**Files:** Create `src/adapters/cloudflare/{worker.ts, character-stream.do.ts, rate-limiter.do.ts, store.sqlite-do.ts, connections.do.ts, db.d1.ts, config.bindings.ts}`, `wrangler.jsonc` (DO `new_sqlite_classes` migration, D1 binding, assets dir, staging env); test wiring under `@cloudflare/vitest-pool-workers` (`test/conformance` shares it — see T9; adapter-specific smoke here).

**Interfaces — Consumes:** ports; core. **Produces:** doc-10 §cloudflare exactly: `worker.ts` fetch() = StaticAssets then createApp(cfPorts), scheduled() = daily job; `CharacterStreamDO` wraps CharacterActor with `state.storage.sql` store + Hibernation API connections (`acceptWebSocket`, `webSocketMessage/Close` forwarding to the actor); `RateLimiterDO`; D1 Drizzle driver; secrets from bindings.

- [ ] **Step 1:** Failing smoke tests under vitest-pool-workers: worker serves /api/health; DO accepts a WS and answers hello→welcome; D1 migrations apply. → RED. **Step 2:** Implement. Green (pool-workers suite runs in CI without a deployed account). **Step 3:** Commit `feat(api): cloudflare workers adapter with durable object streams`.

### Task 9: Conformance suite

**Files:** Create `test/conformance/{scenarios.ts, node.conformance.test.ts, cloudflare.conformance.test.ts}` (+ per-runner setup); CI workflow update (`.github/workflows/ci.yml` job matrix).

**Interfaces — Consumes:** both adapters, T1–T6 surfaces. **Produces:** ONE scenario table exercised by both runners (doc-10 §Portability tests list, verbatim): full auth lifecycle (register→salt→login→reset→lockout), append/read/head, owner-only permissions, quota warning + reject, dedupe idempotence, tx atomicity, hello/catch-up paging (450-event stream), rate limits. Scenarios are written against `fetch`/WebSocket only (black-box), parameterized by a base-url/socket factory per runner. CI: both suites required; one green + one red blocks merge by construction.

- [ ] **Step 1:** Scenario table + Node runner first (RED where a core gap is exposed — fix in core, ledger it), then the Cloudflare runner. **Step 2:** Both green twice consecutively. **Step 3:** Commit `test(api): cross-adapter conformance suite`.

### Task 10: `herokeep-admin` CLI + daily maintenance

**Files:** Create `src/cli/admin.ts` (+ bin wiring in apps/api package.json), `src/core/maintenance.ts`; tests `test/core/{admin-cli.test.ts, maintenance.test.ts}`.

**Interfaces — Consumes:** StreamStore, Db. **Produces:** `herokeep-admin export --out <dir>` → accounts minus sessions + every stream as NDJSON (`users.ndjson`, `characters.ndjson`, `streams/<id>.ndjson` one event per line); `herokeep-admin import --in <dir>` → loads into the target adapter's stores (append-only exact copy, seqs preserved); `herokeep-admin reset-recovery --username <u>` → new codes printed once. Works against BOTH adapters' storage (Node: direct file access; Cloudflare: documented as running against a local `wrangler d1 export`/DO backup path OR via an authenticated admin route — executor picks per what wrangler currently supports, documents the choice, and the conformance of export→import round-trip is tested on the Node adapter). `maintenance.ts`: usage counters → `usage_daily`, expired-session purge, orphan check; wired to `Scheduler.daily` (Node) and scheduled() (CF).

- [ ] **Step 1:** Failing tests: export→import round-trip on Node adapter reproduces streams byte-equal (event ids/seqs/payloads) and users sans sessions; maintenance purges an expired session and writes usage rows. → RED. **Step 2:** Implement. Green. **Step 3:** Commit `feat(api): admin export-import cli and daily maintenance`.

### Task 11: Dev workflow, deploy pipeline, seed

**Files:** Create `scripts/seed-api.ts` (test user + sample character on either adapter), `.github/workflows/deploy.yml` (wrangler deploy on main + `herokeep-server-<version>.zip` artifact: server bundle + apps/web/dist + service scripts), modify root package.json (`pnpm dev` = ng serve proxy + node adapter; `pnpm dev:cf`), `apps/web` proxy config for `/api`+`/packs`.

- [ ] **Step 1:** Verify each script actually runs (seed creates a loginable user against the Node adapter — asserted by a spec-level smoke); deploy workflow lints (actionlint or dry parse) — deploy itself requires the owner's Cloudflare account and is NOT run. **Step 2:** Commit `chore(repo): api dev workflow seed and deploy pipeline`.

### Task 12: Windows self-host recipe + docs wrap

**Files:** Create `docs/self-hosting-windows.md`, `src/adapters/node/service/{install-service.ps1, Caddyfile.template, backup.ps1}`; modify `README.md`, `CLAUDE.md` (new commands: dev:node/dev:cf/test:conformance; apps/api in layout), `docs/manual-device-checklist.md` (+ a "sync smoke" section placeholder marked for the CLIENT plan — only if trivially truthful, else skip).

**Content (recipe, per ADR-014 §Adapter B, every claim verified against the shipped scripts):** Node 24 native install; herokeep-server as NSSM service; Caddy with a free dynamic-DNS hostname (verify DuckDNS/FreeDNS still operating AT EXECUTION TIME, cite the check date); router port-forward 80/443; firewall rules; nightly backup via Task Scheduler (`PRAGMA wal_checkpoint` before copy); update = download zip, stop service, unzip, start.

- [ ] **Step 1:** Write; verify every command/step against the actual scripts and package.json; update README/CLAUDE.md. **Step 2:** `pnpm check`; commit `docs(repo): windows self-host recipe and phase 2 backend wrap`.

---

## Self-Review

**Spec coverage (phases.md Phase-2 row):** register/login/recovery ✓ T4; server copy of every character + sync across devices → server side ✓ T5/T6 (client SyncService, upload-on-first-login, restore-on-new-device, devices-list UI, quota UI = NEXT plan — the phase row spans both plans; this plan's server exposes everything those flows need: auth, streams, quotas in welcome, devices endpoints); quotas ✓ T5 server-side; devices list ✓ T4 endpoints; backend core on runtime ports with both adapters ✓ T2/T7/T8; conformance suite ✓ T9; herokeep-admin ✓ T10; Windows recipe ✓ T12 (ADR-014). Sync protocol doc-03 catalog ✓ T1 schemas + T5/T6 semantics for the Phase-2 subset with Phase-3 messages explicitly parked. ADR-012 exact crypto/limits ✓ T4 + Global Constraints.
**Placeholder scan:** the deliberate open decisions are named with their resolution procedure and ledger obligation (better-sqlite3 vs node:sqlite; single-session revoke route shape; archive frozen-vs-cosmetic verified against doc-08; CF admin-CLI access path; dynamic-DNS provider) — each is an execution-time verification with a binding source, not a TBD. No TODO/TBD/similar-to remain.
**Type consistency:** port names/signatures match doc-10's table verbatim and are produced once (T2) and consumed by name everywhere; `StreamActor.append(events, actor)` (T5) is what T6 wraps and T7/T8 host; `parseClientMessage`/`RejectCode` (T1) used in T5/T9; queries named in T3 are the ones T4/T6 call.
**Scope check (writing-plans):** this plan is one subsystem (the server) and independently testable end-to-end (conformance suite + curl/ws). The client half of Phase 2 is a separate follow-up plan by design.
