import type { Entity } from '@hk/protocol';
import type { ClassOption } from './entity-form.helpers';

/** Scope-relative translate function (`packs`). */
type T = (key: string, params?: Record<string, unknown>) => string;

/**
 * The sub-line of a homebrew entry (boards PK04/PK05): a few facts read off the entity itself,
 * each label from the `packs` scope. Values that are open pack vocabulary (damage types, schools,
 * sizes, creature types) are shown as the pack wrote them; enums go through `homebrew.enum.*`.
 * Nothing here knows a 5e rule — it only restates fields the entity already carries.
 */
export function entrySummary(
  entity: Entity,
  t: T,
  classes: readonly ClassOption[] = [],
): readonly string[] {
  switch (entity.type) {
    case 'item': {
      const parts = [t(`homebrew.enum.category.${entity.category}`)];
      if (entity.rarity) parts.push(t(`homebrew.enum.rarity.${entity.rarity}`));
      if (entity.weapon) {
        parts.push(
          t('homebrew.sub.weapon', {
            damage:
              typeof entity.weapon.damage === 'string'
                ? entity.weapon.damage
                : entity.weapon.damage.flat,
            type: entity.weapon.damageType,
          }),
        );
      }
      if (entity.armor) parts.push(t('homebrew.sub.ac', { ac: entity.armor.ac }));
      if (entity.shield) parts.push(t('homebrew.sub.shield-ac', { ac: entity.shield.ac }));
      if (entity.weight !== undefined)
        parts.push(t('homebrew.sub.weight', { weight: entity.weight }));
      if (entity.cost) {
        parts.push(
          t('homebrew.sub.cost', { amount: entity.cost.amount, currency: entity.cost.currency }),
        );
      }
      if (entity.attunement?.required) parts.push(t('homebrew.sub.attunement'));
      return parts;
    }
    case 'spell': {
      const names = entity.classes.map(
        (slug) => classes.find((option) => option.slug === slug)?.name ?? slug,
      );
      return [
        t('homebrew.sub.spell', { level: entity.level, school: entity.school }),
        `${entity.castingTime.value} ${t(`homebrew.enum.time-unit.${entity.castingTime.unit}`)}`,
        t(`homebrew.enum.range-kind.${entity.range.kind}`),
        ...(names.length > 0 ? [names.join(', ')] : []),
      ];
    }
    case 'feat':
      return [
        t(`homebrew.enum.feat-category.${entity.category}`),
        t(entity.repeatable ? 'homebrew.sub.repeatable' : 'homebrew.sub.not-repeatable'),
      ];
    case 'species':
      return [entity.size, t('homebrew.sub.speed', { speed: entity.speed }), entity.creatureType];
    default:
      return [];
  }
}
