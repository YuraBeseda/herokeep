import { signal, type Signal } from '@angular/core';
import { derive, reduce, type ContentIndex, type Sheet, type SystemRules } from '@hk/engine';
import type { Event, Pack } from '@hk/protocol';

/**
 * `ForeignCharacterSession` — plan-10 task-9-brief.md: the DM party-sheet drill-in's viewer
 * session. One instance per open drill-in (`characterId`); NOT an Angular service (mirrors
 * `StreamSyncSession`'s own non-DI posture, task-1-brief.md) — the opening component constructs
 * one directly and owns its lifetime (`start()` on open, `close()` on teardown), passing in the
 * narrow ports it actually needs rather than injecting `SyncService`/`PackStore`/`EngineFacade`
 * wholesale.
 *
 * ## Read-only, in-memory only — no Dexie writes (brief's explicit instruction)
 *
 * This is a VIEWER, not a sync target: `char:<id>` events this device receives are folded into
 * `facts`/`sheet` purely in memory (`accumulated`, below) and NEVER written to
 * `EventsRepository` — there is no `CharacterStore`/`CampaignStore`-style storage port here at
 * all. Closing the drill-in (or navigating away) simply drops this session and everything it
 * accumulated; reopening it starts a brand-new full catch-up from scratch. This is a deliberate
 * simplicity trade-off (documented, not an oversight): a DM's own device never becomes a second
 * source of truth for a character it doesn't own, and there is no snapshot/incremental-fold
 * machinery to keep in sync with `@hk/engine`'s own reducer contract.
 *
 * ## Transport
 *
 * `sync.subscribeForeignStream`/`unsubscribeForeignStream` (`SyncService`, plan-10 Task 9) send
 * `subscribe`/`unsubscribe` over the CAMPAIGN socket's own `sendRaw` escape hatch — never a
 * dedicated character-stream session (doc-03's gateway: subscribing over the campaign socket is
 * exactly what lets a DM view a character stream it never opened a session for). Catch-up/live
 * `events` frames for the subscribed stream arrive back through
 * `sync.registerForeignEventsConsumer(campaignId, cb)` (Task 5's own seam) — this session filters
 * that campaign-wide callback down to just its own `stream`.
 *
 * ## Server behavior this session is built against (plan 9, fixed; task-9-brief.md)
 *
 * Subscribe is authorized iff DM && character in roster (or owner of that char); catch-up pages
 * arrive as `events` frames from `(lastSeq ?? 0)+1`, UNFILTERED (char streams carry no
 * visibility-typed events — `EVENT_STREAM_KIND`). An UNAUTHORIZED subscribe gets NO reply at all
 * (silent) — indistinguishable, from this session's own vantage point, from "no live campaign
 * session exists right now to send the subscribe over" (`SyncService.subscribeForeignStream`'s own
 * silent-no-op contract). Both resolve the same way here: a bounded `timeoutMs` with no frame ever
 * arriving flips `status` to `'unauthorized'` — the UI shows an error state instead of hanging on
 * "loading" forever.
 *
 * ## Gap rule and duplicate-id tolerance
 *
 * Catch-up and the server's own notify fan-out (committed char events pushed live to campaign
 * sockets when `partySheets: 'full'`) can legitimately overlap — the SAME event id can arrive
 * twice, in the same or a later frame. Every already-applied id is silently skipped (never
 * re-folded, never treated as a gap) — mirroring the projector contract task-9-brief.md points at
 * (`StreamSyncSession`/`CampaignStore`'s own "an echo of an already-committed row is a benign
 * duplicate" posture). A genuinely fresh (never-before-seen) event whose `seq` isn't exactly
 * `lastKnownSeq + 1` is a gap: the REST of that frame is discarded (never applied out of order) and
 * this session re-subscribes from its own last known-good seq, per doc-03's gap rule — the server's
 * next catch-up starts the count over from there.
 *
 * ## Pack mismatch (task-9-brief.md's explicit instruction — no crash)
 *
 * `derive()` needs the SAME content pack the character's own `character.created` event pinned
 * (`Facts.pins`). Campaign characters use the same `corePack` as this device's own in v1, so a
 * mismatch is expected to be rare — but this session checks it explicitly (`facts.pins[core.id]`
 * against `packStore.corePack()`) before ever calling `derive()`, and lands on `status: 'error'`
 * (never a thrown exception bubbling out of a `registerForeignEventsConsumer` callback) whenever it
 * doesn't match, or `packStore.corePack()` isn't loaded at all.
 */

export type ForeignCharacterStatus = 'loading' | 'ready' | 'unauthorized' | 'error';

/** The narrow slice of `SyncService` this session actually calls. A real `SyncService` satisfies
 * this structurally — the opening component passes it in directly, no adapter needed. */
export interface ForeignCharacterSyncPort {
  registerForeignEventsConsumer(
    campaignId: string,
    cb: (stream: string, events: Event[]) => void,
  ): () => void;
  subscribeForeignStream(campaignId: string, stream: string, lastSeq?: number): void;
  unsubscribeForeignStream(campaignId: string, stream: string): void;
}

/** The narrow slice of `PackStore` this session reads — just the loaded core pack, to check the
 * pins match (see class doc's "Pack mismatch" section). */
export interface ForeignCharacterPackPort {
  corePack(): Pack | undefined;
}

/** The narrow slice of `EngineFacade` this session reads — the content index `derive()` needs. */
export interface ForeignCharacterEnginePort {
  index(): ContentIndex;
}

export interface ForeignCharacterSessionOptions {
  /** The bare campaign uuid (no `camp:` prefix) — same convention `CampaignStore.campaignId`/route
   * params use. */
  campaignId: string;
  /** The bare character uuid (no `char:` prefix) — this session builds the full `char:<uuid>`
   * stream id itself. */
  characterId: string;
  sync: ForeignCharacterSyncPort;
  packStore: ForeignCharacterPackPort;
  engineFacade: ForeignCharacterEnginePort;
  /** How long to wait for the FIRST `events` frame before giving up as `'unauthorized'` — see class
   * doc. Defaults to 8s; specs override with a small real duration (never `vi.useFakeTimers()` —
   * this codebase's established fake-indexeddb/microtask-scheduling caveat, `campaign.store.ts`'s
   * own `CAMPAIGN_GATEWAY_ACK_TIMEOUT_MS` doc). */
  timeoutMs?: number;
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

const DEFAULT_TIMEOUT_MS = 8_000;

export class ForeignCharacterSession {
  private readonly campaignId: string;
  private readonly streamId: string;
  private readonly sync: ForeignCharacterSyncPort;
  private readonly packStore: ForeignCharacterPackPort;
  private readonly engineFacade: ForeignCharacterEnginePort;
  private readonly timeoutMs: number;
  private readonly setTimeoutFn: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (handle: ReturnType<typeof setTimeout>) => void;

  private unregister: (() => void) | undefined;
  private timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  // Every event id ever successfully folded in, so an overlapping catch-up/notify redelivery is
  // recognized as a benign duplicate rather than a gap (class doc).
  private readonly appliedIds = new Set<string>();
  private accumulated: Event[] = [];
  private lastKnownSeq = 0;
  private started = false;
  private stopped = false;

  private readonly statusState = signal<ForeignCharacterStatus>('loading');
  private readonly sheetState = signal<Sheet | undefined>(undefined);

  readonly status: Signal<ForeignCharacterStatus> = this.statusState.asReadonly();
  readonly sheet: Signal<Sheet | undefined> = this.sheetState.asReadonly();

  constructor(options: ForeignCharacterSessionOptions) {
    this.campaignId = options.campaignId;
    this.streamId = `char:${options.characterId}`;
    this.sync = options.sync;
    this.packStore = options.packStore;
    this.engineFacade = options.engineFacade;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  /** Registers this session's foreign-events consumer and sends the initial `subscribe` (no
   * `lastSeq` — a full catch-up from the beginning). Idempotent — a second call is a no-op. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.unregister = this.sync.registerForeignEventsConsumer(this.campaignId, (stream, events) => {
      if (stream !== this.streamId) return;
      this.handleFrame(events);
    });
    this.armTimeout();
    this.sync.subscribeForeignStream(this.campaignId, this.streamId);
  }

  /** Tears this session down: cancels any armed timeout, unregisters from the campaign's
   * foreign-events fan-out, and sends `unsubscribe` (only if `start()` ever actually ran — never
   * sent for a session that was closed before it started). Idempotent, and safe to call more than
   * once (mirrors `StreamSyncSession.stop()`'s own contract) — the drill-in dialog's `DestroyRef`
   * teardown AND its own router-navigation-away guard both call this, and either may fire first. */
  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearArmedTimeout();
    this.unregister?.();
    this.unregister = undefined;
    if (this.started) this.sync.unsubscribeForeignStream(this.campaignId, this.streamId);
  }

  private armTimeout(): void {
    this.timeoutHandle = this.setTimeoutFn(() => {
      this.timeoutHandle = undefined;
      // Only regresses a still-'loading' session — once any real frame has landed, this session
      // is proven authorized and this timer is never re-armed (see `handleFrame`).
      if (this.statusState() === 'loading') this.statusState.set('unauthorized');
    }, this.timeoutMs);
  }

  private clearArmedTimeout(): void {
    if (this.timeoutHandle === undefined) return;
    this.clearTimeoutFn(this.timeoutHandle);
    this.timeoutHandle = undefined;
  }

  private handleFrame(events: readonly Event[]): void {
    if (this.stopped) return;
    // Any frame at all — including one that turns out to be entirely duplicates — proves this
    // subscribe was authorized; the timeout only ever exists to catch total silence.
    this.clearArmedTimeout();

    let gapped = false;
    for (const event of events) {
      if (this.appliedIds.has(event.id)) continue; // duplicate-id tolerance (class doc)
      const expected = this.lastKnownSeq + 1;
      if (event.seq !== expected) {
        gapped = true;
        break; // discard the rest of this frame — never apply out of order
      }
      this.appliedIds.add(event.id);
      this.accumulated.push(event);
      this.lastKnownSeq = event.seq;
    }

    if (gapped) {
      // Gap rule: re-subscribe from this session's own last known-good seq. Deliberately does NOT
      // touch `statusState`/`sheetState` — whatever this session already had (possibly still
      // `'loading'`, possibly a good `'ready'` sheet from an earlier frame) is left exactly as is
      // until the re-subscribe's own catch-up lands.
      this.sync.subscribeForeignStream(this.campaignId, this.streamId, this.lastKnownSeq);
      return;
    }

    this.recompute();
  }

  private recompute(): void {
    const index = this.engineFacade.index();
    const rules = this.systemRules(index);
    const facts = reduce(this.accumulated, undefined, rules);

    const core = this.packStore.corePack();
    // Two separate checks (not one combined `||` condition) — class doc's "Pack mismatch" section:
    // no core pack loaded at all is one failure mode, a version mismatch against a LOADED core is
    // another; both land on the same `'error'` outcome, but keeping them as separate `if`s here
    // avoids an unsafe optional-chain rewrite of the combined form (`facts.pins[core?.id] !==
    // core?.version` would wrongly evaluate `undefined !== undefined` -> `false` — i.e. "no
    // mismatch" — for the very case (`core` undefined) this guard exists to catch).
    if (core === undefined) {
      this.sheetState.set(undefined);
      this.statusState.set('error');
      return;
    }
    if (facts.pins[core.id] !== core.version) {
      this.sheetState.set(undefined);
      this.statusState.set('error');
      return;
    }

    try {
      const sheet = derive(facts, index, rules);
      this.sheetState.set(sheet);
      this.statusState.set('ready');
    } catch {
      // Never let a derive-time throw escape this callback (task-9-brief.md: "no crash").
      this.sheetState.set(undefined);
      this.statusState.set('error');
    }
  }

  private systemRules(index: ContentIndex): SystemRules {
    const system = index.system();
    return { restRules: system.restRules, hpRules: system.hpRules };
  }
}
