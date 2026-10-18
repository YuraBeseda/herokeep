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
import { slugify, uniqueSlug } from './slug';

/** The id of the one local, user-authored content pack (plan 15 ruling 10). */
export const HOMEBREW_PACK_ID = 'homebrew';
/** The version of the first homebrew save; every later save bumps PATCH. */
export const HOMEBREW_FIRST_VERSION = '0.1.0';
/** Scope-relative i18n key of the pack's name (resolved once, at creation, in the active locale). */
const PACK_NAME_KEY = 'homebrew.pack-name';

export interface HomebrewSaveResult {
  /** The newly installed homebrew pack version. */
  pack: Pack;
  /** Non-error `validatePack` diagnostics of the saved pack (errors refuse the save). */
  diagnostics: Diagnostic[];
  /** Characters whose `homebrew` pin was advanced silently, in one transaction each. */
  fastForwarded: string[];
  /** Characters pinning `homebrew` that were NOT advanced — the Build tab's Update badge (T5). */
  pending: string[];
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
 * ordinary local content pack, `homebrew` — pack JSON validated by the same schema and validator
 * as any imported pack, installed through `PackStore.installContent`.
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
 * 4. Plan every stored character pinning `homebrew` (any version) while the older versions are
 *    still installed (so `current` can see the entities the character uses — see `planFor`).
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

  private queue: Promise<unknown> = Promise.resolve();

  /** The latest installed homebrew version (highest semver), or `null` before the first save. */
  readonly pack: Signal<Pack | null> = computed(() => {
    let latest: Pack | null = null;
    for (const pack of this.packStore.installedContent()) {
      if (pack.id !== HOMEBREW_PACK_ID) continue;
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

  /** `homebrew:<type>/<slugFor(name, type)>` — the id a NEW entity gets. */
  newEntityId(name: string, type: EntityType): string {
    return makeEntityId(HOMEBREW_PACK_ID, type, this.slugFor(name, type));
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
    const previous = this.pack();
    const entities = edit(previous ? [...previous.entities] : []);

    const candidate = {
      ...(previous ?? (await this.freshPack())),
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
    const others = this.packStore.installedContent().filter((p) => p.id !== HOMEBREW_PACK_ID);
    const diagnostics = validatePack(pack, [core, ...others]);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) throw new HomebrewValidationError([], errors);

    await this.packStore.installContent(pack, new Map());
    const { ready, pending, pinnedBy } = await this.planFastForward(pack);

    const fastForwarded: string[] = [];
    for (const character of ready) {
      try {
        await this.characterStore.appendTxToStream(character.id, character.events);
        fastForwarded.push(character.id);
      } catch {
        pending.push(character.id); // e.g. entered sync mode meanwhile: the badge still offers it
      }
    }

    const stillPinned = new Set(pending.map((id) => pinnedBy.get(id)));
    const stale = this.packStore
      .installedContent()
      .filter(
        (p) =>
          p.id === HOMEBREW_PACK_ID && p.version !== pack.version && !stillPinned.has(p.version),
      );
    for (const old of stale) await this.packStore.removeContent(packKey(old));
    return { pack, diagnostics, fastForwarded, pending };
  }

  /** The first save's pack shell: name in the active locale (pack data from then on). */
  private async freshPack(): Promise<Omit<Pack, 'version' | 'system' | 'dependencies'>> {
    const name = await firstValueFrom(
      this.translocoService.selectTranslate<string>(PACK_NAME_KEY, {}, 'packs'),
    );
    return {
      format: 1,
      id: HOMEBREW_PACK_ID,
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

  private async planFastForward(
    pack: Pack,
  ): Promise<{ ready: ReadyCharacter[]; pending: string[]; pinnedBy: Map<string, string> }> {
    const rules = this.characterStore.systemRules();
    const installed = new Set(this.packStore.packs().map(packKey));
    const ready: ReadyCharacter[] = [];
    const pending: string[] = [];
    /** Character id → the homebrew version it pins before this save. */
    const pinnedBy = new Map<string, string>();
    for (const row of await this.charactersRepository.list()) {
      const [events, snapshot] = await Promise.all([
        this.eventsRepository.byStream(row.id),
        this.snapshotsRepository.get(row.id),
      ]);
      const facts = reduce(events, snapshot, rules);
      const pinned = facts.pins[HOMEBREW_PACK_ID];
      if (pinned === undefined || pinned === pack.version) continue;
      pinnedBy.set(row.id, pinned);
      const planned = this.planFor(facts, pack.version, installed, rules, row.id);
      if (planned) ready.push({ id: row.id, events: planned });
      else pending.push(row.id);
    }
    return { ready, pending, pinnedBy };
  }

  /**
   * The events that advance `facts`' homebrew pin to `version`, or `undefined` when the update
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
    version: string,
    installed: ReadonlySet<string>,
    rules: SystemRules | undefined,
    streamId: string,
  ): ProposedEvent[] | undefined {
    if (this.characterStore.isSyncMode(streamId)) return undefined;
    const pinned = facts.pins[HOMEBREW_PACK_ID];
    if (!installed.has(`${HOMEBREW_PACK_ID}@${pinned}`)) return undefined;
    const nextPins: Pins = { ...facts.pins, [HOMEBREW_PACK_ID]: version };
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
