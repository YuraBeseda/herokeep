import { Component } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';

/**
 * `/c/:id/build` — placeholder (plan-5 task-10-brief.md: "build/timeline point at PLACEHOLDER
 * components you create as stubs — Tasks 11/12 replace their bodies; keep stubs minimal: a heading
 * only"). Deliberately does nothing else yet.
 */
@Component({
  selector: 'app-build-tab',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('characters')],
  template: ` <h2 *transloco="let t; read: 'characters'">{{ t('sheet.tabs.build') }}</h2> `,
})
export class BuildTabComponent {}
