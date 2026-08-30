# ADR-013 — Rules engine architecture

**Status:** Approved 2026-08-30. Depends on ADR-007, ADR-008. Details in
`02-architecture/05-rules-engine.md`.

## Context

The engine must compute a complete 5e-2024 character sheet from (decisions + in-play
facts + content packs), validate choices, drive the level-up wizard, explain every
number, run identically on every device (and in Node for tests and tooling), and contain
no ruleset-specific code. Phase 1 mechanics: Fighter (Champion) and Wizard (Evoker),
levels 1–5; all species, backgrounds, equipment and spells as data.

## Options considered

| Option | Assessment |
|--------|-----------|
| Hand-written per-class TypeScript | Fast to start, violates the non-negotiable rule, every later class is code. Rejected. |
| Generic "modifier bag" with string keys and no schema | Flexible but unvalidatable; packs would be write-only. Rejected. |
| **Typed effect vocabulary + generic evaluation pipeline (chosen)** | Packs are validated data; the engine is one pipeline; new mechanics are new effect types (rare) or new data (common). |
| Rules-as-Prolog/Datalog | Elegant, alien to contributors, heavy in the browser. Rejected. |

## Decision

### Pipeline

```
events ──reduce──▶ Facts ──derive(content)──▶ Sheet
                     │                          │
                     └── pendingAdvancements ◀──┘
```

1. **`reduce(events) → Facts`** (pure, total). Facts hold decisions (choice id →
   selection), levels per class, XP, in-play numbers (HP, temp HP, hit dice, death
   saves, slots used, resource uses), conditions (with source/duration), inventory
   instances (item id, qty, equipped, attuned, custom name/notes), currency, notes,
   portrait hashes, pinned pack versions, grammatical gender, and `skipped[]`.
2. **`derive(facts, content, options) → Sheet`** (pure, memoized by facts version +
   content version). Steps:
   - *Resolve composition*: from the system's composition slots and the decisions, find the
     active species, background, classes/subclasses with levels, feats, equipped/attuned
     items, active conditions.
   - *Collect grants*: walk each active entity's `grants` (features), class progression
     rows up to the class level, item properties, condition effects; evaluate each
     grant's predicate against the facts; produce a flat list of active **effects** with
     their **source** (entity id + feature id).
   - *Build the modifier table*: each effect adds a modifier to a target (`ability.str`,
     `ac`, `speed.walk`, `save.wis`, `skill.stealth`, `attack.melee`, …) with a value or
     formula, a stacking key, and a source.
   - *Evaluate in dependency order*: ability scores → modifiers/proficiency → derived
     (AC formulas take the max; bonuses stack unless they share a stacking key; `set`
     beats `bonus` only if higher, per 5e's "use the better" convention encoded as a
     policy on the target) → HP max → speeds/senses → saves/skills/passives → attacks
     (weapons with mastery, spell attack) → spellcasting blocks per class (ability, DC,
     attack bonus, slots from the system's tables by caster type, prepared/known lists,
     rituals) → resources with max/reset → actions list → features text.
   - *Provenance*: every derived number carries `contributions[]` (`+2 from Chain Mail`,
     `+1 from Defense fighting style`) for tooltips and debugging.
   - *Choices*: compare progression choices for current levels against decisions →
     `outstandingChoices[]`; compute `pendingAdvancements` (levels available by XP or
     grants).
   - *Validation*: run prerequisites of every decision against the current facts; report
     `issues[]` with severity (`error` in strict mode, `warning` when house rules allow
     overrides) and never fail derivation.
3. **Actions** (what the UI can do) are engine functions that *propose events* rather
   than mutate: `proposeDamage(sheet, 7)` → `[{type: "hp.changed", …}]`; `proposeRest(
   "long")` → slot/resource resets + hit-dice regain per the system's rest rules;
   `proposeCast(spell, level)` → slot spend (+ concentration events). The UI emits what
   the engine proposes, so rules live in one place and the DO never needs them.
4. **Dice** are separate from derivation: `roll(formula, sheetContext)` returns a result
   record; the UI emits `roll.logged`. Rolls never change facts by themselves (the player
   confirms applying damage), which keeps physical-dice users first-class.

### Two rulesets without special cases

The engine's only knowledge of "5e" is what the `system` entity (ADR-008) declares. A
2014 core pack declares different composition slots (race/subrace), moves ability bonuses
to races, has no origin feats, different feats, and its own tables. The pipeline does not
change. The Phase 6 proof consists of importing SRD 5.1 and fixing whatever the
vocabulary lacks — which is the acceptable kind of change.

### Performance envelope

Replaying 2,000 events and deriving a level-20 sheet must take < 20 ms on a mid-range
phone (target measured in Phase 1b on a real device). The engine is main-thread in v1; it
is pure and message-passable, so moving `derive` into a Web Worker later is mechanical.

### Testing (the engine is the most tested code in the project)

- **Golden characters**: JSON fixtures of decisions → expected Sheet fragments (e.g.
  "Fighter 5, chain mail + shield, Defense → AC 19"), for every SRD class/level shipped.
- **Reducer properties**: replay determinism (same events, same facts), idempotent
  snapshot equivalence, tolerance (random invalid events never throw).
- **Vocabulary conformance**: every effect type has a test pack and a test.
- **Pack schema tests**: the SRD core pack validates against the published schema on
  every build.

## Consequences

- The SRD import tool must express every Phase-1 mechanic in the vocabulary; if it
  cannot, the vocabulary grows (a documented, versioned change), never the engine's
  special cases.
- Provenance makes the "why" tooltip free and makes bugs in packs visible to authors.
- The UI never computes a rule; it renders the Sheet and emits engine-proposed events.

## Open points

- Weapon Mastery (2024) and Sneak Attack scaling exercise the vocabulary early; both are
  in the Phase 1/4 golden tests to force the design.
