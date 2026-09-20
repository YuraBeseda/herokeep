import { computed, inject, Injectable, isDevMode, signal, type Signal } from '@angular/core';
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

/**
 * Thrown by `applyServerCommit` when the incoming server-seq'd events (after deduping echoes)
 * don't start at exactly `expectedSeq` (the local committed head + 1), and by `commitPending` when
 * an ack's ids/seqs don't match the pending prefix they claim to commit — in both cases NOTHING is
 * written first. `StreamSyncSession` (T8) catches this and re-`hello`s the stream instead of
 * guessing a repair.
 */
export class SyncGapError extends Error {
  constructor(
    readonly streamId: string,
    readonly expectedSeq: number,
    readonly receivedSeq: number | undefined,
  ) {
    super(
      `SyncGapError: stream ${streamId} expected seq ${expectedSeq}, got ${receivedSeq ?? 'undefined'}`,
    );
    this.name = 'SyncGapError';
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
 *
 * Sync seam (Phase 2 Task 6, design ruling 1): sync STATE lives in `SyncService`, not here — this
 * store only exposes a minimal per-stream MODE flag (`enterSyncMode`/`leaveSyncMode`, an in-memory
 * `Set`) and a small apply surface. Logged-out / non-syncing streams are UNCHANGED: `appendTx`/
 * `revert` still write straight to the committed lane via `EventsRepository.append`, exactly as
 * before this task. Once `enterSyncMode(streamId)` is on for the CURRENTLY LOADED stream (this
 * store only ever has one stream loaded — mode checks are inherently per-loaded-stream), the SAME
 * two methods instead write seq-less PENDING rows (`EventsRepository.appendPending`, a monotonic
 * `pendingOrder`) and fire `onLocalAppend` once the write has committed, so `SyncService` can ship
 * them. `applyServerCommit`/`commitPending`/`dropPending`/`resetStreamFromServer` are the other
 * half — server-driven applies for ANY stream (not necessarily the loaded one): they always
 * persist to storage and keep `CharactersRepository`'s Library-index row current, but only touch
 * this store's live `events`/`facts` signals when the target stream happens to be the loaded one
 * (see `refreshFromStorage`'s own doc). R-pf2 finding: `@hk/engine`'s `reduce` ALREADY orders
 * seq-less (pending) events after every seq'd (committed) one and never lets them advance
 * `facts.lastSeq` (`reducer.ts`'s `orderEvents` + its main loop) — no transient/stamped seq is
 * needed anywhere in this seam; the exact same `applyAppended` helper the committed path always
 * used is reused verbatim for pending appends too.
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

  // Sync seam (Phase 2 Task 6, class doc): streamIds `appendTx`/`revert` currently write as
  // PENDING rather than committed. Deliberately just a flag set, per design ruling 1 — no sync
  // state (sockets, backoff, quotas, …) lives here.
  private readonly syncModeStreams = new Set<string>();
  private readonly localAppendListeners = new Set<(streamId: string, events: Event[]) => void>();

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
   * that also invalidates the stream's cached snapshot.
   *
   * Sync seam (Phase 2 Task 6, class doc): when `enterSyncMode(streamId)` is on for the loaded
   * stream, this writes PENDING rows (`EventsRepository.appendPending`, no `seq`) instead and
   * notifies `onLocalAppend` listeners once that write has committed — every other consequence
   * (incremental `reduce`, the library-index upsert, the snapshot policy) is the SAME
   * `applyAppended` call either way (R-pf2: `reduce` already treats seq-less events correctly, no
   * special-casing needed). Not syncing (the default, and every pre-Task-6 caller/spec) is
   * byte-identical to before this task. */
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

      if (this.syncModeStreams.has(streamId)) {
        const startOrder = await this.eventsRepository.nextPendingOrder(streamId);
        const events: Event[] = drafts.map((draft) => {
          const raw = this.envelope(streamId, actor, draft.type, draft.v, draft.payload, { txId });
          return this.validate(raw, draft.type, draft.v);
        });

        await this.eventsRepository.appendPending(events, startOrder);
        await this.applyAppended(streamId, events);
        this.notifyLocalAppend(streamId, events);
        return;
      }

      let seq = await this.eventsRepository.nextSeq(streamId);
      const events: Event[] = [];
      for (const draft of drafts) {
        const raw = this.envelope(streamId, actor, draft.type, draft.v, draft.payload, {
          seq: seq++,
          txId,
        });
        events.push(this.validate(raw, draft.type, draft.v));
      }

      await this.eventsRepository.append(events);
      await this.applyAppended(streamId, events);
    });
  }

  /** Appends an `event.reverted` targeting `target.eventId` or every event sharing `target.txId`,
   * drops the stream's cached snapshot (it may hide the reverted target — see class doc), and
   * fully replays from `EventsRepository.byStream` so `facts`/`sheet` land back where they'd be
   * had the reverted event(s) never happened.
   *
   * Sync seam (Phase 2 Task 6): the `event.reverted` event ITSELF goes through the same pending-
   * vs-committed fork `appendTx` uses — when `enterSyncMode(streamId)` is on, it is written as a
   * pending row and `onLocalAppend` fires for it (a revert is just an append on the wire, per
   * design ruling 1); otherwise this is the exact same committed write as before this task. */
  async revert(target: { eventId?: string; txId?: string }, reason?: string): Promise<void> {
    this.assertLeader();

    return this.enqueue(async () => {
      const streamId = this.requireStream('revert');
      const actor = await this.actor();
      const payload: EventReverted = {
        ...(target.eventId !== undefined ? { targetId: target.eventId } : {}),
        ...(target.txId !== undefined ? { txId: target.txId } : {}),
        ...(reason !== undefined ? { reason } : {}),
      };

      const syncing = this.syncModeStreams.has(streamId);
      let event: Event;
      if (syncing) {
        const order = await this.eventsRepository.nextPendingOrder(streamId);
        const raw = this.envelope(streamId, actor, 'event.reverted', 1, payload);
        event = this.validate(raw, 'event.reverted', 1);
        await this.eventsRepository.appendPending([event], order);
      } else {
        const seq = await this.eventsRepository.nextSeq(streamId);
        const raw = this.envelope(streamId, actor, 'event.reverted', 1, payload, { seq });
        event = this.validate(raw, 'event.reverted', 1);
        await this.eventsRepository.append([event]);
      }

      await this.snapshotsRepository.remove(streamId);
      this.lastSnapshotSeq = 0;

      const events = await this.eventsRepository.byStream(streamId);
      const facts = reduce(events, undefined, this.systemRules());

      this.eventsState.set(events);
      this.factsState.set(facts);
      await this.charactersRepository.upsertFromFacts(streamId, facts);

      if (syncing) this.notifyLocalAppend(streamId, [event]);
    });
  }

  // --- sync seam (Phase 2 Task 6, class doc) --------------------------------------------------

  /** Turns on the PENDING-write fork of `appendTx`/`revert` for `streamId` — a no-op if already
   * on. Only takes effect once `streamId` is this store's currently loaded stream (it only ever
   * appends to that one), so enabling it ahead of `load()` is harmless. */
  enterSyncMode(streamId: string): void {
    this.syncModeStreams.add(streamId);
  }

  /** Turns the PENDING-write fork back off for `streamId` — a subsequent `appendTx`/`revert`
   * reverts to today's local-committed behavior, byte-identical to logged-out mode. Any pending
   * rows already written for `streamId` are deliberately left exactly as they are (the plan's own
   * logout semantics): they are not flushed, dropped, or otherwise touched here — they simply
   * sync on next login via the same rows and `pendingOrder`. */
  leaveSyncMode(streamId: string): void {
    this.syncModeStreams.delete(streamId);
  }

  /** `SyncService` (T8) subscribes here to ship every pending batch a syncing stream's `appendTx`/
   * `revert` produces. Fires once, AFTER those events are durably written and this store's own
   * signals updated — never before, so a listener that turns around and reads storage on the same
   * tick sees them. Returns an unsubscribe function. */
  onLocalAppend(cb: (streamId: string, events: Event[]) => void): () => void {
    this.localAppendListeners.add(cb);
    return () => this.localAppendListeners.delete(cb);
  }

  /**
   * Applies events that already carry SERVER-assigned seqs (`StreamSyncSession`'s `events` frame,
   * T8) — the counterpart to `commitPending` for content this device never produced locally.
   * Dedupes by id first (an echo of something this device already has, committed OR still
   * pending, is silently skipped — never rewritten), THEN verifies the surviving fresh events are
   * strictly contiguous starting at the local committed head + 1; any gap throws `SyncGapError`
   * WITHOUT writing anything, so `StreamSyncSession` can re-`hello` instead of guessing. On
   * success the fresh events are written at THEIR OWN seqs (`EventsRepository.appendCommittedAt`
   * — unlike `append`, it never reassigns one) and folded in exactly like `appendTx`'s own
   * committed path (`applyAppended`) when `streamId` is the currently loaded stream; a background
   * stream (open in no tab right now) still gets its Library index row refreshed
   * (`refreshFromStorage`), just no live signal update.
   */
  async applyServerCommit(streamId: string, events: Event[]): Promise<void> {
    this.assertLeader();
    return this.runExclusive(async () => {
      if (events.length === 0) return;

      const existing = await this.eventsRepository.byStream(streamId);
      const existingIds = new Set(existing.map((e) => e.id));
      const head = existing.reduce(
        (max, e) => (e.seq !== undefined ? Math.max(max, e.seq) : max),
        0,
      );

      const fresh = [...events]
        .filter((e) => !existingIds.has(e.id))
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

      let expected = head + 1;
      for (const e of fresh) {
        if (e.seq !== expected) throw new SyncGapError(streamId, expected, e.seq);
        expected++;
      }
      if (fresh.length === 0) return;

      await this.eventsRepository.appendCommittedAt(fresh);

      if (this.streamIdState() === streamId) {
        await this.applyAppended(streamId, fresh);
      } else {
        await this.refreshFromStorage(streamId);
      }
    });
  }

  /**
   * Transitions the FIRST `ackResults.length` pending rows of `streamId` (in `pendingOrder`) to
   * committed at their server-assigned seqs — `StreamSyncSession`'s `ack` frame, T8. A PARTIAL ack
   * (the server has only processed a prefix of what this device sent) is the normal case, not an
   * edge case: `ackResults` names exactly the prefix being committed now; any pending rows after
   * it are left pending for a later ack. Verifies, before writing anything: (1) each
   * `ackResults[i].id` matches the i-th pending row's id (the ack must name a genuine prefix, in
   * order); (2) `ackResults[*].seq` are themselves contiguous; (3) the first assigned seq is
   * exactly the local committed head + 1. Any violation throws `SyncGapError` and commits nothing,
   * so `StreamSyncSession` can re-`hello` instead of trusting a desynced ack. Design ruling 2: a
   * steady-state ack at the expected seq keeps the stream's cached snapshot (no `remove` call
   * here, unlike `dropPending`/`resetStreamFromServer`) — `refreshFromStorage` resumes from it.
   * The events' CONTENT and relative order are unchanged (only their `seq` field gains a value),
   * so the domain facts they produce (name, hp, inventory, …) are unchanged too — only
   * seq-tracking bookkeeping (`facts.lastSeq`) legitimately advances.
   */
  async commitPending(streamId: string, ackResults: { id: string; seq: number }[]): Promise<void> {
    this.assertLeader();
    return this.runExclusive(async () => {
      if (ackResults.length === 0) return;

      const rows = await this.eventsRepository.byStream(streamId);
      const pending = rows.filter((e) => e.seq === undefined);
      const head = rows.reduce((max, e) => (e.seq !== undefined ? Math.max(max, e.seq) : max), 0);

      for (const [i, ack] of ackResults.entries()) {
        if (pending[i]?.id !== ack.id) throw new SyncGapError(streamId, head + 1 + i, ack.seq);
      }
      const startSeq = ackResults[0].seq;
      for (const [i, ack] of ackResults.entries()) {
        if (ack.seq !== startSeq + i) throw new SyncGapError(streamId, startSeq + i, ack.seq);
      }
      if (startSeq !== head + 1) throw new SyncGapError(streamId, head + 1, startSeq);

      await this.eventsRepository.assignSeqs(
        streamId,
        ackResults[0].id,
        startSeq,
        ackResults.length,
      );
      await this.refreshFromStorage(streamId);
    });
  }

  /**
   * A `reject` frame (T8) names pending events the server refused (`forbidden`, a poisoned
   * payload, quota, …). Deletes exactly those rows — only among rows STILL pending, so a row
   * acked in the same race is left alone, never dropped (`EventsRepository.removePending`'s own
   * guard) — then, design ruling 2, drops the stream's cached snapshot and fully replays from
   * `EventsRepository.byStream` so `facts`/`sheet` land where they'd be had the dropped event(s)
   * never happened, the same contract `revert()` already keeps.
   */
  async dropPending(streamId: string, ids: string[]): Promise<void> {
    this.assertLeader();
    return this.runExclusive(async () => {
      if (ids.length === 0) return;
      await this.eventsRepository.removePending(streamId, ids);
      await this.snapshotsRepository.remove(streamId);
      if (this.streamIdState() === streamId) this.lastSnapshotSeq = 0;
      await this.refreshFromStorage(streamId);
    });
  }

  /**
   * Restore-on-new-device (T8): overwrites `streamId`'s ENTIRE local history with the server's,
   * verbatim (`EventsRepository.replaceStream`), then — ruling 2, same contract as
   * `dropPending`/`revert()` — drops the cached snapshot and fully replays. Also covers the
   * (should-be-rare) seq-rewrite case the mode-transition upload flow's contract tolerates.
   */
  async resetStreamFromServer(streamId: string, events: Event[]): Promise<void> {
    this.assertLeader();
    return this.runExclusive(async () => {
      await this.eventsRepository.replaceStream(streamId, events);
      await this.snapshotsRepository.remove(streamId);
      if (this.streamIdState() === streamId) this.lastSnapshotSeq = 0;
      await this.refreshFromStorage(streamId);
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
      this.syncModeStreams.delete(characterId);
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
   * deadlock). Public `load()` is just `enqueue(() => this.loadNow(characterId))`.
   *
   * Dev-only perf log (plan-6 Task 13, Global Constraints' perf-acceptance bullet): in
   * `isDevMode()` builds only (stripped from production — never runs there), times the replay
   * (`reduce`) plus one explicit `derive` call — the same work `sheet`'s computed would otherwise
   * lazily do on first read — and logs `[perf] reduce+derive <ms>` so the manual device checklist
   * (`docs/manual-device-checklist.md`) has an on-device number source. Both `load()` and
   * `reloadIfCurrent()` funnel through this one method, so every load path reports. */
  private async loadNow(characterId: string): Promise<void> {
    await this.whenPacksReady();
    const [events, snapshot] = await Promise.all([
      this.eventsRepository.byStream(characterId),
      this.snapshotsRepository.get(characterId),
    ]);

    const devMode = isDevMode();
    const rules = this.systemRules();
    const start = devMode ? performance.now() : 0;
    const facts = reduce(events, snapshot, rules);
    if (devMode) derive(facts, this.engineFacade.index(), rules);

    this.streamIdState.set(characterId);
    this.eventsState.set(events);
    this.factsState.set(facts);
    this.lastSnapshotSeq = snapshot?.seq ?? 0;
    this.loadedState.set(true);

    if (devMode) console.info('[perf] reduce+derive', performance.now() - start);
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

  /** `seq` omitted (or `undefined`) envelopes a PENDING event — the `EventEnvelopeSchema`'s `seq`
   * is itself optional (`packages/protocol/src/events/envelope.ts`), so this is a valid `Event`
   * either way; the caller decides which repository writer (`append`/`appendCommittedAt` vs
   * `appendPending`) actually persists it. */
  private envelope(
    stream: string,
    actor: Event['actor'],
    type: string,
    v: number,
    payload: unknown,
    opts: { seq?: number; txId?: string } = {},
  ): unknown {
    return {
      id: uuidv7(),
      stream,
      ...(opts.seq !== undefined ? { seq: opts.seq } : {}),
      ts: this.timestamp(),
      actor,
      type,
      v,
      ...(opts.txId !== undefined ? { txId: opts.txId } : {}),
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
    const raw = this.envelope(stream, actor, type, v, payload, { seq });
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
   * accumulated since the last one. Reused VERBATIM for both lanes of the sync seam (Phase 2 Task
   * 6): `appendTx`'s pending branch (`events` seq-less) and `applyServerCommit`'s success path
   * (`events` freshly committed at their own server seqs) — `reduce` already orders/handles
   * seq-less events correctly (R-pf2, class doc), so this needs no special-casing either way.
   * Callers own writing `events` to storage FIRST — this only updates in-memory state + indexes. */
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

  private notifyLocalAppend(streamId: string, events: Event[]): void {
    for (const cb of this.localAppendListeners) cb(streamId, events);
  }

  /**
   * Recomputes `streamId`'s facts from storage (its cached snapshot, if any valid one remains,
   * plus every committed-then-pending event on top — a FULL replay when no snapshot is cached,
   * e.g. right after `dropPending`/`resetStreamFromServer` removed it) and ALWAYS refreshes its
   * `CharactersRepository` Library-index row: that must stay current for every stream this device
   * syncs, not just whichever one happens to be open in this tab. Only touches this store's LIVE
   * signals (`events`/`facts`, `lastSnapshotSeq`, and the `SNAPSHOT_EVERY` policy) when `streamId`
   * is the currently loaded stream — a background stream's storage is updated but this tab's UI
   * (showing a different character, if any) is left alone, the same one-stream-at-a-time
   * discipline `applyAppended`/`loadNow` already keep.
   */
  private async refreshFromStorage(streamId: string): Promise<void> {
    const [events, snapshot] = await Promise.all([
      this.eventsRepository.byStream(streamId),
      this.snapshotsRepository.get(streamId),
    ]);
    const rules = this.systemRules();
    const facts = reduce(events, snapshot, rules);
    await this.charactersRepository.upsertFromFacts(streamId, facts);

    if (this.streamIdState() !== streamId) return;

    this.eventsState.set(events);
    this.factsState.set(facts);
    this.lastSnapshotSeq = snapshot?.seq ?? 0;

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
