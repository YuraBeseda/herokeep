import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import {
  createLocalizer,
  findChoice,
  type ContentIndex,
  type InvalidDecision,
  type Localizer,
  type RebasePlan,
  type SheetChange,
} from '@hk/engine';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { LocaleService } from '../../services/i18n/locale.service';
import { ButtonComponent } from '../button/button.component';
import { DIALOG_DATA, DialogRef } from '../dialog/dialog.service';

/** What `DialogService.open(RebaseReportDialogComponent, { data })` passes in. */
export interface RebaseReportDialogData {
  readonly plan: RebasePlan;
  /** Already-translated heading, e.g. "Update Sample content v1.0.0 → v1.1.0?". */
  readonly title: string;
  /** The index the plan moves to: names the choices and selections (prompts, entity names). */
  readonly nextIndex?: ContentIndex;
  /** The index the character uses now: names what `nextIndex` no longer has (a removed choice). */
  readonly currentIndex?: ContentIndex;
  /**
   * The core update (plan ruling 6): the previous core is not on this device, so there is no sheet
   * diff to show — only the decisions, validated against the new version.
   */
  readonly validationOnly?: boolean;
}

/** A sheet leaf for display: absent, a scalar shown inline, or an object/array as compact JSON. */
export type ReportValue =
  | { readonly kind: 'none' }
  | { readonly kind: 'inline'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string };

interface ChangeRow {
  readonly path: string;
  readonly before: ReportValue;
  readonly after: ReportValue;
}

interface ChangeGroup {
  readonly key: string;
  readonly rows: readonly ChangeRow[];
}

interface InvalidRow {
  readonly choiceId: string;
  readonly prompt: string;
  readonly names: string;
  readonly reasonKey: string;
}

interface MigrationRow {
  readonly id: string;
  readonly prompt: string;
  readonly from: string;
  readonly to: string;
}

// Static (not concatenated) so the i18n keys check can see them.
const REASON_KEYS: Readonly<Record<InvalidDecision['reason'], string>> = {
  'choice-missing': 'rebase.reason.choice-missing',
  'selection-missing': 'rebase.reason.selection-missing',
  'selection-deprecated': 'rebase.reason.selection-deprecated',
  'prerequisite-failed': 'rebase.reason.prerequisite-failed',
};

const EMPTY_PLAN: RebasePlan = { changes: [], invalid: [], migrations: [], events: [] };

/** `attacks[0].toHit.value` → `attacks`: the sheet key a change is grouped under. */
function topLevelKey(path: string): string {
  const end = path.search(/[.[]/);
  return end === -1 ? path : path.slice(0, end);
}

/** Formats one sheet leaf (`SheetChange.before`/`after`; `undefined` = the leaf does not exist). */
export function reportValue(value: unknown): ReportValue {
  if (value === undefined) return { kind: 'none' };
  if (typeof value === 'string') return { kind: 'inline', text: value };
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { kind: 'inline', text: String(value) };
  }
  return { kind: 'code', text: JSON.stringify(value) };
}

/**
 * Plan 15 Tasks 4–5 — the rebase report: what a `planRebase` result would do to the character
 * before anything is committed (doc-04 §Versioning and rebase; ADR-008 "Update available").
 *
 * - **Changes**, grouped by top-level sheet key (`attacks`, `skills`, `speeds`, …): path, before,
 *   after. Hidden in validation-only mode (the core update; the old core is not on the device), which
 *   shows a note saying so instead.
 * - **Invalidated decisions**: the choice's prompt, the reason, and the cleared selection's names.
 * - **Migrations**: `from → to` for each selection moved to its `deprecated.replacedBy`.
 *
 * Names resolve through the next index, then the current one, else stay raw ids (pack data, shown
 * as data). Commits nothing itself — the caller commits `plan.events` in ONE transaction only when
 * this closes with `true` (Confirm); Cancel and Escape close with `false`, the backdrop with
 * `undefined`. Confirm/Cancel act once: a second click is ignored.
 *
 * Opened through `DialogService` (`data: RebaseReportDialogData`), or embedded directly with the
 * inputs and the `confirmed`/`cancelled` outputs. Inputs win over `DIALOG_DATA`.
 */
@Component({
  selector: 'app-rebase-report-dialog',
  imports: [NgTemplateOutlet, TranslocoDirective, ButtonComponent],
  // Dialog content renders under the opener's injector, so it registers its own scope.
  providers: [provideTranslocoScope('characters')],
  templateUrl: './rebase-report-dialog.component.html',
  styleUrl: './rebase-report-dialog.component.scss',
  host: { '(keydown.escape)': 'onCancel()' },
})
export class RebaseReportDialogComponent {
  private readonly data = inject<RebaseReportDialogData | null>(DIALOG_DATA, { optional: true });
  private readonly dialogRef = inject(DialogRef, { optional: true });
  private readonly localeService = inject(LocaleService);

  // Inputs / Outputs
  readonly plan = input<RebasePlan | undefined>(undefined);
  readonly title = input<string | undefined>(undefined);
  readonly nextIndex = input<ContentIndex | undefined>(undefined);
  readonly currentIndex = input<ContentIndex | undefined>(undefined);
  readonly validationOnly = input<boolean | undefined>(undefined);
  // Not `confirm`/`cancel`: `cancel` is a native DOM event name (`no-output-native`).
  readonly confirmed = output();
  readonly cancelled = output();

  /** Set once Confirm or Cancel ran; both are then ignored. */
  protected readonly settled = signal(false);

  protected readonly report = computed<RebasePlan>(
    () => this.plan() ?? this.data?.plan ?? EMPTY_PLAN,
  );
  protected readonly heading = computed(() => this.title() ?? this.data?.title ?? '');
  protected readonly validation = computed(
    () => this.validationOnly() ?? this.data?.validationOnly ?? false,
  );

  /** Next index first, then the current one: each with its localizer for the active locale. */
  private readonly sources = computed<{ index: ContentIndex; localizer: Localizer }[]>(() => {
    const locale = this.localeService.locale();
    const indexes = [
      this.nextIndex() ?? this.data?.nextIndex,
      this.currentIndex() ?? this.data?.currentIndex,
    ].filter((index): index is ContentIndex => index !== undefined);
    return indexes.map((index) => ({ index, localizer: createLocalizer(index, locale) }));
  });

  protected readonly groups = computed<ChangeGroup[]>(() => {
    if (this.validation()) return [];
    const groups = new Map<string, ChangeRow[]>();
    for (const change of this.report().changes) {
      const key = topLevelKey(change.path);
      groups.set(key, [...(groups.get(key) ?? []), this.changeRow(change)]);
    }
    return [...groups].map(([key, rows]) => ({ key, rows }));
  });

  protected readonly invalidRows = computed<InvalidRow[]>(() =>
    this.report().invalid.map((item) => ({
      choiceId: item.choiceId,
      prompt: this.promptOf(item.choiceId),
      names: item.selection.map((id) => this.nameOf(id)).join(', '),
      reasonKey: REASON_KEYS[item.reason],
    })),
  );

  protected readonly migrationRows = computed<MigrationRow[]>(() =>
    this.report().migrations.map((m) => ({
      id: `${m.choiceId}\u0000${m.from}`,
      prompt: this.promptOf(m.choiceId),
      from: this.nameOf(m.from),
      to: this.nameOf(m.to),
    })),
  );

  protected readonly empty = computed(
    () =>
      this.groups().length === 0 &&
      this.invalidRows().length === 0 &&
      this.migrationRows().length === 0,
  );

  protected onConfirm(): void {
    if (this.settled()) return;
    this.settled.set(true);
    this.confirmed.emit();
    this.dialogRef?.close(true);
  }

  protected onCancel(): void {
    if (this.settled()) return;
    this.settled.set(true);
    this.cancelled.emit();
    this.dialogRef?.close(false);
  }

  private changeRow(change: SheetChange): ChangeRow {
    return {
      path: change.path,
      before: reportValue(change.before),
      after: reportValue(change.after),
    };
  }

  /** An entity's localized name from the first index that has it, else the raw id. */
  private nameOf(id: string): string {
    const source = this.sources().find(({ index }) => index.has(id));
    return source ? source.localizer.name(id) : id;
  }

  /** A choice's localized prompt from the first index that has the choice, else the raw id. */
  private promptOf(choiceId: string): string {
    const source = this.sources().find(({ index }) => findChoice(index, choiceId) !== undefined);
    // An empty prompt (a choice without one) falls back to the id as well.
    const prompt = source?.localizer.choicePrompt(choiceId).text ?? '';
    return prompt.length > 0 ? prompt : choiceId;
  }
}
