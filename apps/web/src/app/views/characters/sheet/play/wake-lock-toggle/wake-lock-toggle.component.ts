import { Component, inject } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { WakeLockService } from '@shared/services/pwa/wake-lock.service';
import { HkButtonComponent } from '../../../../../ui/button/button.component';

/**
 * The "keep the screen awake" toggle (task-11-brief.md): hidden entirely when the Screen Wake Lock
 * API is unsupported (`WakeLockService.supported`). A plain flip off the service's own `active`
 * signal — no local state: `WakeLockService` is the single source of truth, including
 * re-acquiring on visibilitychange and going false if the UA releases the sentinel.
 */
@Component({
  selector: 'app-wake-lock-toggle',
  imports: [TranslocoDirective, HkButtonComponent],
  providers: [provideTranslocoScope('characters')],
  template: `
    <ng-container *transloco="let t; read: 'characters'">
      @if (wakeLock.supported) {
        <button
          hk-button
          type="button"
          class="wake-lock__toggle"
          [variant]="wakeLock.active() ? 'primary' : 'ghost'"
          [attr.aria-pressed]="wakeLock.active()"
          (click)="toggle()"
        >
          {{ wakeLock.active() ? t('sheet.wakeLock.on') : t('sheet.wakeLock.off') }}
        </button>
      }
    </ng-container>
  `,
})
export class WakeLockToggleComponent {
  protected readonly wakeLock = inject(WakeLockService);

  protected toggle(): void {
    if (this.wakeLock.active()) {
      void this.wakeLock.disable();
    } else {
      void this.wakeLock.enable();
    }
  }
}
