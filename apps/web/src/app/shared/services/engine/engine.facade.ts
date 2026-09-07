import { computed, inject, Injectable } from '@angular/core';
import { createContentIndex, createLocalizer, createSearchIndex } from '@hk/engine';
import type { Entity } from '@hk/protocol';
// Imported via the `@hk/content/icons` tsconfig path (straight at the tracked JSON file, with
// `resolveJsonModule` enabled in tsconfig.app.json) rather than through `@hk/content`'s barrel:
// the barrel re-exports `buildPack`/`writePack` from a Node-only, build-time module graph
// (`node:fs`, `import.meta.url`-based fixture paths) that has no business in a browser bundle.
import iconsMapJson from '@hk/content/icons';
import { LocaleService } from '../i18n/locale.service';
import { PackStore } from '../../stores/pack.store';

interface IconsMap {
  categories: Record<string, string>;
  entities: Record<string, string>;
}

const iconsMap = iconsMapJson as IconsMap;
const GI_PREFIX = 'gi:';

/** `item` category → icons-map `categories` key (weapon splits melee/ranged by `entity.weapon.kind`). */
function itemCategoryKey(entity: Extract<Entity, { type: 'item' }>): string {
  switch (entity.category) {
    case 'weapon':
      return entity.weapon?.kind === 'ranged' ? 'item:weapon-ranged' : 'item:weapon-melee';
    case 'armor':
      return 'item:armor';
    case 'shield':
      return 'item:shield';
    case 'magic':
      return 'item:magic';
    case 'gear':
    case 'tool':
    case 'consumable':
      return 'item:gear';
  }
}

/** Entity → icons-map `categories` key, for the entity types that have a category fallback. */
function categoryKey(entity: Entity): string | undefined {
  switch (entity.type) {
    case 'spell':
      return `spell-school:${entity.school}`;
    case 'item':
      return itemCategoryKey(entity);
    case 'condition':
      return 'condition';
    case 'rule':
      return 'rule';
    default:
      return undefined;
  }
}

/**
 * The read-only engine surface built from `PackStore`'s packs: content index, localizer, and
 * search, all as pure `computed`s (no I/O here — that lives in `PackStore.init`/`importTranslation`).
 * `index`/`localizer`/`search` reflect whatever packs are currently loaded; while
 * `packStore.ready()` is still `false` (before the app's `provideAppInitializer` completes)
 * `packStore.packs()` is `[]` and these resolve to an empty, harmless index — callers that want
 * to distinguish "no packs yet" from "packs loaded, nothing found" should check `ready()`.
 */
@Injectable({ providedIn: 'root' })
export class EngineFacade {
  private readonly packStore = inject(PackStore);
  private readonly localeService = inject(LocaleService);

  // Properties
  readonly index = computed(() => createContentIndex(this.packStore.packs()));
  readonly localizer = computed(() => createLocalizer(this.index(), this.localeService.locale()));
  readonly search = computed(() => createSearchIndex(this.index(), this.localizer()));

  // Methods
  // Resolution order: the entity's own `gi:`-prefixed icon, then the icons-map `entities`
  // lookup by id, then a category fallback, then the map's own `fallback` entry.
  iconFor(entity: Entity): string {
    if (entity.icon?.startsWith(GI_PREFIX)) return entity.icon;
    const mapped = iconsMap.entities[entity.id];
    if (mapped) return mapped;
    const key = categoryKey(entity);
    const byCategory = key ? iconsMap.categories[key] : undefined;
    return byCategory ?? iconsMap.categories['fallback'];
  }
}
