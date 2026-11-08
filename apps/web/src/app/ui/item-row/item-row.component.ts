import { Component, input, output } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { bagItemSentence, bagItemSub, bagItemWords, type BagItem } from '../bag-item';
import { HkItemMarksComponent } from '../item-marks/item-marks.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * `hk-item-row` — the phone's ledger row for one carried item (design-system ItemRow): a leather
 * glyph ring, the name over a sub-line (rarity word, weight, charges), the equipped / attuned /
 * quantity marks and a 44px details button. Selecting the row (`select`) takes the `selected`
 * state: a sunken band, and the projected `[hkItemActions]` strip (Use, Attune, Equip, Details
 * buttons, the caller's) appears beneath it.
 *
 * The select button's name and hint are the item's whole sentence, so every visible value is
 * spoken and the ellipsised name is always readable. The details button names the item.
 */
@Component({
  selector: 'hk-item-row',
  imports: [TranslocoDirective, IconComponent, HkItemMarksComponent, HkTooltipDirective],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './item-row.component.html',
  styleUrl: './item-row.component.scss',
  host: {
    '[class.hk-item--selected]': 'selected()',
  },
})
export class HkItemRowComponent {
  // Inputs
  readonly item = input.required<BagItem>();
  readonly selected = input(false);

  // Outputs
  // `select` is the name the bag views ask for; the native `select` event (text selection) is
  // not used on this element.
  // eslint-disable-next-line @angular-eslint/no-output-native
  readonly select = output<void>();
  readonly details = output<void>();

  protected sentence(item: BagItem, t: Translate): string {
    return bagItemSentence(item, bagItemWords(t));
  }

  protected sub(item: BagItem): string {
    return bagItemSub(item);
  }
}
