import { Component, input, model } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { HkFilterChipComponent, type FilterChipOption } from './filter-chip.component';
export type { FilterChipOption };

/**
 * `hk-filter-chips` — a labelled group of pressed/unpressed toggle chips under a search field
 * (design-system FilterChips). Selected chips turn brass; damage chips carry their ink dot. A
 * trailing "Clear filters" chip appears while anything is on.
 *
 * It owns no filtering: `selected` is the set of chip ids that are on and `selectedChange`
 * reports the next set. An unavailable chip stays focusable and inert, and its reason lives only
 * in its hint.
 */
@Component({
  selector: 'hk-filter-chips',
  imports: [TranslocoDirective, HkFilterChipComponent],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './filter-chips.component.html',
  styleUrl: './filter-chips.component.scss',
})
export class HkFilterChipsComponent {
  // Inputs
  /** Translated accessible name of the group. */
  readonly label = input.required<string>();
  readonly options = input.required<readonly FilterChipOption[]>();
  /** The ids of the chips that are on. */
  readonly selected = model<readonly string[]>([]);

  protected toggle(option: FilterChipOption): void {
    if (option.disabledReason) return;
    const current = this.selected();
    this.selected.set(
      current.includes(option.id)
        ? current.filter((id) => id !== option.id)
        : [...current, option.id],
    );
  }

  protected clear(): void {
    this.selected.set([]);
  }
}
