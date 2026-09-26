import { Component } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';

/**
 * `/g/:id/party` (plan-10 task-6-brief.md): a placeholder — the real party overview (member
 * sheets/HP/AC/conditions grid) is Task 8's job. This exists only so the route tree is complete
 * and the default child redirect (`{path:'', redirectTo:'party'}`, `app.routes.ts`) has something
 * real to land on; Task 8 replaces this file's contents entirely.
 */
@Component({
  selector: 'app-party-tab',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('campaigns')],
  template: `<p class="party-tab__placeholder" *transloco="let t; read: 'campaigns'">
    {{ t('party.placeholder') }}
  </p>`,
})
export class PartyTabComponent {}
