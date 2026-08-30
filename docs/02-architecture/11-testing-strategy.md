# Testing strategy

The reference project has no automated tests; this project does, and the rules engine
is the most tested code in it. Tools: Vitest 4 (engine, protocol, web via the Angular
builder, api via `@cloudflare/vitest-pool-workers`), Playwright (e2e), fast-check
(property tests), axe (a11y).

## Pyramid

| Layer | What | Where | Gate |
|-------|------|-------|------|
| Engine golden tests | decisions → expected sheet fragments for every shipped class/level; rests; conditions; item effects; weapon mastery; spellcasting blocks | `packages/engine/test/golden/*.json` + one runner | PR |
| Engine property tests | replay determinism; snapshot equivalence (`reduce(all) == reduce(rest, from: snapshot)`); reducer tolerance (arbitrary invalid events never throw and never change facts); formula parser round-trips; stacking policies | `packages/engine/test/properties/` | PR |
| Vocabulary conformance | one micro-pack + test per effect type and predicate form | `packages/engine/test/vocabulary/` | PR |
| Pack validation | SRD core pack validates against schema and semantic checks; import tool produces the same output from the same open5e input (snapshot of counts and a hash) | `packages/content/test/` | PR |
| Protocol tests | Zod schemas accept/reject fixtures; JSON Schema export is stable (snapshot) | `packages/protocol/test/` | PR |
| API/DO tests | append/read/permissions/quota/dedupe/transactions; WS hello/ack/reject; blob relay forwarding; rate limiter windows; auth flows with real PBKDF2 verifiers | `apps/api/test/` (workerd via vitest-pool-workers) | PR |
| Web unit tests | stores (replica pending/commit/rollback), sync client backoff & gap detection (fake socket), image pipeline (canvas mocked; hashing real), export/import round-trip, i18n ICU rendering per locale | `apps/web/src/**/*.spec.ts` | PR |
| E2E | create character (Fighter, Wizard) → play → level up → export → import; two browser contexts (DM + player) sync HP/conditions; join by code; offline → edits → reconnect → converge; iOS Safari smoke via WebKit project | `e2e/` | PR (Chromium) + nightly (WebKit, Firefox) |
| Accessibility | axe on sheet/play/party/library; keyboard-only run of the wizard | in E2E | PR |
| Performance | replay/derive timings on a fixture (CI budget); bundle-size budget | engine bench + `ng build` budgets | PR |

## Golden fixture format

```jsonc
{
  "name": "fighter-5-champion-chain-mail-shield-defense",
  "pins": { "srd-5e-2024": "1.0.0" },
  "events": [ /* character.created, decision.made…, level.gained… */ ],
  "expect": {
    "abilities.str.score": 17, "ac.value": 19, "hp.max": 44,
    "attacks[?name=='Longsword'].toHit": 6, "extraAttack": 2,
    "resources['second-wind'].max": 2,
    "issues": []
  }
}
```
Expectation paths are JSONPath-lite; the runner prints provenance on mismatch.

## Determinism check

A CI job runs the engine tests under Node and under Vitest browser mode (Chromium) and
compares golden outputs byte-for-byte (Phase 4 onward, once browser mode is set up).

## Test data

`packages/content` ships `test-pack-*` micro-packs (homebrew species, an override of
Fighter, a translation pack, an invalid pack) used across engine, web and api tests.

## Manual checklist (kept, but as a supplement)

`docs/testing/manual-device-checklist.md` (created in Phase 1b): install as PWA on iOS
and Android, storage persistence result, lock screen → reconnect, share export, HEIC
portrait upload, dark venue readability. Run before each phase release.

## Definition of done per phase

All PR gates green; the phase's acceptance criteria (roadmap) demonstrated on a phone and
a laptop; manual checklist run; docs updated (ADR supersessions if any).
