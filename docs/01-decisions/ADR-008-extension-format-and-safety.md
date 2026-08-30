# ADR-008 — Extension format, versioning and safety

**Status:** Approved 2026-08-30. Depends on ADR-007, ADR-013. Detailed schema in
`02-architecture/04-content-packs.md`.

## Context

Rules are data (non-negotiable). Community content must be addable without code, must be
safe to load from strangers, must survive updates without corrupting existing characters,
and must eventually carry real mechanics (a custom species with unique bonuses and
skills). The 2014 ruleset must be addable later as a second system.

## Options considered

### Format

| Option | Assessment |
|--------|-----------|
| **JSON with a declarative effect vocabulary + safe formula grammar (chosen)** | Expressive enough for the SRD (the proof: the SRD *is* written in it), machine-validatable, diffable, translatable, no code execution. |
| JSON "fixed fields" only (v1) then scripts later | The later phase would be a rewrite of every entity; and the SRD itself needs mechanics (Unarmored Defense, Sneak Attack scaling), so "fixed fields" cannot even express the shipped content. Rejected. |
| Embedded JavaScript / Lua / WASM effects | Real power, real danger: sandboxing in the browser is hard, in the DO impossible within CPU limits, and determinism across replicas is not guaranteed. Rejected for the foreseeable future; the vocabulary grows instead. |
| YAML / TOML authoring | Nice to hand-write; convert to JSON at pack build time. Allowed as an authoring format in `pack-tools`; the *interchange* format is JSON. |

### Versioning and updates

| Option | Assessment |
|--------|-----------|
| Characters always use the latest pack | Silent sheet changes ("my AC dropped") and broken references when an entity is removed. Rejected. |
| **Characters pin exact pack versions; explicit rebase on update (chosen)** | Stable sheets; updates are a visible, reversible action with a diff. |

## Decision

### Pack identity and structure

- A pack has a globally unique `id` (`srd-5e-2024`, `ivan-homebrew`), a **semver**
  `version`, a `kind` (`core` — defines a system; `content`; `translation`; `theme`), a
  `system` it targets (`5e-2024`), `dependencies` with semver ranges, `entities`,
  optional `overrides` of other packs' entities, an `assets` manifest (image hashes), and
  `attribution`/`license` text.
- Entity ids are namespaced by the pack: `srd-5e-2024:spell/fireball`. A pack may only
  *define* entities in its own namespace and may only *override* others' explicitly, in
  `overrides`, which the UI surfaces to the DM as a warning ("modifies core Fighter").
- Each entity has a `type` (species, background, class, subclass, feature, feat, spell,
  item, condition, skill, ability, language, tool, rule, table, system), localizable
  fields (`name`, `description`, nested feature text), `tags`, `prerequisites`
  (predicates), `effects`, `choices`, and type-specific data (class progression rows,
  spell level/school/components, item category/properties/cost/weight…).

### Mechanics are data: effects, predicates, formulas, choices

- **Effects** are typed records applied when their granting feature is active, e.g.
  `{type: "ability.bonus", ability: "str", value: 2}`,
  `{type: "ac.formula", formula: "10 + mod(dex) + mod(con)", key: "unarmored-defense"}`,
  `{type: "resource.define", id: "second-wind", max: "1", reset: "shortRest"}`,
  `{type: "proficiency.grant", kind: "skill", target: "stealth", level: "expertise"}`.
  The full vocabulary is in `02-architecture/04`; it is versioned by `format` and unknown
  effect types are ignored with a warning (forward compatibility).
- **Predicates** for prerequisites and conditional effects: `{all|any|not}`,
  `{ability: {str: {gte: 13}}}`, `{classLevel: {wizard: {gte: 3}}}`, `{hasFeature: id}`,
  `{armor: {category: ["none", "light"]}}`, `{tag: "..."}`.
- **Formulas** are strings in a tiny arithmetic grammar with named variables and a fixed
  function set (`level`, `classLevel(x)`, `mod(dex)`, `score(str)`, `prof`, `max`, `min`,
  `floor`, `ceil`). Parsed by our own parser into an AST; length ≤ 256, depth ≤ 16; no
  identifiers outside the whitelist; never `eval`.
- **Choices** are the decision points recorded as events (ADR-007): `{id, at: {kind:
  "classLevel", class: "fighter", level: 1}, pick: {query: {type: "feat", tag:
  "fighting-style"}}, count: 1}`.

### The system is also data

A `core` pack contains a `system` entity that declares what a character is made of for
that ruleset: ability list, skill list, saving throws, **composition slots** (2024:
species ×1, background ×1, classes ×N; 2014: race ×1, subrace ×0–1, background ×1…),
rest types, XP and proficiency tables, spell-slot tables, currencies, damage types,
sizes, condition list. The engine reads these instead of hardcoding them. This is the
concrete mechanism that makes SRD 5.1 "another pack" later.

### Versioning rules

- Semver. Patch: text fixes. Minor: additions. Major: removals or changed mechanics.
- Characters record `pack.pinned {packId, version}` events; the engine loads exactly those
  versions. Devices keep every pinned version locally; a campaign's DO stores the JSON of
  every non-core pack it has enabled (≤ 5 MB each) so joiners can fetch them without the
  DM online. Core packs are immutable static assets by version.
- **Rebase** (the update flow): when a newer version is enabled in the campaign (or
  installed solo), the sheet shows "Update available". Rebase replays the character's
  decisions against the new version and produces a report: unchanged / changed derived
  values (with before/after) / invalidated decisions (entity removed, prerequisite now
  failing, choice options changed). The user resolves invalidated decisions in a wizard
  and confirms; the result is one transaction of `pack.pinned` + fix-up `decision.made`
  events. Cancelling leaves the old pin. `deprecated: {replacedBy}` on an entity lets
  rebase auto-migrate references.
- A missing entity at render time (pack uninstalled, corrupt import) never crashes: the
  engine renders an "unresolved reference" chip with the id and the sheet stays usable.

### Safety for untrusted packs

- JSON only; validated against the published JSON Schema (generated from the Zod schemas
  in `@hk/protocol`) before anything is stored. Unknown top-level keys rejected; unknown
  effect types warned.
- No strings are ever interpreted as code. Formulas go through the whitelist parser.
  Markdown in descriptions is rendered by a sanitizing renderer with a fixed allowlist
  (no raw HTML, no images except pack assets by hash, links open externally with
  `rel="noopener"`).
- Size caps: pack JSON ≤ 5 MB; ≤ 5,000 entities; description ≤ 20 KB; assets per the image
  limits (ADR-010). Dependency depth ≤ 4; cycles rejected.
- Trust is explicit: a pack does nothing until a DM enables it in a campaign or a player
  installs it solo; the enable screen shows the pack's declared overrides, asset count and
  size, and attribution.
- Determinism: pack content cannot access time, randomness, network, or device state, so
  every replica derives the same sheet.

## Consequences

- The SRD import tool (`packages/content`) is the first and most demanding pack author;
  any SRD mechanic that cannot be expressed forces a vocabulary extension — which is the
  intended pressure.
- Phase 7's GUI pack editor edits the same JSON; "rich extensions" means more effect
  types and better editors, not a new runtime.
- Translation packs (ADR-009) are packs of `kind: translation` with the same lifecycle.

## Open points

- Whether to support signed packs (author identity) is deferred; the DM-enable step is the
  trust boundary for a friends-of-friends audience.
