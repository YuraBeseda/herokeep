import { EFFECT_TYPES } from '@hk/protocol';

export const KNOWN_EFFECT_TYPES: ReadonlySet<string> = new Set<string>(EFFECT_TYPES);

export function isKnownEffectType(type: string): boolean {
  return KNOWN_EFFECT_TYPES.has(type);
}
