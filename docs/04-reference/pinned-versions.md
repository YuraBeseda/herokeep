# Pinned versions

*All versions checked 2026-08-29 against the npm registry `latest` dist-tag and the
projects' official sites. Re-check before scaffolding; "flux" notes explain what may
have moved.*

## Runtime and tooling

| Tool | Pin | Source | Notes |
|------|-----|--------|-------|
| Node.js | 24.x (24.20.0) | nodejs.org/dist/index.json; github.com/nodejs/Release | Active LTS; enters Maintenance 2026-10-20. Node 26 becomes LTS 2026-10-28 — plan the bump then. Angular 22 engines: ^22.22.3 or ^24.15.0 or >=26 |
| pnpm | 11.x (11.24.0) | registry.npmjs.org/pnpm | pnpm 12.0.0 published 2026-08-26 but not `latest`; pin 11 via `packageManager` |
| TypeScript | ~6.0.3 | registry.npmjs.org/typescript; devblogs.microsoft.com/typescript/announcing-typescript-7-0/ | **TS 7.0.2 is npm `latest`** (native port, no compiler API until 7.1); Angular 22.1 compiler-cli peer is `>=6.0 <6.1` — do not install 7 |

## Frontend

| Package | Pin | Source | Notes |
|---------|-----|--------|-------|
| @angular/core, common, router, forms, service-worker, compiler-cli | 22.1.4 | registry.npmjs.org/@angular/core; angular.dev/reference/releases | v22 active until 2027-06, LTS until 2028-06; 22.2 expected ~Sep 2026 |
| @angular/cli, @angular/build, @angular/pwa | 22.1.6 | registry.npmjs.org/@angular/cli | Unit-test runner default is Vitest (`runner: vitest`, jsdom) |
| @angular/cdk | 22.1.4 | registry.npmjs.org/@angular/cdk | |
| Angular feature status | — | angular.dev/guide/zoneless; /api/core/resource; /api/common/http/httpResource; /api/forms/signals/form | Zoneless default since v21; `resource()`, `httpResource`, signal forms stable since 22.0 (guide still recommends reactive forms for production stability — we use reactive forms in Phase 1) |
| @jsverse/transloco | 8.4.0 | registry.npmjs.org/@jsverse/transloco; github.com/jsverse/transloco/releases | **9.0.0-alpha.1 is breaking; pin 8.x** |
| @jsverse/transloco-messageformat | 8.x (matching) | same | |
| @jsverse/transloco-keys-manager | 8.1.1 | same | |
| dexie | 4.4.5 | registry.npmjs.org/dexie | zero dependencies; `idb` (8.0.3) dormant since 2025-05 |
| zod | 4.5.4 | registry.npmjs.org/zod; zod.dev/json-schema | `z.toJSONSchema()` built in (default draft-2020-12) |
| fflate | 0.8.3 | registry.npmjs.org/fflate | client-zip 2.5.0 is the slower-moving alternative |
| lucide-angular | latest at scaffold time | lucide.dev | ISC license; UI chrome icons |
| stylelint + stylelint-config-standard-scss | latest at scaffold time | stylelint.io | |
| eslint | 10.x | eslint.org | flat config |
| angular-eslint | 22.1.x | github.com/angular-eslint/angular-eslint | matches Angular major |
| typescript-eslint | 8.62.x | typescript-eslint.io | |
| prettier | 3.9.x | prettier.io | `printWidth: 120, singleQuote: true` |

## Backend

| Package | Pin | Source | Notes |
|---------|-----|--------|-------|
| hono | 4.13.5 | registry.npmjs.org/hono; hono.dev/docs/helpers/websocket | WS helper adapters for Cloudflare Workers/Pages, Deno, Bun, Node. Node: `@hono/node-server` + `ws` (`@hono/node-ws` deprecated) |
| wrangler | latest 4.x at scaffold time | developers.cloudflare.com/workers/wrangler | verify exact version on scaffold; `wrangler.jsonc` config |
| @cloudflare/workers-types | matching wrangler | same | |
| @cloudflare/vitest-pool-workers | latest compatible with Vitest 4 at scaffold time | developers.cloudflare.com/workers/testing/vitest-integration | verify Vitest-4 compatibility on scaffold (unverified in this session) |

## Self-hosted Node adapter (ADR-014) — *versions NOT verified in this session; pin at scaffold time*

| Package / tool | Pin | Source | Notes |
|----------------|-----|--------|-------|
| drizzle-orm, drizzle-kit | verify | orm.drizzle.team | sqlite dialect; drivers `drizzle-orm/d1` and `drizzle-orm/better-sqlite3` — confirm both are current |
| better-sqlite3 | verify | github.com/WiseLibs/better-sqlite3 | confirm prebuilt binaries for Node 24 on Windows x64; alternative: Node's built-in `node:sqlite` if stable on 24 |
| ws | verify | github.com/websockets/ws | |
| @hono/node-server | verify | github.com/honojs/node-server | includes serve-static; WS via `ws` |
| Caddy (Windows binary) | verify | caddyserver.com | automatic HTTPS; needs a hostname (free dynamic DNS) |
| NSSM | verify | nssm.cc | run Node + Caddy as Windows services |
| DuckDNS / FreeDNS | verify | duckdns.org / freedns.afraid.org | free hostname for the static IP |

## Testing

| Package | Pin | Source | Notes |
|---------|-----|--------|-------|
| vitest | 4.1.11 | registry.npmjs.org/vitest | **Vitest 5.0.0-rc.3 exists; Angular's builder peers ^4.0.8 — stay on 4** |
| @playwright/test | 1.62.1 | registry.npmjs.org/@playwright/test | |
| fast-check | latest at scaffold time | fast-check.dev | property tests |
| axe-core / @axe-core/playwright | latest at scaffold time | deque.com/axe | |

## Data sources

| Source | Version / date | License |
|--------|----------------|---------|
| SRD 5.2.1 (PDF) | 2025-05-01 | CC-BY-4.0 |
| open5e-api `srd-2024` JSON fixtures | repo pushed 2026-08-23 | data CC-BY-4.0; code modified MIT |
| game-icons.net | 4,180 icons, 2026-04-23 | CC-BY-3.0 (some CC0) |
| Google Fonts: Inter, Golos Text, Philosopher, Forum, Cormorant Garamond | as of 2026-08-29 | SIL OFL 1.1 |

## In-flux summary

1. TypeScript 7 vs Angular's 6.0.x requirement.
2. pnpm 12 just released.
3. Vitest 5 RC vs Angular builder on 4.
4. Transloco 9 alpha (breaking).
5. Node 26 LTS in October 2026.
6. `@hono/node-ws` deprecated.
7. Zod JSON Schema default draft-2020-12 vs Ajv default draft-07 (choose `target:
   'draft-07'` if Ajv is used anywhere; the app validates with Zod directly).
