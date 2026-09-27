import { z } from 'zod';

export const SemverSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/, 'Expected semver x.y.z');
export const BlobHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
/** A pack asset hash or a bundled game-icons id (gi:<slug>). */
export const IconRefSchema = z.union([BlobHashSchema, z.string().regex(/^gi:[a-z0-9][a-z0-9-]*$/)]);
/** NdS(+/-M), e.g. 1d8, 2d6+3, 8d6 */
export const DiceSchema = z.string().regex(/^\d{1,2}d(4|6|8|10|12|20|100)([+-]\d{1,3})?$/);
export type Dice = z.infer<typeof DiceSchema>;

/**
 * Ruling 6 (phase 4, plan 11 task 1): a fixed damage/roll amount with no die, e.g. a weapon's flat
 * "+1" component. Additive: a NEW schema alongside `DiceSchema`, not a widening of it — `DiceSchema`
 * itself (and every field typed with it today: `ItemEntitySchema.weapon.damage`/`versatile`,
 * `SpellEntitySchema.damage.dice`) is untouched, so old NdM+K strings keep parsing byte-identically
 * and no existing TS caller of those fields breaks (e.g. `packages/engine/src/derive/attacks.ts`'s
 * `damage: { dice: string; ... }` assigns `weapon.damage` directly and would fail to typecheck if
 * `DiceSchema` itself became a union). Migrating a specific field (e.g. `weapon.damage`, to retire
 * the Blowgun `0d4+1` zero-count-die hack) to accept this shape via `DiceOrFlatSchema` is
 * content/schema-field work for a later task, not this one.
 */
export const FlatDiceSchema = z.strictObject({ flat: z.int().min(0).max(999) });
export type FlatDice = z.infer<typeof FlatDiceSchema>;

/** Dice notation (`DiceSchema`) or a flat fixed amount (`FlatDiceSchema`) — the vocabulary a future
 *  field migration (ruling 6) can adopt in place of a bare `DiceSchema` reference. */
export const DiceOrFlatSchema = z.union([DiceSchema, FlatDiceSchema]);
export type DiceOrFlat = z.infer<typeof DiceOrFlatSchema>;

export const TagSchema = z.string().min(1).max(64);
