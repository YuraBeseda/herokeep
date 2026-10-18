import { computed, inject, Injectable, type Signal } from '@angular/core';
import {
  derive,
  planRebase,
  reduce,
  validatePack,
  type ContentIndex,
  type Diagnostic,
  type Facts,
  type Pins,
  type ProposedEvent,
  type SystemRules,
} from '@hk/engine';
import {
  formatIssues,
  makeEntityId,
  parseEntityId,
  parsePack,
  type Entity,
  type EntityType,
  type Pack,
} from '@hk/protocol';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import semver from 'semver';
import { CharacterStore } from '../../stores/character.store';
import { PackStore } from '../../stores/pack.store';
import { EngineFacade } from '../engine/engine.facade';
import { LocaleService } from '../i18n/locale.service';
import { CharactersRepository } from '../storage/characters.repository';
import { EventsRepository } from '../storage/events.repository';
import { SnapshotsRepository } from '../storage/snapshots.repository';
import { HomebrewIdService } from './homebrew-id';
import { slugify, uniqueSlug } from './slug';

export { HOMEBREW_PACK_PREFIX, isHomebrewPackId } from './homebrew-id';
/** The version of the first homebrew save; every later save bumps PATCH. */
export const HOMEBREW_FIRST_VERSION = '0.1.0';
/** Scope-relative i18n key of the pack's name (resolved once, at creation, in the active locale). */
const PACK_NAME_KEY = 'homebrew.pack-name';

export interface HomebrewSaveResult {
  /** The newly installed homebrew pack version. */
  pack: Pack;
  /** Non-error `validatePack` diagnostics of the saved pack (errors refuse the save). */
  diagnostics: Diagnostic[];
  /** Characters whose pin of this device's homebrew pack was advanced silently, in one transaction each. */
  fastForwarded: string[];
  /** Characters pinning this device's homebrew pack that were NOT advanced — the Build tab's Update badge (T5). */
  pending: string[];
  /** The new version IS installed, but checking or advancing some characters failed (plan 15
   * final fix wave B5): the save still succeeded; the editor adds a note. */
  updateCheckFailed: boolean;
}

/**
 * Thrown by `HomebrewService.save`/`remove` when the resulting pack does not parse (`issues`, the
 * `formatIssues` lines) or `validatePack` reports errors (`diagnostics`, errors only). Nothing is
 * stored and the installed pack is unchanged. `code` is the i18n key the UI shows.
 */
export class HomebrewValidationError extends Error {
  readonly code = 'packs.homebrew.save-failed';

  constructor(
    readonly issues: readonly string[],
    readonly diagnostics: readonly Diagnostic[],
  ) {
    super(
      `Homebrew pack is invalid: ${[...issues, ...diagnostics.map((d) => `${d.code}: ${d.message}`)].join('; ')}`,
    );
    this.name = 'HomebrewValidationError';
  }
}

/** One character the fast-forward will advance: its stream and the plan's events. */
interface ReadyCharacter {
  id: string;
  events: ProposedEvent[];
}

const packKey = (pack: Pick<Pack, 'id' | 'version'>): string => `${pack.id}@${pack.version}`;

/** Identity of an unresolved-reference issue on a derived sheet. */
const UNRESOLVED_PREFIX = 'derive.unresolved';
function unresolvedKeys(issues: readonly Diagnostic[]): Set<string> {
  return new Set(
    issues
      .filter((d) => d.code.startsWith(UNRESOLVED_PREFIX))
      .map((d) => `${d.code}|${d.entityId ?? ''}|${d.path ?? ''}|${d.message}`),
  );
}

/**
 * Quick homebrew (plan 15 Task 7, ruling 10): the user's items/spells/feats/species live in ONE
 * ordinary local content pack per DEVICE, `homebrew-<8 hex>` (`HomebrewIdService`, fix round 1) —
 * pack JSON validated by the same schema and validator as any imported pack, installed through
 * `PackStore.installContent`. Only this device's id is ever resolved, edited or cleaned up: another
 * device's homebrew pack (from a `.hero`) is an ordinary installed content pack under its own id.
 * A plain `homebrew` pack left by this branch's pre-fix commits (dev data only, never released)
 * is ignored — no migration.
 *
 * Save / remove (serialized, one at a time):
 * 1. Build the next pack: replace-or-add (or drop) the entity in the latest installed homebrew
 *    version's entities; `version` = that version with PATCH bumped (`0.1.0` for the first save).
 *    `system` (the core's SYSTEM ENTITY slug) and `dependencies` (`^<core version>`) are re-read
 *    from the loaded core on every save, so a core update never strands the pack. `name` is the
 *    active locale's `packs.homebrew.pack-name` at creation, then kept (pack data); `locale` too.
 * 2. `parsePack` the whole pack, then `validatePack(pack, [core, ...other content])`. A failure
 *    throws `HomebrewValidationError` before anything is written.
 * 3. `installContent(pack, no assets)` — the new version row sits beside the previous one.
 * 4. Plan every stored character pinning this device's homebrew id (any version) while the older versions are
 *    still installed (so `current` can see the entities the character uses — see `planFor`). Only
 *    streams holding a `pack.pinned` event for the id are read. From this step on the new version
 *    is installed, so a planning failure never fails the save: the character stays pending and
 *    `updateCheckFailed` is set (older versions are then kept).
 * 5. Commit each ready plan's `events` verbatim as ONE transaction on that character's stream
 *    (`CharacterStore.appendTxToStream`); everything else is `pending` and keeps the Update badge.
 * 6. Remove every OTHER installed homebrew version that no pending character still pins, via
 *    `PackStore.removeContent` (row plus any of its asset blobs no remaining pack lists — homebrew
 *    lists none today). Normally that is just the previous version, so only the latest stays.
 *
 *    Deviation from "keep only the latest version" (stated in the task-7 report): a version a
 *    PENDING character still pins is kept until no character pins it. Removing it would blind the
 *    player's update report — `planRebase` skips decisions that are already invalid under
 *    `current`, and with the old version gone every decision on a homebrew entity would look
 *    already invalid, so a deleted species/feat would never be listed — and would also raise the
 *    missing-pack banner. A later save reclaims it once the player has updated.
 */
@Injectable({ providedIn: 'root' })
export class HomebrewService {
  private readonly packStore = inject(PackStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly characterStore = inject(CharacterStore);
  private readonly charactersRepository = inject(CharactersRepository);
  private readonly eventsRepository = inject(EventsRepository);
  private readonly snapshotsRepository = inject(SnapshotsRepository);
  private readonly translocoService = inject(TranslocoService);
  private readonly localeService = inject(LocaleService);
  private readonly homebrewIds = inject(HomebrewIdService);

  private queue: Promise<unknown> = Promise.resolve();

  /** This device's homebrew pack id (`null` until settings were read). */
  readonly packId: Signal<string | null> = this.homebrewIds.id;

  /** This device's latest installed homebrew version (highest semver), or `null` before the
   * first save. Never another device's homebrew pack. */
  readonly pack: Signal<Pack | null> = computed(() => {
    const id = this.packId();
    let latest: Pack | null = null;
    for (const pack of this.packStore.installedContent()) {
      if (id === null || pack.id !== id) continue;
      if (!latest || semver.gt(pack.version, latest.version)) latest = pack;
    }
    return latest;
  });

  /** A slug for `name` that is free among this pack's entities of `type` (ruling 10). */
  slugFor(name: string, type: EntityType): string {
    const taken = new Set<string>();
    for (const entity of this.pack()?.entities ?? []) {
      const parsed = parseEntityId(entity.id);
      if (parsed?.type === type) taken.add(parsed.slug);
    }
    return uniqueSlug(slugify(name), taken, type);
  }

  /** Resolves once this device's homebrew pack id is known (`packId()` set). */
  async ready(): Promise<void> {
    await this.homebrewIds.ensure();
  }

  /** `<packId>:<type>/<slugFor(name, type)>` — the id a NEW entity gets. Throws before `ready()`. */
  newEntityId(name: string, type: EntityType): string {
    const packId = this.packId();
    if (packId === null) throw new Error('HomebrewService.newEntityId: pack id not loaded yet');
    return makeEntityId(packId, type, this.slugFor(name, type));
  }

  /** Adds `entity`, or replaces the entity with the same id. See the class doc. */
  save(entity: Entity): Promise<HomebrewSaveResult> {
    return this.serialize(() =>
      this.commit((entities) => {
        const at = entities.findIndex((e) => e.id === entity.id);
        if (at < 0) return [...entities, entity];
        return entities.map((e, i) => (i === at ? entity : e));
      }),
    );
  }

  /** Drops the entity `entityId` (throws when the pack does not hold it). See the class doc. */
  remove(entityId: string): Promise<HomebrewSaveResult> {
    return this.serialize(() =>
      this.commit((entities) => {
        if (!entities.some((e) => e.id === entityId)) {
          throw new Error(`HomebrewService.remove: ${entityId} is not in the homebrew pack`);
        }
        return entities.filter((e) => e.id !== entityId);
      }),
    );
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async commit(edit: (entities: Entity[]) => Entity[]): Promise<HomebrewSaveResult> {
    const core = this.packStore.corePack();
    if (!core) throw new Error('HomebrewService: the core pack is not loaded');
    const packId = await this.homebrewIds.ensure();
    const previous = this.pack();
    const entities = edit(previous ? [...previous.entities] : []);

    const candidate = {
      ...(previous ?? (await this.freshPack(packId))),
      version: previous
        ? (semver.inc(previous.version, 'patch') ?? HOMEBREW_FIRST_VERSION)
        : HOMEBREW_FIRST_VERSION,
      system: systemSlugOf(core),
      dependencies: [{ id: core.id, range: `^${core.version}` }],
      entities,
    };
    const parsed = parsePack(candidate);
    if (!parsed.ok) throw new HomebrewValidationError(formatIssues(parsed.issues), []);
    const pack = parsed.pack;
    const others = this.packStore.installedContent().filter((p) => p.id !== packId);
    const diagnostics = validatePack(pack, [core, ...others]);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) throw new HomebrewValidationError([], errors);

    await this.packStore.installContent(pack, new Map());
    // From here on the new version IS installed, so the save is never reported as failed (plan 15
    // final fix wave B5): a planning failure leaves the affected characters pending (the Build
    // tab's Update badge still offers the update) and flags `updateCheckFailed` for the editor's
    // note. Older versions are then kept (nothing is known about who pins them).
    let planned: Awaited<ReturnType<HomebrewService['planFastForward']>>;
    try {
      planned = await this.planFastForward(pack);
    } catch {
      return { pack, diagnostics, fastForwarded: [], pending: [], updateCheckFailed: true };
    }
    const { ready, pending, pinnedBy, failed } = planned;

    const fastForwarded: string[] = [];
    for (const character of ready) {
      try {
        await this.characterStore.appendTxToStream(character.id, character.events);
        fastForwarded.push(character.id);
      } catch {
        pending.push(character.id); // e.g. entered sync mode meanwhile: the badge still offers it
      }
    }

    if (!failed) {
      const stillPinned = new Set(pending.map((id) => pinnedBy.get(id)));
      const stale = this.packStore
        .installedContent()
        .filter(
          (p) => p.id === packId && p.version !== pack.version && !stillPinned.has(p.version),
        );
      try {
        for (const old of stale) await this.packStore.removeContent(packKey(old));
      } catch {
        // Reclaiming old versions is housekeeping: a later save retries it.
      }
    }
    return { pack, diagnostics, fastForwarded, pending, updateCheckFailed: failed };
  }

  /** The first save's pack shell: name in the active locale (pack data from then on). */
  private async freshPack(
    packId: string,
  ): Promise<Omit<Pack, 'version' | 'system' | 'dependencies'>> {
    const name = await firstValueFrom(
      this.translocoService.selectTranslate<string>(PACK_NAME_KEY, {}, 'packs'),
    );
    return {
      format: 1,
      id: packId,
      kind: 'content',
      name,
      authors: [],
      locale: this.localeService.locale(),
      entities: [],
      overrides: [],
      assets: [],
      i18n: {},
    };
  }

  /** Plans every stored character pinning `pack.id`. Only streams holding a `pack.pinned` event
   * for it (`EventsRepository.streamsWithPackPinned`) are read and folded; every other character
   * is skipped unread. A character whose fold or plan throws is `pending` and sets `failed`. */
  private async planFastForward(pack: Pack): Promise<{
    ready: ReadyCharacter[];
    pending: string[];
    pinnedBy: Map<string, string>;
    failed: boolean;
  }> {
    const rules = this.characterStore.systemRules();
    const installed = new Set(this.packStore.packs().map(packKey));
    const ready: ReadyCharacter[] = [];
    const pending: string[] = [];
    let failed = false;
    /** Character id → the homebrew version it pins before this save. */
    const pinnedBy = new Map<string, string>();
    const candidates = await this.eventsRepository.streamsWithPackPinned(pack.id);
    for (const row of await this.charactersRepository.list()) {
      if (!candidates.has(row.id)) continue;
      try {
        const [events, snapshot] = await Promise.all([
          this.eventsRepository.byStream(row.id),
          this.snapshotsRepository.get(row.id),
        ]);
        const facts = reduce(events, snapshot, rules);
        const pinned = facts.pins[pack.id];
        if (pinned === undefined || pinned === pack.version) continue;
        pinnedBy.set(row.id, pinned);
        const planned = this.planFor(facts, pack, installed, rules, row.id);
        if (planned) ready.push({ id: row.id, events: planned });
        else pending.push(row.id);
      } catch {
        failed = true;
        pending.push(row.id);
      }
    }
    return { ready, pending, pinnedBy, failed };
  }

  /**
   * The events that advance `facts`' pin of `pack.id` to `pack.version`, or `undefined` when the update
   * must wait for the player (the Build tab's Update badge and report, Task 5):
   * - the stream is in sync mode (its writes belong to the sync lane — `appendTx` on the loaded
   *   stream — and a campaign edit lock may apply);
   * - the pinned homebrew version is not installed (no faithful `current` index to compare with:
   *   decisions on its entities would all look "already invalid" and slip through);
   * - the next index has ANY error diagnostic (the silent path is strict; the report path only
   *   blocks on errors the update introduces);
   * - `planRebase` finds an invalid decision;
   * - the update would add an unresolved reference (`derive.unresolved*`) — e.g. an inventory item
   *   whose homebrew entity was deleted, which no decision records. Migrations are not applied for
   *   this check: a `deprecated.replacedBy` target always resolves in `next`.
   */
  private planFor(
    facts: Facts,
    pack: Pack,
    installed: ReadonlySet<string>,
    rules: SystemRules | undefined,
    streamId: string,
  ): ProposedEvent[] | undefined {
    if (this.characterStore.isSyncMode(streamId)) return undefined;
    const pinned = facts.pins[pack.id];
    if (!installed.has(`${pack.id}@${pinned}`)) return undefined;
    const nextPins: Pins = { ...facts.pins, [pack.id]: pack.version };
    const next = this.engineFacade.indexFor(nextPins);
    if (next.diagnostics.some((d) => d.severity === 'error')) return undefined;
    const current = this.engineFacade.indexFor(facts.pins);
    const plan = planRebase(facts, current, next, nextPins, rules);
    if (plan.invalid.length > 0) return undefined;
    if (addsUnresolved(facts, current, next, nextPins, rules)) return undefined;
    return plan.events;
  }
}

function systemSlugOf(core: Pack): string | undefined {
  const system = core.entities.find((e) => e.type === 'system');
  return (system ? parseEntityId(system.id)?.slug : undefined) ?? core.system;
}

function addsUnresolved(
  facts: Facts,
  current: ContentIndex,
  next: ContentIndex,
  nextPins: Pins,
  rules: SystemRules | undefined,
): boolean {
  const before = unresolvedKeys(derive(facts, current, rules).issues);
  const after = unresolvedKeys(derive({ ...facts, pins: nextPins }, next, rules).issues);
  for (const key of after) if (!before.has(key)) return true;
  return false;
}
