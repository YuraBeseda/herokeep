/**
 * Plan 18 task 2: the round counter the caller read from the campaign stream (or, for a solo hero,
 * from its own stream). `encounter` absent = no encounter is open, so every rounds condition that
 * belongs to an encounter reads `ended`. A condition tied to an encounter id other than `encounter.id`
 * is `ended` too (its encounter closed and a new one started), so counts never jump or go negative.
 */
export interface CampaignClock {
  encounter?: { id: string; round: number };
}

/**
 * Ruling 1 (phase 4, plan 11 task 4 — "house-rule overrides into derive"): `derive()`'s optional,
 * typed input for table/campaign house rules. The ENGINE stays campaign-unaware and deterministic —
 * `derive()` only ever applies a value the CALLER already computed and hands in here; nothing in
 * `@hk/engine` reads a campaign entity, a settings store, or makes any I/O to produce one. Computing
 * the actual override value (e.g. reading a campaign's house-rules record) is the CLIENT's job
 * (task 12).
 *
 * - `attunementMax` — threaded THIS task (task 4): overrides `system.attunementMax` when present.
 *   See `Sheet.attunementMax` / `Sheet.overridesProvenance` and `derive/index.ts`.
 * - `encumbrance` — accepted and typed here (defaults to `'off'`, i.e. no behavioral change from
 *   today) but not yet READ by any derive step; task 5 (encumbrance math) is its consumer. The field
 *   lives on this shared type now specifically so task 5 extends the SAME `DeriveOverrides` instead
 *   of reshaping `derive()`'s signature again.
 * - Plan 14 (phase 4 slice 4) Task 5, design ruling 8: a value here is the CAMPAIGN house rule and
 *   wins over the character's own `facts.options` (`character.options.set@1`), which in turn wins
 *   over the default `'off'`. An explicit `encumbrance: 'off'` here is a decision too (it holds a
 *   character option off); omit the key to let the character option through.
 */
export interface DeriveOverrides {
  /** Without a clock, `rounds` conditions carry no `remaining`. */
  clock?: CampaignClock;
  attunementMax?: number;
  encumbrance?: 'off' | 'standard' | 'variant';
}
