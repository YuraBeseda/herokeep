import { Component, inject } from '@angular/core';
import { DialogRef } from '@app/ui/dialog/dialog.service';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { HkButtonComponent } from '../../../../ui/button/button.component';
import { PlayRollsService } from './play-rolls.service';
import { RollLogPanelComponent } from './roll-log-panel.component';

/**
 * The roll log opened from the sheet strap (B9a). It hosts the EXISTING `app-roll-log-panel` (the
 * advantage toggle, the campaign visibility picker, the manual entry and the log) in a dialog; the
 * panel's two-way models bind straight to `PlayRollsService`, which is what the sheet's roll
 * buttons read. B9b replaces this host with the roll-log drawer (board D02).
 */
@Component({
  selector: 'app-roll-log-dialog',
  providers: [provideTranslocoScope('characters')],
  imports: [TranslocoDirective, HkButtonComponent, RollLogPanelComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="roll-log-dialog__title" data-dialog-title>
        {{ t('characters.sheet.roll.logTitle') }}
      </h2>
      <app-roll-log-panel
        [(advantageMode)]="rolls.advantageMode"
        [visibilityOptions]="rolls.rollVisibilityOptions()"
        [(visibility)]="rolls.rollVisibility"
      />
      <div class="roll-log-dialog__actions">
        <button hk-button type="button" [variant]="'ghost'" (click)="close()">
          {{ t('characters.sheet.roll.close') }}
        </button>
      </div>
    </ng-container>
  `,
})
export class RollLogDialogComponent {
  protected readonly rolls = inject(PlayRollsService);
  private readonly dialogRef = inject(DialogRef);

  protected close(): void {
    this.dialogRef.close();
  }
}
