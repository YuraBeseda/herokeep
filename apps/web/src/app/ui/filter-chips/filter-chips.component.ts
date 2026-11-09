import { Component, computed, input, model } from '@angular/core';
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
  /**
   * Translated label of a leading "All" chip: pressed while nothing is selected, and pressing it
   * clears the selection. With it the trailing "Clear filters" chip is not drawn (All is the way
   * back). Without it the group is as before.
   */
  readonly allLabel = input<string | null>(null);
  readonly allCount = input<number | undefined>(undefined);
  /** A sprite id drawn before the All label. */
  readonly allIcon = input<string | undefined>(undefined);

  protected readonly allOption = computed<FilterChipOption | null>(() => {
    const label = this.allLabel();
    return label === null
      ? null
      : { id: '__all__', label, count: this.allCount(), icon: this.allIcon() };
  });

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
