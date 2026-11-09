import { Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { HkButtonComponent } from '../../../../ui/button/button.component';
import { DialogRef } from '../../../../ui/dialog/dialog.service';

/**
 * The Build tab's "leave without saving?" confirm: "Keep editing" on the left, the destructive
 * "Discard changes" as an ember button. Closes with `true` (leave) or `false` (stay); Escape and the
 * backdrop close with `undefined`, which the guard treats as staying. Opened through
 * `DialogService` under the root injector, so it reads the global (unscoped) `*transloco` lookup;
 * the `characters` scope is loaded by the time a Build tab can open it.
 */
@Component({
  selector: 'app-build-leave-confirm',
  imports: [TranslocoDirective, HkButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="build-leave-confirm__title" data-dialog-title>
        {{ t('characters.sheet.build.leaveConfirm.title') }}
      </h2>
      <p class="build-leave-confirm__body">{{ t('characters.sheet.build.leaveConfirm.body') }}</p>
      <div class="build-leave-confirm__actions" data-dialog-actions>
        <button
          hk-button
          type="button"
          class="build-leave-confirm__cancel"
          [variant]="'ghost-leather'"
          (click)="close(false)"
        >
          {{ t('characters.sheet.build.leaveConfirm.keep') }}
        </button>
        <button
          hk-button
          type="button"
          class="build-leave-confirm__confirm"
          [variant]="'ember'"
          (click)="close(true)"
        >
          {{ t('characters.sheet.build.leaveConfirm.discard') }}
        </button>
      </div>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: min(100%, 380px);
    }

    .build-leave-confirm__body {
      margin: 0 0 12px;
      color: var(--text-1);
    }
  `,
})
export class BuildLeaveConfirmComponent {
  private readonly dialogRef = inject(DialogRef);

  protected close(leave: boolean): void {
    this.dialogRef.close(leave);
  }
}
