import { Component, inject } from '@angular/core';
import type { TranslocoService } from '@jsverse/transloco';
import { DIALOG_DATA, DialogRef, type DialogService } from '@app/ui/dialog/dialog.service';
import { HkButtonComponent } from '../../ui/button/button.component';

/** What the dialog shows; every string is already translated by whoever opens it. */
export interface HelpDialogData {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly closeLabel: string;
}

/**
 * The strap's Help (Settings, Log in, Create account, Recover): a title, a few short paragraphs
 * and a Close button on a leather strap. It carries no keys of its own, so it works under any
 * view's translation scope.
 */
@Component({
  selector: 'app-help-dialog',
  imports: [HkButtonComponent],
  template: `
    <h2 class="help-dialog__title" data-dialog-title>{{ data.title }}</h2>
    @for (paragraph of data.paragraphs; track $index) {
      <p class="help-dialog__paragraph">{{ paragraph }}</p>
    }
    <div class="help-dialog__actions" data-dialog-actions>
      <button hk-button type="button" class="help-dialog__close" (click)="close()">
        {{ data.closeLabel }}
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: min(100%, 380px);
    }

    .help-dialog__paragraph {
      margin: 0 0 var(--space-3);
      color: var(--text-1);
    }
  `,
})
export class HelpDialogComponent {
  protected readonly data = inject<HelpDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);

  protected close(): void {
    this.dialogRef.close();
  }
}

/**
 * Opens the help dialog for a view whose `help` block holds `title`, `close` and the named
 * paragraphs (`<scope>.help.<topic>`). The view's own scope is loaded by then.
 */
export function openHelpDialog(
  dialogs: DialogService,
  transloco: TranslocoService,
  scope: 'settings' | 'auth',
  topics: readonly string[],
): void {
  const read = (key: string): string => transloco.translate(`${scope}.help.${key}`);
  dialogs.open(HelpDialogComponent, {
    data: {
      title: read('title'),
      paragraphs: topics.map(read),
      closeLabel: read('close'),
    } satisfies HelpDialogData,
  });
}
