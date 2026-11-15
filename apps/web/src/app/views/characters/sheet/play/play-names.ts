import { makeEntityId, parseEntityId } from '@hk/protocol';
import type { Sheet } from '@hk/engine';
import type { EngineFacade } from '@shared/services/engine/engine.facade';
import type { SpellRow } from './play-actions.service';
import {
  formatCastingTime,
  formatComponents,
  formatDuration,
  formatRange,
  formatSchool,
} from '../../../../ui/entity-facts/entity-facts.formatters';
import type { ConditionDialogOption } from './condition-dialog.component';
import type { CastDialogSummary } from './cast-dialog.component';
import type { RestDialogHitDieOption } from './rest-dialog.component';

type ResourceView = Sheet['resources'][number];
type ActionView = Sheet['actions'][number];
type InventoryRow = Sheet['inventory'][number];

/**
 * Pack-text resolution for the sheet's leaves. Every name a leaf shows flows through the
 * (character-scoped) `EngineFacade`'s localizer, never a string literal. Each helper falls back to
 * the raw id/slug for anything the content index does not resolve — it never throws. A function
 * over the facade (not an injectable) because the facade is scoped by the element injector.
 */
export function sheetNames(engineFacade: EngineFacade) {
  /** An id (or slug such as the weapon-category `'martial'`) resolved to its localized name. */
  const resolve = (id: string): string =>
    engineFacade.index().has(id) ? engineFacade.localizer().name(id) : id;

  // `ResourceView.name`/`ActionView.name` are baked at build time from the granting feature's
  // effect (English). `.source` is the entity id that effect came from and IS resolvable.
  const sourceLabel = (view: { source: string; name: string }): string =>
    engineFacade.index().has(view.source) ? engineFacade.localizer().name(view.source) : view.name;

  // A slug that a pack separately declares as an entity under the system's own pack id.
  const slugEntityName = (type: 'skill' | 'item', slug: string, prefix = ''): string => {
    const index = engineFacade.index();
    const packId = parseEntityId(index.system().id)?.packId;
    const id = packId ? makeEntityId(packId, type, `${prefix}${slug}`) : undefined;
    return id && index.has(id) ? engineFacade.localizer().name(id) : slug;
  };

  return {
    resolve,
    resourceLabel: (view: ResourceView): string => sourceLabel(view),
    actionLabel: (view: ActionView): string => sourceLabel(view),
    /** Abilities resolve by abbreviation against the pack's own `ability` entities. */
    abilityName: (key: string): string => {
      const entity = engineFacade
        .index()
        .byType('ability')
        .find((e) => e.type === 'ability' && e.abbreviation === key);
      return entity ? engineFacade.localizer().name(entity.id) : key.toUpperCase();
    },
    skillName: (slug: string): string => slugEntityName('skill', slug),
    toolName: (slug: string): string => slugEntityName('item', slug),
    /** A damage type is a plain slug named through the pack's `rule/damage-type-<slug>` entity. */
    damageTypeName: (slug: string): string => {
      const index = engineFacade.index();
      const packId = parseEntityId(index.system().id)?.packId;
      const ruleId = packId ? makeEntityId(packId, 'rule', `damage-type-${slug}`) : undefined;
      return ruleId && index.has(ruleId) ? engineFacade.localizer().name(ruleId) : slug;
    },
    /** The entity's sprite id (`EngineFacade.iconFor`), or `fallback` for a stale id. */
    iconOf: (id: string, fallback: string): string => {
      const entity = engineFacade.index().get(id);
      return entity ? engineFacade.iconFor(entity) : fallback;
    },
    /** The condition-add dialog's options: the pack's own `system.conditions` id list, localized,
     * with a data-driven `levelBearing` flag (`ConditionEntitySchema.levels`); sorted by name. */
    conditionOptions: (): ConditionDialogOption[] => {
      const index = engineFacade.index();
      return index
        .system()
        .conditions.map((id) => {
          const entity = index.get(id);
          const levels = entity?.type === 'condition' ? entity.levels : undefined;
          const description =
            entity?.type === 'condition'
              ? engineFacade.localizer().text(id, 'description').text
              : '';
          return {
            id,
            name: resolve(id),
            levelBearing: levels !== undefined,
            ...(levels !== undefined ? { maxLevel: levels } : {}),
            ...(description ? { description } : {}),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    /** The short-rest dialog's hit-dice picker only offers a class that still has dice left. */
    hitDiceOptions: (sheet: Sheet | undefined): RestDialogHitDieOption[] =>
      Object.entries(sheet?.hp.hitDice ?? {})
        .filter(([, dice]) => dice.remaining > 0)
        .map(([classId]) => ({ classId, className: resolve(classId) })),
    itemName: (entry: InventoryRow): string =>
      entry.itemId ? resolve(entry.itemId) : (entry.name ?? entry.instanceId),
    /** `level`/`concentration` read straight off the spell ENTITY (R9); `0`/`false` for a stale id. */
    spellRow: (id: string): SpellRow => {
      const entity = engineFacade.index().get(id);
      const spell = entity?.type === 'spell' ? entity : undefined;
      const summary: CastDialogSummary | undefined = spell
        ? {
            school: formatSchool(spell.school),
            castingTime: formatCastingTime(spell.castingTime),
            ...(spell.castingTime.condition
              ? { castingCondition: spell.castingTime.condition }
              : {}),
            range: formatRange(spell.range),
            components: formatComponents(spell.components),
            duration: formatDuration(spell.duration),
            ritual: spell.ritual,
          }
        : undefined;
      return {
        id,
        name: resolve(id),
        level: spell?.level ?? 0,
        concentration: spell?.concentration ?? false,
        ...(summary ? { summary } : {}),
      };
    },
  };
}

export type SheetNames = ReturnType<typeof sheetNames>;
