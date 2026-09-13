import { Component, computed, inject, signal } from '@angular/core';
import type { RollResult } from '@hk/engine';
import type { Event } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { ChipComponent } from '@shared/components/chip/chip.component';
import { DIALOG_DATA, DialogRef, DialogService } from '@shared/components/dialog/dialog.service';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CharacterStore } from '@shared/stores/character.store';
import {
  eventFamily,
  EventSentencePipe,
  TIMELINE_FAMILIES,
  type TimelineFamily,
} from './event-sentence.pipe';

/** One rendered timeline row: either a single event (`events.length === 1`, no `txId`) or a
 * tx-group card — every event `CharacterStore.appendTx` wrote under ONE shared `txId`, in the
 * order they were appended. `leadType` (the group's first/earliest event's own `type`) is what
 * both the group's sentence (`EventSentencePipe`, keyed off `events[0]`) and its filter-chip
 * family (`eventFamily`) key off. */
interface TimelineRow {
  readonly key: string;
  readonly events: readonly Event[];
  readonly leadType: string;
  readonly txId?: string;
}

/** Same-content-provider pattern as `characters-list.component.ts`'s own
 * `CharactersDeleteConfirmComponent`: `DialogService.open()` attaches this under a NEW injector
 * rooted at the app's root, not `TimelineTabComponent`'s own `provideTranslocoScope('characters')`
 * — it reads the global (unscoped) `*transloco` lookup instead, safe because the `characters`
 * scope is already loaded by the time this dialog can open (its only caller loaded it first). */
@Component({
  selector: 'app-timeline-revert-confirm',
  imports: [TranslocoDirective, ButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="timeline-revert-confirm__title" data-dialog-title>
        {{ t('characters.timeline.revertConfirm.title') }}
      </h2>
      <p class="timeline-revert-confirm__body">{{ t('characters.timeline.revertConfirm.body') }}</p>
      <div class="timeline-revert-confirm__actions">
        <button
          hk-button
          [variant]="'ghost'"
          type="button"
          class="timeline-revert-confirm__cancel"
          (click)="cancel()"
        >
          {{ t('characters.timeline.revertConfirm.cancel') }}
        </button>
        <button
          hk-button
          [variant]="'danger'"
          type="button"
          class="timeline-revert-confirm__confirm"
          (click)="confirm()"
        >
          {{ t('characters.timeline.revertConfirm.confirm') }}
        </button>
      </div>
    </ng-container>
  `,
})
export class TimelineRevertConfirmComponent {
  protected readonly data = inject<{ count: number }>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);

  protected confirm(): void {
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}

/** Groups the chronological (ascending-seq) `events` into `TimelineRow`s: consecutive events
 * sharing the same defined `txId` collapse into one row (task-12-brief.md — "consecutive events
 * sharing a txId render as ONE collapsible card"); anything else (no `txId`, or a `txId` that
 * doesn't match the row currently being built) starts its own single-event row. `txId`-sharing is
 * checked ONLY against consecutive events — `appendTx` always writes one tx's events as a
 * contiguous run (`character.store.ts`'s own `seq++` loop), so this never needs to look further
 * back than the row currently open. */
function groupEvents(events: readonly Event[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const event of events) {
    const open = rows.at(-1);
    if (open && event.txId !== undefined && event.txId === open.txId) {
      rows[rows.length - 1] = { ...open, events: [...open.events, event] };
    } else {
      rows.push({ key: event.id, events: [event], leadType: event.type, txId: event.txId });
    }
  }
  return rows;
}

/**
 * `/c/:id/timeline` — the sheet's Timeline mode (plan-5 task-12-brief.md): the full event log as
 * localized sentences (`EventSentencePipe`), newest-first, tx-groups collapsed into one card,
 * filterable by family, with a per-row/per-group revert affordance behind a confirm dialog.
 * Replaces T10's heading-only stub.
 *
 * No `hk-virtual-list`: its fixed-`itemSize` strategy (that component's own SKILL.md: "every row
 * is assumed the same height") can't accommodate a tx-group's expand/collapse OR a
 * `decision.made` row's variable-height dice display — a plain `@for` is the brief's documented
 * escape hatch ("cap-free plain list is acceptable for 1b log sizes"); Phase-1b character streams
 * are nowhere near the size where that trade-off matters.
 */
@Component({
  selector: 'app-timeline-tab',
  imports: [TranslocoDirective, CardComponent, ChipComponent, ButtonComponent, EventSentencePipe],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './timeline-tab.component.html',
  styleUrl: './timeline-tab.component.scss',
})
export class TimelineTabComponent {
  private readonly characterStore = inject(CharacterStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly dialogService = inject(DialogService);

  protected readonly index = this.engineFacade.index;
  protected readonly localizer = this.engineFacade.localizer;
  protected readonly skippedIds = this.characterStore.skippedIds;
  protected readonly families = TIMELINE_FAMILIES;

  // task-14: the character's CURRENT grammatical gender, threaded into `EventSentencePipe` so a
  // sentence with no gender field of its own (`level.gained`, `stabilized`, …) can still ICU
  // `select` on it — see `event-sentence.pipe.ts`'s `sentenceOf` doc for why an event's OWN
  // payload gender (when it has one) always wins over this.
  protected readonly grammaticalGender = computed(
    () => this.characterStore.facts()?.grammaticalGender,
  );

  protected readonly rows = computed<TimelineRow[]>(() =>
    groupEvents(this.characterStore.events()).reverse(),
  );

  // All families active by default — chips narrow the view down, they never start it filtered.
  protected readonly activeFamilies = signal<ReadonlySet<TimelineFamily>>(
    new Set(TIMELINE_FAMILIES),
  );
  protected readonly expandedKeys = signal<ReadonlySet<string>>(new Set());

  protected readonly visibleRows = computed<TimelineRow[]>(() => {
    const active = this.activeFamilies();
    return this.rows().filter((row) => active.has(eventFamily(row.leadType)));
  });

  // Methods

  protected familyOf(row: TimelineRow): TimelineFamily {
    return eventFamily(row.leadType);
  }

  // Scope-relative key for a family chip's label, built via a plain function call rather than
  // inline string concatenation in the template — matching `ability-scores-step.component.ts`'s
  // own `diagnosticKey` convention (see task-12-report.md's investigation for why).
  protected familyLabelKey(family: TimelineFamily): string {
    return `timeline.family.${family}`;
  }

  protected isFamilyActive(family: TimelineFamily): boolean {
    return this.activeFamilies().has(family);
  }

  protected toggleFamily(family: TimelineFamily): void {
    this.activeFamilies.update((current) => {
      const next = new Set(current);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  }

  protected isExpanded(row: TimelineRow): boolean {
    return this.expandedKeys().has(row.key);
  }

  protected toggleExpand(row: TimelineRow): void {
    this.expandedKeys.update((current) => {
      const next = new Set(current);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });
  }

  // A group revert targets the whole `txId` in one `event.reverted`, so every member event is
  // skipped simultaneously — checking `every()` here means a row reads "reverted" only once the
  // WHOLE group is undone, never partway.
  protected isReverted(row: TimelineRow): boolean {
    const skipped = this.skippedIds();
    return row.events.every((event) => skipped.has(event.id));
  }

  // BINDING (plan-4 ledger — revert-of-revert semantics are UNDEFINED, task-12-brief.md): an
  // `event.reverted` row renders its own sentence like any other event but must NEVER itself
  // offer a revert affordance. An already-reverted row offers none either — there is nothing left
  // to undo a second time.
  //
  // FIX (whole-branch review, finding 1): the standalone `character.created` row must ALSO never
  // offer a revert affordance. It is never grouped into a tx (`CharacterStore.create` writes it
  // alone, no `txId`), so `leadType` reliably identifies it. Every OTHER handler's very first line
  // is `requireCreated(f)` (`packages/engine/src/reduce/facts.ts`) — it skips the event as
  // 'not-created' whenever `f.created` is falsy. Reverting `character.created` clears `f.created`,
  // so replay would skip EVERY subsequent event (facts collapse, name goes empty) — and
  // revert-of-revert is prohibited above, so there is no UI path back. Never let it be reverted.
  protected canRevert(row: TimelineRow): boolean {
    return (
      row.leadType !== 'event.reverted' &&
      row.leadType !== 'character.created' &&
      !this.isReverted(row)
    );
  }

  // `decision.made`'s `context.rolls` (T7's ability-roll flow — `context: {method, scores,
  // rolls}`) is the only payload shape this tab renders dice for; every other event type (and a
  // `decision.made` with no roll context, e.g. standard array) returns `undefined` and the
  // template simply skips the dice block.
  protected rollsFor(row: TimelineRow): RollResult[] | undefined {
    const lead = row.events[0];
    if (lead.type !== 'decision.made') return undefined;
    const payload = lead.payload as { context?: { rolls?: unknown } } | undefined;
    const rolls = payload?.context?.rolls;
    return Array.isArray(rolls) && rolls.length > 0 ? (rolls as RollResult[]) : undefined;
  }

  protected async onRevert(row: TimelineRow): Promise<void> {
    const handle = this.dialogService.open(TimelineRevertConfirmComponent, {
      data: { count: row.events.length },
    });
    const confirmed = await handle.closed;
    if (confirmed !== true) return;
    const target = row.txId !== undefined ? { txId: row.txId } : { eventId: row.events[0].id };
    await this.characterStore.revert(target);
  }
}
