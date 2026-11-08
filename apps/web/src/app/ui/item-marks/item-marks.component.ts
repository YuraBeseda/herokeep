import { Component, input } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import type { BagItem } from '../bag-item';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * `hk-item-marks` — the equipped tag, the attuned gem and the quantity plate of a carried item
 * (design-system `hk-tagE`, `hk-gem`, `hk-qty`), shared by the satchel slot and the phone ledger
 * row. Each mark is an image named by its meaning and explained by a hint; none has a legend.
 *
 * `layout="corner"` pins them to the corners of a slot (the parent is positioned); `"inline"`
 * lays them out in a row. Inside a button (the slot) the marks are not focusable on their own;
 * in the row, set `focusable` so a keyboard user can reach the hints.
 */
@Component({
  selector: 'hk-item-marks',
  imports: [TranslocoDirective, HkTooltipDirective],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './item-marks.component.html',
  styleUrl: './item-marks.component.scss',
  host: {
    '[class.hk-marks--corner]': 'layout() === "corner"',
  },
})
export class HkItemMarksComponent {
  readonly item = input.required<BagItem>();
  readonly layout = input<'corner' | 'inline'>('inline');
  readonly focusable = input(false);
}
