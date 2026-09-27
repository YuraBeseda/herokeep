import type { Diagnostic } from '../diagnostics.ts';
import type { Facts, InventoryEntry } from '../reduce/facts.ts';
import type { AbilitiesResult, AbilityBlock } from './abilities.ts';
import type { ActionView } from './actions.ts';
import type { AttackRow } from './attacks.ts';
import type { Carry } from './encumbrance.ts';
import type { HpResult } from './hp.ts';
import type { Derived } from './modifiers.ts';
import type { ResourceView } from './resources.ts';
import type { SpellcastingBlock } from './spellcasting.ts';

export interface ChoiceRequest {
  choiceId: string;
  ownerId: string;
  count: number;
}

/**
 * The full character sheet — plan 5's UI contract (task-13-brief.md). Plain data, JSON-serializable
 * (every value is a plain object/array/primitive; `Derived<number>`'s `contributions` are themselves
 * plain objects — see modifiers.ts).
 */
export interface Sheet {
  name: string;
  system: string;
  level: number;
  classes: { classId: string; level: number; subclassId?: string }[];
  pins: Record<string, string>;
  abilities: Record<string, AbilityBlock>;
  prof: number;
  skills: AbilitiesResult['skills'];
  passivePerception: number;
  speed: Record<string, Derived<number>>;
  senses: AbilitiesResult['senses'];
  languages: AbilitiesResult['languages'];
  ac: Derived<number>;
  hp: HpResult;
  /** dex mod + `initiative.bonus` effects — assembled in derive/index.ts, no sibling module owns it. */
  initiative: Derived<number>;
  attacks: AttackRow[];
  attacksPerAction: number;
  /**
   * Phase 4 plan 11 task 6: the resolved `mastery.grant` count (row-extra-wins-over-formula, see
   * `derive/attacks.ts`'s `resolveMasteryCount`) — how many weapon-mastery properties the character
   * currently knows. Present ONLY while at least one `mastery.grant` effect is active (mirrors
   * `carry`/`concentration`'s "absent, not merely `undefined`, when irrelevant" convention), so every
   * pre-task-6 golden/fixture without an active mastery-granting class stays byte-identical.
   */
  masteryCount?: number;
  spellcasting: SpellcastingBlock[];
  /**
   * task-3-brief.md (play UI, phase-1b plan 6): `deriveSpellcasting` (`derive/spellcasting.ts`)
   * already computes this — `facts.concentration` stripped to just the spell id — but it was never
   * wired into `Sheet` itself (only `spellcasting.blocks` was; `spellcasting.concentration` was
   * silently dropped in `derive/index.ts`). Added here, additively, so the play tab's concentration
   * chip/End-button has somewhere to read it from without reaching past the read model into
   * `Facts` directly. Present only while actually concentrating (never an explicit `undefined` key
   * — see `derive/index.ts`'s conditional spread), so every existing exact-key-list Sheet test
   * (`sheet.test.ts`) and golden fixture stays green unchanged for every non-concentrating fixture.
   */
  concentration?: { spellId: string };
  resources: ResourceView[];
  actions: ActionView[];
  /** Union (by kind+target) of armor/weapon/tool/language proficiency, assembled in derive/index.ts. */
  proficiencies: { kind: string; target: string; level: string; sources: string[] }[];
  /**
   * `resolved: false` for an entry whose `itemId` no longer resolves in the content index — an
   * unknown-id chip. `attunementAllowed` (phase 4, plan 11 task 4): present ONLY when the resolved
   * item entity declares `item.attunement.by` (a `Predicate`) — `true`/`false` is that predicate
   * evaluated against the character's current derive-time state (abilities, classes, proficiencies,
   * conditions, tags, active features — see `attunementPredicateContext` in `derive/index.ts`).
   * Absent (not merely `true`) when the item has no `attunement.by` at all, so no existing golden/
   * fixture without one ever gains the key — `propose.attune` (which only ever sees a `Sheet`, never
   * a `ContentIndex`) reads this to refuse an attune whose requirement isn't met, exactly the same
   * "pre-resolve at derive time so propose only needs Sheet" shape `resolved` and `attunementMax`
   * already use.
   */
  inventory: (InventoryEntry & { resolved: boolean; attunementAllowed?: boolean })[];
  /**
   * Task 14 controller ruling: `system.attunementMax` (the pack-declared attunement cap; the
   * reducer stays permissive per doc-02, so this is a UI/proposer-side limit, not a reducer
   * invariant) — `propose.attune` refuses past it. Read verbatim from `index.system()` in
   * derive/index.ts; not on `task-13-brief.md`'s literal Sheet snippet, added additively here so
   * `propose.attune` (which only ever sees a `Sheet`) has somewhere to read it from.
   *
   * Ruling 1 (phase 4, plan 11 task 4): when `derive()`'s optional `overrides.attunementMax` is
   * given, THIS is the overridden value (not the pack's own) — `overridesProvenance.attunementMax`
   * then reads `'house rule'`. Kept a plain `number` (not reshaped into a `Derived`-like wrapper)
   * so every existing reader (`propose/items.ts`'s `sheet.attunementMax` comparison, every existing
   * test/golden fixture) keeps compiling and comparing unchanged.
   */
  attunementMax: number;
  /**
   * Ruling 1 (phase 4, plan 11 task 4): present ONLY when at least one `derive()` `overrides` field
   * was actually supplied for THIS call — so every existing call site (which never passes
   * `overrides`) never gains this key, keeping every prior golden/exact-key-list test byte-identical.
   * `'house rule'` is the literal provenance tag task 12's UI shows next to an overridden value (the
   * plan's own wording). `encumbrance` is listed on the type now (task 5 extends this object, not a
   * new one) but is never set by this task — task 4 doesn't compute or read encumbrance at all.
   */
  overridesProvenance?: { attunementMax?: 'house rule'; encumbrance?: 'house rule' };
  /**
   * Ruling 1 (phase 4, plan 11 task 5 — "encumbrance option"): present ONLY when `derive()`'s
   * `overrides.encumbrance` is `'standard'` or `'variant'` for THIS call (never for `'off'`/absent,
   * the default — zero computation, so every pre-task-5 golden/fixture stays byte-identical) AND
   * the pack actually authors that mode's `system.encumbrance` config (a `'derive.
   * encumbranceConfigMissing'` warning is pushed to `issues` instead when it doesn't, and `carry`
   * stays absent). `mode` records which of the two was active — read this rather than
   * `overridesProvenance.encumbrance` (which, matching `attunementMax`'s existing shape, is just
   * the `'house rule'` tag, not the mode) for anything mode-specific. `load` sums every
   * `facts.inventory` entry's resolved weight × `qty`, regardless of equipped/attuned state — see
   * `derive/encumbrance.ts` and doc-04's "Encumbrance" section for the full sourcing/SRD-silence
   * write-up. NOT applied to `Sheet.speed`: no vendored 2024 text exists to cite a specific
   * speed-reduction number, so `variant`'s per-threshold `speedPenalty` (if authored) stays
   * display-only data on this block, for a later consumer (task 12, or a future engine task).
   */
  carry?: Carry;
  currency: Facts['currency'];
  inspiration: boolean;
  conditions: HpResult['conditions'];
  xp: number;
  grammaticalGender: Facts['grammaticalGender'];
  /** Creation-time outstanding choices PLUS every class/subclass level-row choice at or below the character's current level in that class (task-13-brief.md). */
  outstandingChoices: ChoiceRequest[];
  issues: Diagnostic[];
}
