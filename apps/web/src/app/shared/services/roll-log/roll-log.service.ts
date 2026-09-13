import { effect, inject, Injectable, signal, type Signal } from '@angular/core';
import { uuidv7 } from '../../helpers/uuid';
import { CharacterStore } from '../../stores/character.store';

/** Mirrors `RollResult['dice'][number]` (`packages/engine/src/dice/roll.ts`) — a structural copy,
 * not an import: this service is app-layer session state, never itself calling `roll()`, so it
 * has no reason to depend on `@hk/engine`'s dice module beyond matching its shape. */
export interface RollEntryDie {
  readonly sides: number;
  readonly value: number;
  readonly kept: boolean;
}

/** Design ruling 1's exact shape (`docs/superpowers/plans/2026-09-13-phase-1b-play-and-
 * polish.md`): `labelKey`/`params` are a Transloco key (scope-relative — every producer/consumer
 * of this log resolves it through the SAME `read: 'characters'` scope) plus its ICU params, kept
 * separate from a pre-rendered string so the log re-localizes correctly if the UI locale changes
 * mid-session. `advantage` is set only for a d20 roll actually made under advantage/disadvantage
 * (never for a damage or manual entry). `manual` flags an `addManual` entry. */
export interface RollEntry {
  readonly id: string;
  readonly ts: string;
  readonly labelKey: string;
  readonly params: Record<string, unknown>;
  readonly dice: readonly RollEntryDie[];
  readonly modifier: number;
  readonly total: number;
  readonly advantage?: 'adv' | 'dis';
  readonly manual?: boolean;
}

const MAX_ENTRIES = 50;

/**
 * Design ruling 1 (binding, `docs/superpowers/plans/2026-09-13-phase-1b-play-and-polish.md`): the
 * roll log is SESSION-LOCAL, not evented — doc-02's `roll.logged` lives on the CAMPAIGN stream
 * only, and solo play (1b's entire scope) has no campaign. So this is a plain root-provided
 * signal store, never touching `CharacterStore.appendTx`/`EventsRepository` — entries live only
 * in memory, capped at `MAX_ENTRIES`, newest first, and gone on reload/tab close by design.
 *
 * Cleared whenever `CharacterStore.streamId` changes (a fresh `load`/`create`, OR a genuine
 * switch to a different character) so a previous character's rolls never bleed into the next
 * one's log — implemented as an `effect()` class field, same "I/O boundary, no return value"
 * convention `ThemeService.stampAndPersist` documents. The effect body doesn't compare old vs.
 * new `streamId`; it just unconditionally clears every time it runs, INCLUDING its first run
 * (harmless — the log starts empty anyway).
 */
@Injectable({ providedIn: 'root' })
export class RollLogService {
  private readonly characterStore = inject(CharacterStore);

  private readonly entriesState = signal<readonly RollEntry[]>([]);
  readonly entries: Signal<readonly RollEntry[]> = this.entriesState.asReadonly();

  private readonly clearOnStreamChange = effect(() => {
    this.characterStore.streamId();
    this.entriesState.set([]);
  });

  /** Mints `id`/`ts` here (never supplied by the caller — every producer just hands over the
   * rolled shape) and unshifts, so `entries()` is always newest-first; `slice(0, MAX_ENTRIES)`
   * drops the oldest once the cap is exceeded. */
  add(entry: Omit<RollEntry, 'id' | 'ts'>): void {
    const full: RollEntry = { ...entry, id: uuidv7(), ts: new Date().toISOString() };
    this.entriesState.update((prev) => [full, ...prev].slice(0, MAX_ENTRIES));
  }

  /** The manual-entry row's own affordance (task-7-brief.md): a player-typed total (e.g. from
   * physical dice), flagged `manual: true`, with no `dice` breakdown of its own — `add`'s own
   * `dice: []` renders no dice faces at all through `hk-dice-result`, just the total. */
  addManual(labelKey: string, params: Record<string, unknown>, total: number): void {
    this.add({ labelKey, params, dice: [], modifier: 0, total, manual: true });
  }

  clear(): void {
    this.entriesState.set([]);
  }
}
