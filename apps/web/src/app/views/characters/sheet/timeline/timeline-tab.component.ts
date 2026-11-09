import { Component, computed, inject, signal } from '@angular/core';
import type { RollResult } from '@hk/engine';
import type { Event } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { IconComponent } from '../../../../shared/icons/icon.component';
import { HkButtonComponent } from '../../../../ui/button/button.component';
import { HkFilterChipsComponent } from '../../../../ui/filter-chips/filter-chips.component';
import type { FilterChipOption } from '../../../../ui/filter-chips/filter-chip.component';
import { HkSearchFieldComponent } from '../../../../ui/search-field/search-field.component';
import { HkLeafComponent } from '../../../../ui/leaf/leaf.component';
import { HkTagChipComponent } from '../../../../ui/tag-chip/tag-chip.component';
import { HkToggleComponent } from '../../../../ui/toggle/toggle.component';
import { HkTooltipDirective } from '../../../../ui/tooltip/tooltip.directive';
import { TimelineRevertConfirmComponent } from '../play/revert-dialog.component';
import { revertPreview } from './revert-preview';
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

/** The rows of one calendar day (local time), newest day first. */
interface TimelineDay {
  readonly key: string;
  readonly date: Date;
  readonly rows: TimelineRow[];
}

/** Family -> the glyph that marks a row's kind (a hint and an accessible name come with it). */
const FAMILY_ICONS: Readonly<Record<TimelineFamily, string>> = {
  identity: 'ui:edit',
  decisions: 'ui:build',
  leveling: 'ui:level-up',
  combat: 'ui:attacks',
  items: 'ui:bag',
  other: 'ui:timeline',
};

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

const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

/**
 * `/c/:id/timeline` — the sheet's Timeline mode (board `T01`): the full event log as localized
 * sentences (`EventSentencePipe`), newest-first under a header per day, tx-groups collapsed into a
 * row with a labelled expander, filterable by family (no chip on = everything), reverted rows
 * hideable, and a per-row/per-group Revert behind the DL05 confirm dialog.
 *
 * No `hk-virtual-list`: its fixed-`itemSize` strategy (that component's own SKILL.md: "every row
 * is assumed the same height") can't accommodate a tx-group's expand/collapse OR a
 * `decision.made` row's variable-height dice display — a plain `@for` is the brief's documented
 * escape hatch ("cap-free plain list is acceptable for 1b log sizes"); Phase-1b character streams
 * are nowhere near the size where that trade-off matters.
 */
@Component({
  selector: 'app-timeline-tab',
  imports: [
    TranslocoDirective,
    HkLeafComponent,
    HkFilterChipsComponent,
    HkSearchFieldComponent,
    HkToggleComponent,
    HkTagChipComponent,
    HkButtonComponent,
    HkTooltipDirective,
    IconComponent,
    EventSentencePipe,
  ],
  providers: [provideTranslocoScope('characters'), EventSentencePipe],
  templateUrl: './timeline-tab.component.html',
  styleUrl: './timeline-tab.component.scss',
})
export class TimelineTabComponent {
  private readonly characterStore = inject(CharacterStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly dialogService = inject(DialogService);
  private readonly packStore = inject(PackStore);
  private readonly localeService = inject(LocaleService);
  private readonly sentencePipe = inject(EventSentencePipe);

  protected readonly index = this.engineFacade.index;
  protected readonly localizer = this.engineFacade.localizer;
  protected readonly skippedIds = this.characterStore.skippedIds;
  // Plan 14 Task 6: the current sheet, so `EventSentencePipe` can name non-entity resource ids
  // (`second-wind`, `item:<instanceId>`) instead of printing the raw key.
  protected readonly sheet = this.characterStore.sheet;
  // Plan 15 Task 5: names a pack pin event's pack once the character no longer pins it.
  protected readonly installedPacks = this.packStore.packs;

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

  // Filter chips (board T01): the chips that are ON narrow the list to their families; with none
  // on, every family shows. `hk-filter-chips` owns the on/off state of each chip.
  protected readonly selectedFamilies = signal<readonly string[]>([]);
  protected readonly query = signal('');
  protected readonly showReverted = signal(true);
  protected readonly expandedKeys = signal<ReadonlySet<string>>(new Set());

  // The chips' options, memoized on their labels so `hk-filter-chips` does not see a new array on
  // every change-detection pass.
  private optionsMemo: readonly FilterChipOption[] = [];
  protected familyOptions(t: (key: string) => string): readonly FilterChipOption[] {
    const next = TIMELINE_FAMILIES.map((family) => ({
      id: family,
      label: t(this.familyLabelKey(family)),
      icon: FAMILY_ICONS[family],
    }));
    const same =
      next.length === this.optionsMemo.length &&
      next.every((option, i) => option.label === this.optionsMemo[i]?.label);
    return same ? this.optionsMemo : (this.optionsMemo = next);
  }

  protected readonly visibleRows = computed<TimelineRow[]>(() => {
    const picked = this.selectedFamilies();
    const showReverted = this.showReverted();
    const needle = this.query().trim().toLocaleLowerCase();
    return this.rows().filter(
      (row) =>
        (picked.length === 0 || picked.includes(eventFamily(row.leadType))) &&
        (showReverted || !this.isReverted(row)) &&
        (needle === '' || this.searchText(row).includes(needle)),
    );
  });

  /** The visible rows under one header per local calendar day, newest day first. */
  protected readonly days = computed<TimelineDay[]>(() => {
    const days: TimelineDay[] = [];
    for (const row of this.visibleRows()) {
      const date = new Date(row.events[0].ts);
      const key = dayKey(date);
      const open = days.at(-1);
      if (open?.key === key) open.rows.push(row);
      else days.push({ key, date, rows: [row] });
    }
    return days;
  });

  // Methods

  protected familyOf(row: TimelineRow): TimelineFamily {
    return eventFamily(row.leadType);
  }

  protected iconOf(row: TimelineRow): string {
    return FAMILY_ICONS[this.familyOf(row)];
  }

  // Scope-relative key for a family chip's label, built via a plain function call rather than
  // inline string concatenation in the template — matching `ability-scores-step.component.ts`'s
  // own `diagnosticKey` convention (see task-12-report.md's investigation for why).
  protected familyLabelKey(family: TimelineFamily): string {
    return `timeline.family.${family}`;
  }

  protected isToday(date: Date): boolean {
    return dayKey(date) === dayKey(new Date());
  }

  protected dayLabel(date: Date): string {
    return new Intl.DateTimeFormat(this.localeService.locale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }

  protected timeLabel(row: TimelineRow): string {
    return new Intl.DateTimeFormat(this.localeService.locale(), {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(row.events[0].ts));
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

  /** The creation row shows a lock chip (with the reason as its hint) where Revert would be. */
  protected isCreation(row: TimelineRow): boolean {
    return row.leadType === 'character.created';
  }

  // doc-02 L111: "`override.applied` ... rendered distinctly" — a DM-applied (or solo self-
  // applied, `EVENT_ACTORS['override.applied'] = ['dm','owner']`) manual override changes a Sheet
  // value OUTSIDE the ordinary rule-driven event vocabulary, so the timeline flags it visually
  // (badge, this file's own SCSS) in addition to its ordinary sentence (which already renders
  // `{path}`/`{reason}` verbatim via `characters.timeline.override-applied`'s own ICU params —
  // `buildParams`, `event-sentence.pipe.ts`). A tx-group's OWN lead-type check (`row.leadType`,
  // matching `canRevert`'s identical pattern) is enough: `override.applied` is never itself
  // grouped into a mixed-type tx by any producer in this codebase.
  protected isOverride(row: TimelineRow): boolean {
    return row.leadType === 'override.applied';
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

  /** Every sentence of the row (a group's members too), lower-cased, for the search field. */
  private searchText(row: TimelineRow): string {
    return row.events
      .map((event) =>
        this.sentencePipe.transform(
          event,
          this.index(),
          this.localizer(),
          1,
          this.grammaticalGender(),
          this.sheet(),
          this.installedPacks(),
        ),
      )
      .join(' ')
      .toLocaleLowerCase();
  }

  /** The row's own sentence, without the group suffix (for the revert confirm and its label). */
  protected sentenceOf(row: TimelineRow): string {
    return this.sentencePipe.transform(
      row.events[0],
      this.index(),
      this.localizer(),
      1,
      this.grammaticalGender(),
      this.sheet(),
      this.installedPacks(),
    );
  }

  protected async onRevert(row: TimelineRow): Promise<void> {
    const target = row.txId !== undefined ? { txId: row.txId } : { eventId: row.events[0].id };
    const index = this.characterStore.index();
    const changes = index
      ? revertPreview({
          events: this.characterStore.events(),
          target,
          index,
          rules: this.characterStore.systemRules(),
          overrides: this.characterStore.campaignOverrides(),
        })
      : [];
    const handle = this.dialogService.open(TimelineRevertConfirmComponent, {
      data: {
        name: this.sheet()?.name ?? '',
        sentence: this.sentenceOf(row),
        related: row.events.length - 1,
        changes,
      },
    });
    const confirmed = await handle.closed;
    if (confirmed !== true) return;
    await this.characterStore.revert(target);
  }
}
