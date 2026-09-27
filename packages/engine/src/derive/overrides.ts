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
 */
export interface DeriveOverrides {
  attunementMax?: number;
  encumbrance?: 'off' | 'standard' | 'variant';
}
