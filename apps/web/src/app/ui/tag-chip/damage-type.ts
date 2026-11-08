/**
 * The thirteen damage-type ink tokens (`--damage-<type>`). Presentation only: a component names
 * the ink, it never decides what a damage type is.
 */
export type DamageInk =
  | 'acid'
  | 'bludgeoning'
  | 'cold'
  | 'fire'
  | 'force'
  | 'lightning'
  | 'necrotic'
  | 'piercing'
  | 'poison'
  | 'psychic'
  | 'radiant'
  | 'slashing'
  | 'thunder';

export function damageInk(ink: DamageInk | null | undefined): string | null {
  return ink ? `var(--damage-${ink})` : null;
}
