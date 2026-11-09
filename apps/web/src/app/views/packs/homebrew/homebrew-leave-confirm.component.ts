import { Component, inject } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { DialogRef } from '@app/ui/dialog/dialog.service';
import { HkButtonComponent } from '../../../ui/button/button.component';

/**
 * The homebrew form's "leave without saving?" confirm: "Keep editing" on the left, the destructive
 * "Discard changes" as an ember button. Closes with `true` (leave) or `false` (stay); Escape and
 * the backdrop close with `undefined`, which the guard treats as staying.
 */
@Component({
  selector: 'app-homebrew-leave-confirm',
  imports: [TranslocoDirective, HkButtonComponent],
  providers: [provideTranslocoScope('packs')],
  template: `
    <ng-container *transloco="let t; read: 'packs'">
      <h2 class="hb-leave-confirm__title" data-dialog-title>{{ t('homebrew.leave.title') }}</h2>
      <p class="hb-leave-confirm__body">{{ t('homebrew.leave.body') }}</p>
      <div class="hb-leave-confirm__actions" data-dialog-actions>
        <button
          hk-button
          type="button"
          class="hb-leave-confirm__keep"
          [variant]="'ghost-leather'"
          (click)="close(false)"
        >
          {{ t('homebrew.leave.keep') }}
        </button>
        <button
          hk-button
          type="button"
          class="hb-leave-confirm__discard"
          [variant]="'ember'"
          (click)="close(true)"
        >
          {{ t('homebrew.leave.discard') }}
        </button>
      </div>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: min(100%, 380px);
    }

    .hb-leave-confirm__body {
      margin: 0 0 var(--space-3);
    }
  `,
})
export class HomebrewLeaveConfirmComponent {
  private readonly dialogRef = inject(DialogRef);

  protected close(leave: boolean): void {
    this.dialogRef.close(leave);
  }
}
