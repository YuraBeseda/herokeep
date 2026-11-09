import { Component, input } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { HkTagChipComponent } from '../../../../ui/tag-chip/tag-chip.component';
import type { LockView } from './build-view';

/*
 * A lock chip (board B01 `lockt`): a padlock and a one or two word state beside a row that cannot
 * be changed, with the reason as its hint (tooltip + aria). The reason is never printed beside the
 * row. Keys are static (one record) so the key check can see them.
 */
const LOCK_KEYS: Record<LockView['kind'], { readonly label: string; readonly hint: string }> = {
  fixed: { label: 'sheet.build.lock.fixed', hint: 'sheet.build.lock.fixedHint' },
  viaLevelUp: { label: 'sheet.build.lock.viaLevelUp', hint: 'sheet.build.lock.viaLevelUpHint' },
  subclass: { label: 'sheet.build.lock.locked', hint: 'sheet.build.lock.subclassHint' },
  granted: { label: 'sheet.build.lock.granted', hint: 'sheet.build.lock.grantedHint' },
  unsupported: { label: 'sheet.build.lock.unsupported', hint: 'sheet.build.lock.unsupportedHint' },
};

@Component({
  selector: 'app-build-lock',
  imports: [TranslocoDirective, HkTagChipComponent],
  providers: [provideTranslocoScope('characters')],
  template: `
    <ng-container *transloco="let t; read: 'characters'">
      @let keys = lockKeys[lock().kind];
      <hk-tag-chip
        class="build-tab__lock"
        [icon]="lock().kind === 'viaLevelUp' ? 'ui:level-up' : 'ui:lock'"
        [label]="t(keys.label)"
        [hint]="t(keys.hint, lock().params ?? {})"
      />
    </ng-container>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
  `,
})
export class BuildLockComponent {
  readonly lock = input.required<LockView>();
  protected readonly lockKeys = LOCK_KEYS;
}
