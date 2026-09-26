import { Component } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';

/**
 * `/g/:id/log` (plan-10 task-6-brief.md): a placeholder — the real roll log/chat view (visibility
 * filtering, session grouping) is Task 10's job. Exists only so the route tree is complete; Task
 * 10 replaces this file's contents entirely.
 */
@Component({
  selector: 'app-log-tab',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('campaigns')],
  template: `<p class="log-tab__placeholder" *transloco="let t; read: 'campaigns'">
    {{ t('log.placeholder') }}
  </p>`,
})
export class LogTabComponent {}
