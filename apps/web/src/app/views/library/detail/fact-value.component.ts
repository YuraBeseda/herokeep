import { Component, input } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { FactValue } from './entity-facts.formatters';

/**
 * One fact value from the library's formatters, resolved in the library scope: plain text as is, a
 * keyed value (a plural unit such as "3 minutes") through the translator. The sheet's dialogs show
 * spell and item facts with it, so a unit reads the same there as on the library page.
 */
@Component({
  selector: 'app-fact-value',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('library')],
  template: `<ng-container *transloco="let t; read: 'library'">{{
    value().kind === 'key' ? t(keyOf(), paramsOf()) : textOf()
  }}</ng-container>`,
})
export class FactValueComponent {
  readonly value = input.required<FactValue>();

  protected keyOf(): string {
    const v = this.value();
    return v.kind === 'key' ? v.key : '';
  }

  protected paramsOf(): Record<string, unknown> {
    const v = this.value();
    return v.kind === 'key' ? v.params : {};
  }

  protected textOf(): string {
    const v = this.value();
    return v.kind === 'text' ? v.text : '';
  }
}
