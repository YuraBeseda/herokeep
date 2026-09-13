import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import {
  derive,
  ENGINE_VERSION,
  outstandingChoices,
  pendingAdvancements,
  reduce,
  type Advancement,
  type ChoiceRequest,
  type Facts,
  type ProposedEvent,
  type Sheet,
  type Snapshot,
  type SystemRules,
} from '@hk/engine';
import {
  parseEvent,
  type CharacterCreated,
  type Event,
  type EventReverted,
  type GrammaticalGender,
} from '@hk/protocol';
import { uuidv7 } from '../helpers/uuid';
import { EngineFacade } from '../services/engine/engine.facade';
import { StoragePersistService } from '../services/pwa/storage-persist.service';
import { CharactersRepository } from '../services/storage/characters.repository';
import { EventsRepository } from '../services/storage/events.repository';
import { LeaderService } from '../services/storage/leader.service';
import { SettingsRepository } from '../services/storage/settings.repository';
import { SnapshotsRepository } from '../services/storage/snapshots.repository';
import { PackStore } from './pack.store';

/** An envelope-less draft for events `propose.*` doesn't cover — wizards/UI hand-assemble these
 * directly (`decision.made`, `level.gained`, `spell.learned`, …). Structurally identical to the
 * engine's own `ProposedEvent` (`v` merely widened from the literal `1` to `number`), so
 * `appendTx` can envelope either shape uniformly. */
export interface DraftEvent {
  type: string;
  v: number;
  payload: unknown;
}

/**
 * Thrown by every `CharacterStore` method that appends (`create`/`appendTx`/`revert`) when this
 * tab is not the elected writer (`LeaderService.isLeader`) — controller ruling R-pf1: the store
 * is the app's only writer, so a non-leader tab must never append. `code` is the i18n key the UI
 * toasts (wired in plan-5 Task 3).
 */
export class CharacterStoreNotLeaderError extends Error {
  readonly code = 'characters.not-leader';

  constructor() {
    super('This tab is not the active character-data writer; another tab holds the lock.');
    this.name = 'CharacterStoreNotLeaderError';
  }
}

const SNAPSHOT_EVERY = 100;

/**
 * The event replica every builder/sheet UI task (plan-5, tasks 3-13) reads and writes through.
 * One `CharacterStore` instance holds at most one character stream at a time; `load`/`create`
 * (re)point it at a stream, `appendTx`/`revert` are the only ways to grow its event log.
 *
 * Leadership (controller ruling R-pf1, task-2-brief.md): the constructor calls
 * `LeaderService.acquire()` fire-and-forget — this store is the app's only writer, so nothing
 * else contends for the lock from this tab. Every appending method guards on
 * `LeaderService.isLeader()` first and throws `CharacterStoreNotLeaderError` when it is not (a
 * second tab open on the same profile, still queued behind the first).
 *
 * Snapshot policy: `appendTx`/`revert` keep an in-memory `lastSnapshotSeq` (the seq of the most
 * recently written or resumed-from snapshot, 0 when none); once `facts.lastSeq - lastSnapshotSeq`
 * exceeds `SNAPSHOT_EVERY`, the freshly reduced facts are persisted via `SnapshotsRepository.put`
 * so `load()` never has to replay a whole long-lived character's history from scratch.
 *
 * Revert seam (`SnapshotsRepository`'s class doc, `reducer.ts`'s `preScanReverted`): `revert`
 * always deletes the stream's cached snapshot before recomputing, then does a FULL replay from
 * `EventsRepository.byStream` — never an incremental reduce on top of the (now invalid) snapshot
 * — because a snapshot taken before the revert could otherwise hide a target that was folded into
 * it. `appendTx`'s incremental reduce is only ever safe because it never itself appends a revert
 * — enforced at runtime: `appendTx` refuses any draft of type `event.reverted`.
 *
 * Concurrency: `load`/`create`/`appendTx`/`revert` all funnel their actual work through one
 * `enqueue`d promise chain, so two calls fired without awaiting the first (a double-fired UI
 * action) can never interleave their `nextSeq` reads and signal writes — see `enqueue`'s doc.
 *
 * Canonical hit-dice flow (carried for plan 6's play UI — do NOT let a future task double-spend
 * dice): a short rest's healing loop calls `propose.spendHitDie` once per die the player actually
 * rolls — that single call both marks the die spent AND heals, in one `hit_dice.spent` event.
 * `rest.taken`'s own optional `hitDiceSpent` field is bulk bookkeeping ONLY (importing a
 * character, a DM adjustment) — it records dice as spent but never heals. Passing both for the
 * same dice during a normal rest double-spends them; plan 6's rest UI must use
 * `propose.spendHitDie` per die and leave `rest.taken.hitDiceSpent` unset for the ordinary case.
 */
@Injectable({ providedIn: 'root' })
export class CharacterStore {
  private readonly eventsRepository = inject(EventsRepository);
  private readonly snapshotsRepository = inject(SnapshotsRepository);
  private readonly charactersRepository = inject(CharactersRepository);
  private readonly settingsRepository = inject(SettingsRepository);
  private readonly leaderService = inject(LeaderService);
  private readonly packStore = inject(PackStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly storagePersistService = inject(StoragePersistService);

  private readonly streamIdState = signal<string | undefined>(undefined);
  private readonly loadedState = signal(false);
  private readonly factsState = signal<Facts | undefined>(undefined);
  private readonly eventsState = signal<Event[]>([]);

  // Seq of the most recently written/resumed snapshot; 0 means "no snapshot yet" (see class doc).
  private lastSnapshotSeq = 0;
  private deviceIdPromise: Promise<string> | undefined;
  private persistRequested = false;

  // Serializes every mutating call's actual read/reduce/write work (see `enqueue`'s doc).
  private queue: Promise<void> = Promise.resolve();

  readonly streamId: Signal<string | undefined> = this.streamIdState.asReadonly();
  readonly loaded: Signal<boolean> = this.loadedState.asReadonly();
  readonly facts: Signal<Facts | undefined> = this.factsState.asReadonly();
  readonly events: Signal<Event[]> = this.eventsState.asReadonly();

  /** `undefined` until packs are ready AND a character's facts have been loaded/created. */
  readonly sheet: Signal<Sheet | undefined> = computed(() => {
    const facts = this.factsState();
    if (!facts || !this.packStore.ready()) return undefined;
    return derive(facts, this.engineFacade.index(), this.systemRules());
  });

  readonly outstanding: Signal<ChoiceRequest[]> = computed(() => {
    const facts = this.factsState();
    if (!facts || !this.packStore.ready()) return [];
    return outstandingChoices(facts, this.engineFacade.index());
  });

  readonly advancements: Signal<Advancement[]> = computed(() => {
    const facts = this.factsState();
    const sheet = this.sheet();
    if (!facts || !sheet) return [];
    return pendingAdvancements(sheet, facts, this.engineFacade.index());
  });

  /** Event ids the reducer skipped while folding `events` into `facts` (`facts.skipped`,
   * `reduce/facts.ts`'s `SkippedEvent[]`) — a target event reverted via `revert()` lands here
   * with reason `'reverted'`, which is what `TimelineTabComponent` (plan-5 task-12-brief.md)
   * strikes through. Not filtered by reason: any skip reason (a duplicate id, an unresolvable
   * `hp.changed`, …) means the event contributed nothing to `facts`, which is exactly what a
   * struck-through row communicates regardless of WHY. */
  readonly skippedIds: Signal<ReadonlySet<string>> = computed(() => {
    const facts = this.factsState();
    return new Set(facts?.skipped.map((s) => s.eventId) ?? []);
  });

  constructor() {
    // Fire-and-forget (R-pf1): this store is the app's only writer, so nothing else on this tab
    // waits on leadership — appending methods just check `isLeader()` once they're called.
    void this.leaderService.acquire();
  }

  /** Loads `characterId` (the full `char:<uuid>` stream id) — awaits `PackStore.ready()` first
   * (a route can otherwise call this before app bootstrap's pack fetch finishes, leaving `sheet`
   * stuck undefined with `loaded()` already true), then resumes from its cached snapshot, if any,
   * and replays every committed event on top (`reduce` skips whatever the snapshot already folded
   * in). */
  async load(characterId: string): Promise<void> {
    return this.enqueue(() => this.loadNow(characterId));
  }

  /** Runs `fn` exclusively against this store's OWN mutation queue — the SAME serialized chain
   * `load`/`create`/`appendTx`/`revert` themselves funnel through (see `enqueue`'s own doc). Lets
   * an external, non-`CharacterStore` read-modify-write (fix-round 1, Critical finding:
   * `HeroReaderService.import`'s storage phase — read `CharactersRepository.get` to decide
   * create-vs-merge, write events/blobs/snapshot, upsert the index row) strictly interleave with
   * every store mutation instead of racing it: while `fn` is running, no `load`/`create`/
   * `appendTx`/`revert`/another `runExclusive` call can start, and `fn` itself never starts until
   * every mutation already queued ahead of it has fully settled. Nothing here validates
   * leadership — `fn` decides for itself whether it needs `assertLeader()` (a pure read-only `fn`
   * wouldn't). */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.enqueue(fn);
  }

  /**
   * For a caller ALREADY running inside `runExclusive` (never call this any other time — calling
   * the PUBLIC `load()` from inside a `runExclusive`/`enqueue`d operation would deadlock: `load`
   * re-enters `enqueue`, which chains onto `this.queue` AFTER the very operation it would be
   * called from, so that operation's own `await` could never be satisfied until itself finishes —
   * a genuine circular wait, not just a lint nitpick). If this store currently has `characterId`
   * loaded, re-runs the SAME full replay `load()` itself does (`loadNow`), directly, with no extra
   * queue hop — so an open sheet reflects storage a `runExclusive`d write just committed. A no-op
   * for any other currently-loaded character, or none loaded at all.
   */
  async reloadIfCurrent(characterId: string): Promise<void> {
    if (this.streamIdState() !== characterId) return;
    await this.loadNow(characterId);
  }

  /** Starts a brand-new character stream with ONE `character.created` event. Returns the new
   * `char:<uuid>` stream id (== this store's `characterId` for a later `load`). */
  async create(name: string, gender: GrammaticalGender): Promise<string> {
    this.assertLeader();
    if (!this.packStore.ready()) throw new Error('CharacterStore.create: packs are not ready yet');
    const core = this.packStore.corePack();
    if (!core) throw new Error('CharacterStore.create: no core pack loaded');

    return this.enqueue(async () => {
      const streamId = `char:${uuidv7()}`;
      const payload: CharacterCreated = {
        name,
        system: core.id,
        corePack: { id: core.id, version: core.version },
        engineVersion: ENGINE_VERSION,
        grammaticalGender: gender,
      };
      const event = await this.buildAndValidate(streamId, 'character.created', 1, payload);

      await this.eventsRepository.append([event]);
      const facts = reduce([event], undefined, this.systemRules());
      await this.charactersRepository.upsertFromFacts(streamId, facts);

      this.streamIdState.set(streamId);
      this.eventsState.set([event]);
      this.factsState.set(facts);
      this.lastSnapshotSeq = 0;
      this.loadedState.set(true);

      if (!this.persistRequested) {
        this.persistRequested = true;
        this.storagePersistService.requestPersist().catch(() => undefined);
      }

      return streamId;
    });
  }

  /** Envelopes and appends `drafts` (a `propose.*` result, or a hand-assembled `DraftEvent[]`)
   * against the currently loaded stream, sharing one `txId` when there is more than one — then
   * incrementally re-derives facts, upserts the library index row, and snapshots per policy.
   * `event.reverted` drafts are refused here — they must go through `revert()`, the only method
   * that also invalidates the stream's cached snapshot. */
  async appendTx(drafts: ProposedEvent[] | DraftEvent[]): Promise<void> {
    this.assertLeader();
    if (drafts.length === 0) return;
    if (drafts.some((d) => d.type === 'event.reverted')) {
      throw new Error(
        'CharacterStore.appendTx: an "event.reverted" draft must go through revert(), not appendTx()',
      );
    }

    return this.enqueue(async () => {
      const streamId = this.requireStream('appendTx');

      const txId = drafts.length > 1 ? uuidv7() : undefined;
      const actor = await this.actor();
      let seq = await this.eventsRepository.nextSeq(streamId);

      const events: Event[] = [];
      for (const draft of drafts) {
        const raw = this.envelope(streamId, seq++, actor, draft.type, draft.v, draft.payload, txId);
        events.push(this.validate(raw, draft.type, draft.v));
      }

      await this.eventsRepository.append(events);
      await this.applyAppended(streamId, events);
    });
  }

  /** Appends an `event.reverted` targeting `target.eventId` or every event sharing `target.txId`,
   * drops the stream's cached snapshot (it may hide the reverted target — see class doc), and
   * fully replays from `EventsRepository.byStream` so `facts`/`sheet` land back where they'd be
   * had the reverted event(s) never happened. */
  async revert(target: { eventId?: string; txId?: string }, reason?: string): Promise<void> {
    this.assertLeader();

    return this.enqueue(async () => {
      const streamId = this.requireStream('revert');
      const actor = await this.actor();
      const seq = await this.eventsRepository.nextSeq(streamId);
      const payload: EventReverted = {
        ...(target.eventId !== undefined ? { targetId: target.eventId } : {}),
        ...(target.txId !== undefined ? { txId: target.txId } : {}),
        ...(reason !== undefined ? { reason } : {}),
      };
      const raw = this.envelope(streamId, seq, actor, 'event.reverted', 1, payload);
      const event = this.validate(raw, 'event.reverted', 1);

      await this.eventsRepository.append([event]);
      await this.snapshotsRepository.remove(streamId);
      this.lastSnapshotSeq = 0;

      const events = await this.eventsRepository.byStream(streamId);
      const facts = reduce(events, undefined, this.systemRules());

      this.eventsState.set(events);
      this.factsState.set(facts);
      await this.charactersRepository.upsertFromFacts(streamId, facts);
    });
  }

  /** Permanently deletes `characterId`'s (the full `char:<uuid>` stream id — the same id
   * `CharactersRepository` rows key on, per `upsertFromFacts`) library-index row, cached
   * snapshot, and every event row of its stream (`EventsRepository.removeStream`) — the
   * character-list delete flow (plan-5 Task 3). Leader-guarded and enqueued like every other
   * mutating method (see class doc). If `characterId` happens to be this store's currently
   * loaded stream, also resets `streamId`/`loaded`/`facts`/`events` back to their unloaded
   * state so a deleted character's data can't linger in `sheet`/`facts`. */
  async deleteCharacter(characterId: string): Promise<void> {
    this.assertLeader();

    return this.enqueue(async () => {
      await Promise.all([
        this.charactersRepository.remove(characterId),
        this.snapshotsRepository.remove(characterId),
        this.eventsRepository.removeStream(characterId),
      ]);

      if (this.streamIdState() === characterId) {
        this.streamIdState.set(undefined);
        this.loadedState.set(false);
        this.factsState.set(undefined);
        this.eventsState.set([]);
        this.lastSnapshotSeq = 0;
      }
    });
  }

  // --- internals -----------------------------------------------------------------------------

  /**
   * Serializes every mutating method's actual work (`load`/`create`/`appendTx`/`revert`) through
   * one promise chain, so two calls fired without awaiting the first (a double-fired UI action,
   * or a wizard step racing a background rest-timer tick) can never interleave their
   * `EventsRepository.nextSeq` reads and `facts`/`events` signal writes — each queued operation's
   * `nextSeq` call now only ever runs after the previous one's `append` has fully committed.
   * Persisted data was already safe either way (`EventsRepository.append` assigns seqs
   * transactionally), but without this the in-memory signals could drift from what actually
   * landed. `this.queue` itself always settles (never rejects): a failed operation's rejection is
   * still returned to ITS OWN caller (`settled`, below), but is swallowed before being folded back
   * into `this.queue`, so one rejected call can never poison every operation queued after it.
   */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const settled = this.queue.then(operation, operation);
    this.queue = settled.then(
      () => undefined,
      () => undefined,
    );
    return settled;
  }

  /** The actual body of `load()` — factored out so `reloadIfCurrent` (called from INSIDE another
   * caller's already-`enqueue`d/`runExclusive`d operation) can run the exact same replay without
   * itself calling back into `enqueue` (see `reloadIfCurrent`'s own doc for why that would
   * deadlock). Public `load()` is just `enqueue(() => this.loadNow(characterId))`. */
  private async loadNow(characterId: string): Promise<void> {
    await this.whenPacksReady();
    const [events, snapshot] = await Promise.all([
      this.eventsRepository.byStream(characterId),
      this.snapshotsRepository.get(characterId),
    ]);
    const facts = reduce(events, snapshot, this.systemRules());

    this.streamIdState.set(characterId);
    this.eventsState.set(events);
    this.factsState.set(facts);
    this.lastSnapshotSeq = snapshot?.seq ?? 0;
    this.loadedState.set(true);
  }

  /**
   * Resolves once `PackStore.ready()` is true. Implemented as a poll rather than `effect()`:
   * this runs inside a plain async method with no guaranteed Angular change-detection tick to
   * flush an effect against, so a framework-agnostic wait is the more reliable primitive here.
   * The common case (packs already ready) resolves immediately with no timer at all; otherwise
   * it only spins for app bootstrap's brief pack-fetch window.
   */
  private whenPacksReady(): Promise<void> {
    if (this.packStore.ready()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const check = (): void => {
        if (this.packStore.ready()) resolve();
        else setTimeout(check, 10);
      };
      setTimeout(check, 10);
    });
  }

  private assertLeader(): void {
    if (!this.leaderService.isLeader()) throw new CharacterStoreNotLeaderError();
  }

  private requireStream(context: string): string {
    const streamId = this.streamIdState();
    if (!streamId) throw new Error(`CharacterStore.${context}: no character loaded`);
    return streamId;
  }

  /** `SystemRules` from the loaded core pack's `system` entity, or `undefined` before packs are
   * ready (mirrors `sheet`/`outstanding`/`advancements`'s own ready gate). */
  private systemRules(): SystemRules | undefined {
    if (!this.packStore.ready()) return undefined;
    const system = this.engineFacade.index().system();
    return { restRules: system.restRules, hpRules: system.hpRules };
  }

  private async deviceId(): Promise<string> {
    this.deviceIdPromise ??= this.settingsRepository.deviceId();
    return this.deviceIdPromise;
  }

  private async actor(): Promise<Event['actor']> {
    return { userId: 'local', deviceId: await this.deviceId(), role: 'owner' };
  }

  // The envelope `ts` regex allows at most 3 fraction digits; `Date#toISOString` already always
  // yields exactly 3, so no truncation is needed here.
  private timestamp(): string {
    return new Date().toISOString();
  }

  private envelope(
    stream: string,
    seq: number,
    actor: Event['actor'],
    type: string,
    v: number,
    payload: unknown,
    txId?: string,
  ): unknown {
    return {
      id: uuidv7(),
      stream,
      seq,
      ts: this.timestamp(),
      actor,
      type,
      v,
      ...(txId !== undefined ? { txId } : {}),
      payload,
    };
  }

  private async buildAndValidate(
    stream: string,
    type: string,
    v: number,
    payload: unknown,
  ): Promise<Event> {
    const seq = await this.eventsRepository.nextSeq(stream);
    const actor = await this.actor();
    const raw = this.envelope(stream, seq, actor, type, v, payload);
    return this.validate(raw, type, v);
  }

  private validate(raw: unknown, type: string, v: number): Event {
    const parsed = parseEvent(raw);
    if (!parsed.ok) {
      const issues = parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
      throw new Error(`CharacterStore: invalid "${type}@${v}" event — ${issues}`);
    }
    return parsed.event;
  }

  /** Incrementally reduces newly-appended `events` on top of the current in-memory facts (safe
   * because `appendTx` never itself appends an `event.reverted` — see class doc), updates the
   * library index row, and writes a snapshot once more than `SNAPSHOT_EVERY` events have
   * accumulated since the last one. */
  private async applyAppended(streamId: string, events: Event[]): Promise<void> {
    const rules = this.systemRules();
    const currentFacts = this.factsState();
    const base: Snapshot | undefined = currentFacts
      ? { seq: currentFacts.lastSeq, facts: currentFacts, engineVersion: ENGINE_VERSION, rules }
      : undefined;
    const facts = reduce(events, base, rules);

    this.factsState.set(facts);
    this.eventsState.update((existing) => [...existing, ...events]);
    await this.charactersRepository.upsertFromFacts(streamId, facts);

    if (facts.lastSeq - this.lastSnapshotSeq > SNAPSHOT_EVERY) {
      await this.snapshotsRepository.put(streamId, {
        seq: facts.lastSeq,
        facts,
        engineVersion: ENGINE_VERSION,
        rules,
      });
      this.lastSnapshotSeq = facts.lastSeq;
    }
  }
}
