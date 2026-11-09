import { Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { HkButtonComponent } from '../../../../ui/button/button.component';
import { DIALOG_DATA, DialogRef } from '../../../../ui/dialog/dialog.service';

/** What the revert confirm needs, resolved by the caller (the Timeline row). */
export interface RevertDialogData {
  /** The hero's name. */
  readonly name: string;
  /** The localized sentence of the change being reverted (the group's lead event). */
  readonly sentence: string;
  /** How many OTHER events the same transaction holds (0 for a single event). */
  readonly related: number;
}

/**
 * The Timeline's revert confirm (board DL05): a parchment `hk-dialog` that names the change, says
 * what a revert does (the hero is recomputed as if it never happened; later events stay and replay
 * on top), and a leather strap with "Keep it" on the left and the destructive verb as an ember
 * button. The verb is `characters.timeline.revert`'s own wording, never the generic Cancel's: in
 * Ukrainian "Скасувати" used to label both (audit defect 8).
 *
 * Closes with `true` (revert) or `false` (kept); Escape and the backdrop close with `undefined`,
 * which the caller treats as kept. `DialogService.open()` attaches this under a NEW injector rooted
 * at the app's root, so it reads the global (unscoped) `*transloco` lookup, safe because the
 * `characters` scope is already loaded by the time a Timeline row can open it.
 */
@Component({
  selector: 'app-timeline-revert-confirm',
  imports: [TranslocoDirective, HkButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="timeline-revert-confirm__title" data-dialog-title>
        {{ t('characters.timeline.revertConfirm.title') }}
      </h2>
      <p class="timeline-revert-confirm__body">
        @if (data.related > 0) {
          {{
            t('characters.timeline.revertConfirm.bodyGroup', {
              name: data.name,
              sentence: data.sentence,
              count: data.related,
            })
          }}
        } @else {
          {{
            t('characters.timeline.revertConfirm.body', {
              name: data.name,
              sentence: data.sentence,
            })
          }}
        }
      </p>
      <div class="timeline-revert-confirm__actions" data-dialog-actions>
        <button
          hk-button
          [variant]="'ghost-leather'"
          type="button"
          class="timeline-revert-confirm__cancel"
          (click)="cancel()"
        >
          {{ t('characters.timeline.revertConfirm.cancel') }}
        </button>
        <button
          hk-button
          [variant]="'ember'"
          type="button"
          class="timeline-revert-confirm__confirm"
          (click)="confirm()"
        >
          {{ t('characters.timeline.revertConfirm.confirm') }}
        </button>
      </div>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: min(100%, 380px);
    }

    .timeline-revert-confirm__body {
      margin: 0 0 12px;
      color: var(--text-1);
      overflow-wrap: anywhere;
    }
  `,
})
export class TimelineRevertConfirmComponent {
  protected readonly data = inject<RevertDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);

  protected confirm(): void {
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}
