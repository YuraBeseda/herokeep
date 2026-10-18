import { Component, computed, inject, input, output } from '@angular/core';
import type { InvalidDecision, RebasePlan } from '@hk/engine';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '../button/button.component';
import { DIALOG_DATA, DialogRef } from '../dialog/dialog.service';

/** What `DialogService.open(RebaseReportDialogComponent, { data })` passes in. */
export interface RebaseReportDialogData {
  readonly plan: RebasePlan;
  /** Already-translated heading, e.g. "Turn off Sample Content?". */
  readonly title: string;
}

// Static (not concatenated) so the i18n keys check can see them.
const REASON_KEYS: Readonly<Record<InvalidDecision['reason'], string>> = {
  'choice-missing': 'rebase.reason.choice-missing',
  'selection-missing': 'rebase.reason.selection-missing',
  'selection-deprecated': 'rebase.reason.selection-deprecated',
  'prerequisite-failed': 'rebase.reason.prerequisite-failed',
};

/**
 * Plan 15 Task 4 — the MINIMAL rebase report (Task 5 extends it: grouping, migrations, a
 * validation-only mode). Shows what a `planRebase` result would do to the character before
 * anything is committed: the sheet `changes` (path, before, after) and the `invalid` decisions
 * Confirm clears, each with its reason. Commits nothing itself — the caller commits `plan.events`
 * in one transaction only when this closes with `true` (Confirm); Cancel, Escape and the backdrop
 * close with `false`/`undefined`.
 *
 * Opened through `DialogService` (`data: RebaseReportDialogData`), or embedded directly with the
 * `plan`/`title` inputs and the `confirmed`/`cancelled` outputs. Inputs win over `DIALOG_DATA`.
 */
@Component({
  selector: 'app-rebase-report-dialog',
  imports: [TranslocoDirective, ButtonComponent],
  // Dialog content renders under the root injector, so it registers its own scope.
  providers: [provideTranslocoScope('characters')],
  templateUrl: './rebase-report-dialog.component.html',
  styleUrl: './rebase-report-dialog.component.scss',
})
export class RebaseReportDialogComponent {
  private readonly data = inject<RebaseReportDialogData | null>(DIALOG_DATA, { optional: true });
  private readonly dialogRef = inject(DialogRef, { optional: true });

  // Inputs / Outputs
  readonly plan = input<RebasePlan | undefined>(undefined);
  readonly title = input<string | undefined>(undefined);
  // Not `confirm`/`cancel`: `cancel` is a native DOM event name (`no-output-native`).
  readonly confirmed = output();
  readonly cancelled = output();

  protected readonly report = computed<RebasePlan>(
    () =>
      this.plan() ?? this.data?.plan ?? { changes: [], invalid: [], migrations: [], events: [] },
  );
  protected readonly heading = computed(() => this.title() ?? this.data?.title ?? '');
  protected readonly empty = computed(
    () => this.report().changes.length === 0 && this.report().invalid.length === 0,
  );

  protected reasonKey(reason: InvalidDecision['reason']): string {
    return REASON_KEYS[reason];
  }

  /** A sheet leaf as text, or `undefined` for "absent" (the template shows the i18n placeholder). */
  protected display(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
  }

  protected onConfirm(): void {
    this.confirmed.emit();
    this.dialogRef?.close(true);
  }

  protected onCancel(): void {
    this.cancelled.emit();
    this.dialogRef?.close(false);
  }
}
