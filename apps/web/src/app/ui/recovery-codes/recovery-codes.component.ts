import { Component, inject, input } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ToastService } from '@shared/components/toast/toast.service';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkButtonComponent } from '../button/button.component';

/** The one-time recovery codes as shown after register and after regenerating them in Settings:
 * the list, Copy, Download as .txt and the "each code works once" note. Loads the `auth` scope
 * itself so it renders the same wherever it is placed (a dialog sits under the root injector). */
@Component({
  selector: 'hk-recovery-codes',
  imports: [TranslocoDirective, IconComponent, HkButtonComponent],
  providers: [provideTranslocoScope('auth')],
  template: `
    <ng-container *transloco="let t; read: 'auth.register.codesStep'">
      <ol class="recovery-codes__list" [attr.aria-label]="t('listLabel')">
        @for (code of codes(); track code) {
          <li class="recovery-codes__code">{{ code }}</li>
        }
      </ol>
      <div class="recovery-codes__actions">
        <button
          hk-button
          type="button"
          class="recovery-codes__copy"
          [variant]="'ghost'"
          (click)="copy()"
        >
          <hk-icon [icon]="'ui:copy'" />{{ t('copy') }}
        </button>
        <button
          hk-button
          type="button"
          class="recovery-codes__download"
          [variant]="'ghost'"
          (click)="download()"
        >
          <hk-icon [icon]="'ui:export'" />{{ t('download') }}
        </button>
        <span class="recovery-codes__once">{{ t('once') }}</span>
      </div>
    </ng-container>
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-3);
    }
    // A monospace block, two columns on a wide leaf, one on a phone.
    .recovery-codes__list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-2) var(--space-3);
      margin: 0;
      padding: var(--space-3);
      list-style: none;
      border-radius: var(--radius-frame);
      background: var(--leaf-sunken);
      box-shadow: inset 0 0 0 1px var(--leaf-edge);
      font-family: ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
      font-size: 16px;
      letter-spacing: 0.04em;
    }
    .recovery-codes__code {
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }
    .recovery-codes__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .recovery-codes__once {
      margin-inline-start: auto;
      color: var(--text-2);
      font-style: italic;
    }
    @media (max-width: 479.98px) {
      .recovery-codes__list {
        grid-template-columns: minmax(0, 1fr);
      }
      .recovery-codes__once {
        margin-inline-start: 0;
      }
    }
  `,
})
export class HkRecoveryCodesComponent {
  private readonly toastService = inject(ToastService);
  readonly codes = input.required<readonly string[]>();

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.codes().join('\n'));
      this.toastService.show('auth.register.codesStep.copied');
    } catch {
      this.toastService.show('auth.register.codesStep.copy-failed');
    }
  }

  protected download(): void {
    const blob = new Blob([`${this.codes().join('\n')}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'herokeep-recovery-codes.txt';
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
