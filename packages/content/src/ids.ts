import { type EntityType, makeEntityId } from '@hk/protocol';
import { PACK_ID } from './version.ts';

/** Builds a `srd-5e-2024:<type>/<slug>` entity id for this pack. */
export function entityId(type: EntityType, slug: string): string {
  return makeEntityId(PACK_ID, type, slug);
}

export const spellId = (slug: string): string => entityId('spell', slug);
export const itemId = (slug: string): string => entityId('item', slug);
export const featureId = (slug: string): string => entityId('feature', slug);
export const classId = (slug: string): string => entityId('class', slug);
export const subclassId = (slug: string): string => entityId('subclass', slug);
export const speciesId = (slug: string): string => entityId('species', slug);
export const backgroundId = (slug: string): string => entityId('background', slug);
export const featId = (slug: string): string => entityId('feat', slug);
export const conditionId = (slug: string): string => entityId('condition', slug);
export const skillId = (slug: string): string => entityId('skill', slug);
export const abilityId = (slug: string): string => entityId('ability', slug);
export const languageId = (slug: string): string => entityId('language', slug);
export const ruleId = (slug: string): string => entityId('rule', slug);
