import { Component, input, output } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * A single-choice group of buttons (board C10's segmented control): exactly one option is
 * pressed, a click on another moves the mark. It owns no state: `value` is the chosen id and
 * `picked` reports the next one. Labels come from the campaigns scope: the group is named by
 * `<prefix>.label` and each option by `<prefix>.<id>`. The option buttons carry `aria-pressed`.
 */
@Component({
  selector: 'app-campaign-segmented',
  imports: [TranslocoDirective],
  template: `
    <div
      class="campaign-segmented"
      role="group"
      *transloco="let t; read: 'campaigns'"
      [attr.aria-label]="t(prefix() + '.label')"
    >
      @for (id of ids(); track id) {
        <button
          type="button"
          class="campaign-settings__option"
          [attr.aria-pressed]="value() === id"
          (click)="picked.emit(id)"
        >
          {{ t(prefix() + '.' + id) }}
        </button>
      }
    </div>
  `,
  styleUrl: './campaign-segmented.component.scss',
})
export class CampaignSegmentedComponent<T extends string> {
  /** Scope-relative key prefix, e.g. `settings.houseRules.xpMode`. */
  readonly prefix = input.required<string>();
  readonly ids = input.required<readonly T[]>();
  readonly value = input.required<T>();
  readonly picked = output<T>();
}
