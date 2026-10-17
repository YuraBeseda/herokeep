import { parseRollSpec, roll, type Sheet } from '@hk/engine';

/**
 * Plan 13 task 6 (ruling 7): rolls every resource whose `regain` is dice (an item's
 * `charges.regain`, e.g. Wand of Magic Missiles' `1d6+1`) and returns `{resourceId: total}` for
 * `propose.rest`'s `regainRolls`. The CALLER rolls (same split as the rest dialog's hit dice:
 * `roll(parseRollSpec(...), cryptoRng)` here, the engine only records the total as
 * `resource.restored.count`), so replay never re-rolls. Rolls for resources the rest doesn't
 * restore are ignored by the engine, so this rolls every regain resource without filtering by reset.
 */
export function rollChargeRegains(sheet: Sheet, rng: () => number): Record<string, number> {
  const rolls: Record<string, number> = {};
  for (const r of sheet.resources) {
    if (r.regain !== undefined) rolls[r.id] = roll(parseRollSpec(r.regain), rng).total;
  }
  return rolls;
}
