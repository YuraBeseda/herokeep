# Testing strategy

The reference project has no automated tests; this project does, and the rules engine
is the most tested code in it. Tools: Vitest 4 (engine, protocol, web via the Angular
builder, api via `@cloudflare/vitest-pool-workers`), Playwright (e2e), fast-check
(property tests), axe (a11y).

## Pyramid

| Layer | What | Where | Gate |
|-------|------|-------|------|
| Engine golden tests | decisions → expected sheet fragments for every shipped class/level; rests; conditions; item effects; weapon mastery; spellcasting blocks; multiclassing; pinned third-party packs and rebases. 79 tests at plan 16: 76 fixture files plus 3 harness/spec-level tests (`packages/engine/test/golden.test.ts`) | `packages/engine/test/golden/*.json` + one runner (`packages/engine/test/support/golden.ts`) | PR |
| Engine property tests | replay determinism; snapshot equivalence (`reduce(all) == reduce(rest, from: snapshot)`); reducer tolerance (arbitrary invalid events never throw and never change facts); formula parser round-trips; stacking policies | `packages/engine/test/properties/` | PR |
| Vocabulary conformance | one micro-pack + test per effect type and predicate form | `packages/engine/test/vocabulary/` | PR |
| Pack validation | SRD core pack validates against schema and semantic checks; import tool produces the same output from the same open5e input (snapshot of counts and a hash) | `packages/content/test/` | PR |
| Protocol tests | Zod schemas accept/reject fixtures; JSON Schema export is stable (snapshot) | `packages/protocol/test/` | PR |
| API/DO tests | append/read/permissions/quota/dedupe/transactions; WS hello/ack/reject; blob relay forwarding; rate limiter windows; auth flows with real PBKDF2 verifiers; the campaign pack relay (DM upload, verified `pack.enabled`, member GET, `welcome.packs`, `packMissing`, 7th-pack quota, version change, disable deletes the body). The conformance suite runs the pack round trip and blob relay forwarding against both adapters (`apps/api/test/conformance/scenarios.ts:1259`, `:1333`) | `apps/api/test/` (workerd via vitest-pool-workers; Node adapter in plain Vitest) | PR |
| Web unit tests | stores (replica pending/commit/rollback), sync client backoff & gap detection (fake socket), image pipeline (canvas mocked; hashing real), export/import round-trip, i18n ICU rendering per locale | `apps/web/src/**/*.spec.ts` | PR |
| E2E | create character (Fighter, Wizard) → play → level up → export → import; two browser contexts (DM + player) sync HP/conditions; join by code; offline → edits → reconnect → converge; iOS Safari smoke via WebKit project. The `e2e:sync` project runs against a real Node adapter; since plan 16 it includes campaign packs (the DM enables an imported pack, the member's device installs it, the member pins it from the sheet banner, the DM's View sheet resolves the pack item, the DM disables it — `apps/web/e2e/sync/campaign-packs.spec.ts`) | `apps/web/e2e/` | PR (Chromium) + nightly (WebKit, Firefox) |
| Accessibility | axe on sheet/play/party/library, and on the campaign settings content-packs section (`e2e:sync`, plan 16); keyboard-only run of the wizard | in E2E (shared helper `apps/web/e2e/helpers/axe.ts`) | PR |
| Performance | replay/derive timings on a fixture (CI budget); bundle-size budget | engine bench + `ng build` budgets | PR |

## Golden fixture format

```jsonc
{
  "name": "fighter-5",
  "packs": ["dist:srd-5e-2024"],          // or "fixture:<name>" for an engine fixture pack
  "events": [ /* character.created, decision.made…, level.gained… */ ],
  "expect": {
    "sheet.level": 5, "sheet.prof": 3, "sheet.hp.max.value": 44, "sheet.ac.value": 19,
    "sheet.attacksPerAction": 2, "sheet.attacks[0].toHit.value": 7,
    "sheet.abilities[\"str\"].save.value": 7, "facts.xp": 6500
  },
  "absent": [],                            // optional: paths that must not exist
  "systemPatch": {}                        // optional: merged into the core's system entity
}
```

The fields are typed by `GoldenFixture` (`packages/engine/test/support/golden.ts:10-31`).
Expectation paths are dotted paths with `[n]` and `["key"]` segments, read from
`{ facts, sheet }` (`getPath`, `golden.ts:89`); a mismatch fails `toEqual` with every pinned
path shown. `packs` entries are `dist:<id>` (a built content pack) or `fixture:<name>`
(`packages/engine/test/fixtures/packs/<name>.json`); a golden that lists a fixture pack derives
against the per-character index scoped to its pins, as the web does. `absent` lists paths that
must resolve to `undefined` (plan 14). `systemPatch` (plan 16) is deep-merged into the core pack's
`system` entity and revalidated with the strict schema before the index is built
(`golden.ts:104-128`): objects merge key by key, arrays and scalars replace. It stands for a
different core pack (e.g. `{ "multiclass": { "masteryCount": "sum" } }` in
`mastery-sum-rule.json`), because the documented rule is that only a `kind: core` pack may change
`system`. That rule is not enforced yet (owner-flag in `04-content-packs.md` "Overrides"); the
harness follows it so goldens do not depend on the gap.

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
