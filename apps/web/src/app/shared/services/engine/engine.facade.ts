import {
  computed,
  inject,
  Injectable,
  Injector,
  type Provider,
  type Signal,
  type Type,
} from '@angular/core';
import {
  createContentIndex,
  createLocalizer,
  createSearchIndex,
  pinnedRoots,
  type ContentIndex,
  type Localizer,
  type Pins,
} from '@hk/engine';
import type { Entity, Pack } from '@hk/protocol';
// Imported via the `@hk/content/icons` tsconfig path (straight at the tracked JSON file, with
// `resolveJsonModule` enabled in tsconfig.app.json) rather than through `@hk/content`'s barrel:
// the barrel re-exports `buildPack`/`writePack` from a Node-only, build-time module graph
// (`node:fs`, `import.meta.url`-based fixture paths) that has no business in a browser bundle.
import iconsMapJson from '@hk/content/icons';
import { DialogService } from '../../components/dialog/dialog.service';
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
 * The pin set a component-scoped `EngineFacade` resolves `index()`/`localizer()` against (plan 15
 * Task 4). Provided next to a component-level `EngineFacade` by `provideEngineScope`: the sheet
 * shell scopes it to the loaded character's `facts.pins`, the create wizard to the draft's core +
 * selected packs. `undefined` pins fall back to the core-only index.
 */
export abstract class EngineScope {
  abstract readonly pins: Signal<Pins | undefined>;
}

/** Most distinct pin sets one session is expected to hold at once; past this the memo restarts. */
const INDEX_MEMO_LIMIT = 32;

interface IndexMemo {
  readonly packs: Pack[];
  readonly byKey: Map<string, ContentIndex>;
  readonly localizers: WeakMap<ContentIndex, Map<string, Localizer>>;
}

/** Canonical memo key: `id@version` sorted by id (code-unit order), comma-joined. */
function pinsKey(pins: Pins): string {
  return Object.keys(pins)
    .sort()
    .map((id) => `${id}@${pins[id]}`)
    .join(',');
}

/**
 * The read-only engine surface built from `PackStore`'s packs: content indexes, localizer, and
 * search, all as pure `computed`s (no I/O here — that lives in `PackStore.init`/`importTranslation`).
 *
 * Plan 15 Task 4 — per-character pack set (doc-04 §Versioning: a character pins exact pack
 * versions). `indexFor(pins)` is `createContentIndex(all installed packs, { pins, roots:
 * pinnedRoots(...) })`: the pinned packs, their dependencies, and the translations of those. An
 * installed content pack is therefore only visible to characters that pin it. Indexes are
 * memoized by the canonical pin key (`pinsKey`); the memo is dropped whenever `packStore.packs()`
 * changes.
 *
 * - The ROOT instance's `index()` is `indexFor({ [core.id]: core.version })` — core plus its
 *   translations — for the library views and everything outside a character.
 * - A component-level instance (`provideEngineScope`) resolves `index()`/`localizer()` against its
 *   `EngineScope` pins instead and delegates `indexFor`/localizers to the root, so the memo is
 *   shared. Everything rendered under the sheet shell or the create wizard therefore names, lists
 *   and validates against the character's own pack set without knowing about pins.
 *
 * SCOPING RULE — scoping follows the ELEMENT injector tree only:
 * - components and directives rendered under a `provideEngineScope` host (routed children
 *   included) see the scoped facade;
 * - dialogs see it because `provideEngineScope` also provides a component-level `DialogService`
 *   whose dialog content injectors are parented to the opener;
 * - ROOT services (`MarkdownService`, `CharacterStore`, …) only ever see this root instance — a
 *   caller working for a character passes its own index/localizer explicitly
 *   (`MarkdownService.render(markdown, localizer)`), or uses `indexFor(pins)` directly.
 *
 * The app ships exactly one core: a pin of the core id at another version resolves against the
 * installed core (as the single global index always did), so such a character still derives. The
 * mismatch is surfaced by `CharacterStore.missingPins` instead.
 *
 * Before `packStore.ready()`, `packStore.packs()` is `[]` and every index is empty and harmless —
 * callers that want to distinguish "no packs yet" from "packs loaded, nothing found" should check
 * `ready()`.
 */
@Injectable({ providedIn: 'root' })
export class EngineFacade {
  private readonly packStore = inject(PackStore);
  private readonly localeService = inject(LocaleService);
  private readonly injector = inject(Injector);
  /** The root instance when this one is component-scoped; `null` for the root itself. */
  private readonly root = inject(EngineFacade, { optional: true, skipSelf: true });
  private scope: EngineScope | null | undefined;

  private readonly memo = computed<IndexMemo>(() => ({
    packs: this.packStore.packs(),
    byKey: new Map(),
    localizers: new WeakMap(),
  }));

  private readonly scopePins = computed<Pins | undefined>(() => this.resolveScope()?.pins());

  // Properties
  readonly index = computed<ContentIndex>(() => this.indexFor(this.scopePins() ?? this.corePins()));
  readonly localizer = computed<Localizer>(() =>
    this.localizerFor(this.index(), this.localeService.locale()),
  );
  readonly search = computed(() => createSearchIndex(this.index(), this.localizer()));

  // Methods

  /** The content index for a character pinned to `pins` (see the class doc). Memoized: the same
   * pins (in any key order) return the same instance until `packStore.packs()` changes; reading it
   * inside a `computed` tracks `packStore.packs()`. Callers that act on the result (a rebase plan)
   * check `diagnostics` first: a pin to an uninstalled pack is reported there, never thrown. */
  indexFor(pins: Pins): ContentIndex {
    if (this.root) return this.root.indexFor(pins);
    const memo = this.memo();
    const effective = this.withInstalledCore(memo.packs, pins);
    const key = pinsKey(effective);
    let index = memo.byKey.get(key);
    if (!index) {
      if (memo.byKey.size >= INDEX_MEMO_LIMIT) memo.byKey.clear();
      index = createContentIndex(memo.packs, {
        pins: effective,
        roots: pinnedRoots(memo.packs, effective),
      });
      memo.byKey.set(key, index);
    }
    return index;
  }

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

  /** One localizer per (index, locale), shared by every scope through the root. */
  private localizerFor(index: ContentIndex, locale: string): Localizer {
    if (this.root) return this.root.localizerFor(index, locale);
    const { localizers } = this.memo();
    let byLocale = localizers.get(index);
    if (!byLocale) {
      byLocale = new Map();
      localizers.set(index, byLocale);
    }
    let localizer = byLocale.get(locale);
    if (!localizer) {
      localizer = createLocalizer(index, locale);
      byLocale.set(locale, localizer);
    }
    return localizer;
  }

  private corePins(): Pins {
    const core = this.packStore.packs().find((p) => p.kind === 'core');
    return core ? { [core.id]: core.version } : {};
  }

  private withInstalledCore(packs: Pack[], pins: Pins): Pins {
    const core = packs.find((p) => p.kind === 'core');
    if (!core || pins[core.id] === core.version) return pins;
    return { ...pins, [core.id]: core.version };
  }

  /** Resolved lazily: the scope is often the very component-level service that injects this
   * facade (`CreateWizardState`), so resolving it at construction would be a DI cycle. */
  private resolveScope(): EngineScope | null {
    if (this.scope === undefined) {
      this.scope = this.root ? this.injector.get(EngineScope, null) : null;
    }
    return this.scope;
  }
}

/**
 * Component-level providers that scope `EngineFacade` to `scope`'s pins (see `EngineScope`), plus
 * a component-level `DialogService`: its `inject(Injector)` is then this component's element
 * injector, so every dialog opened from inside the subtree gets a content injector parented to the
 * OPENER and resolves the scoped facade (the provenance popover, add-item, …) instead of the root.
 */
export function provideEngineScope(scope: Type<EngineScope>): Provider[] {
  return [EngineFacade, { provide: EngineScope, useExisting: scope }, DialogService];
}
