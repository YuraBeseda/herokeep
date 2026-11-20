import { Component, computed, input, output } from '@angular/core';
import { HkContextMenuDirective } from '../context-menu/context-menu.directive';
import type { HkMenuItem, HkMenuItems } from '../context-menu/context-menu.types';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { BlobUrlPipe } from '@shared/pipes/blob-url.pipe';
import { IconComponent } from '../../shared/icons/icon.component';
import {
  bagItemGlyph,
  bagItemMonogram,
  bagItemSentence,
  bagItemSub,
  bagItemWords,
  type BagItem,
  type BagItemGlyph,
} from '../bag-item';
import { HkItemMarksComponent } from '../item-marks/item-marks.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * `hk-satchel-grid` — the bag as a grid of leather slots on a recessed floor (design-system
 * SatchelGrid): each slot has a brass-ringed item glyph, a caption and sub-caption, and marks for
 * quantity, equipped and attuned, plus a rarity rim. It is the desktop and tablet view of the
 * bag; phones use `hk-item-row`.
 *
 * It is a list of buttons: `select` emits the id of the pressed item and `selectedId` marks the
 * pressed one (`aria-pressed`). Empty slots pad the grid up to `minSlots`. A slot's accessible
 * name and hint are the item's whole sentence ("Ring of Protection, rare, 0/7, Equipped,
 * Attuned"), so every visible value is spoken and a clipped caption is never lost. Flap, buckle
 * and the selected-item action strip are the sheet's to compose around it.
 */
@Component({
  selector: 'hk-satchel-grid',
  imports: [
    TranslocoDirective,
    BlobUrlPipe,
    IconComponent,
    HkItemMarksComponent,
    HkTooltipDirective,
    HkContextMenuDirective,
  ],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './satchel-grid.component.html',
  styleUrl: './satchel-grid.component.scss',
})
export class HkSatchelGridComponent {
  // Inputs
  readonly items = input.required<readonly BagItem[]>();
  readonly selectedId = input<string | null>(null);
  readonly minSlots = input(16);
  /** The context menu of a slot, by item id (`[hkContextMenu]`); `null` keeps the native menu. */
  readonly menu = input<((id: string) => HkMenuItem[]) | null>(null);

  /** A thunk, so a slot's menu is built when it opens, not on every render. */
  protected menuOf(id: string): HkMenuItems | null {
    const menu = this.menu();
    return menu ? () => menu(id) : null;
  }

  // Outputs
  // `select` is the name the bag views ask for; the native `select` event (text selection) is
  // not used on this element.
  // eslint-disable-next-line @angular-eslint/no-output-native
  readonly select = output<string>();

  protected readonly emptySlots = computed(() =>
    Array.from({ length: Math.max(0, this.minSlots() - this.items().length) }, (_, i) => i),
  );

  protected sentence(item: BagItem, t: Translate): string {
    return bagItemSentence(item, bagItemWords(t));
  }

  protected glyph(item: BagItem): BagItemGlyph {
    return bagItemGlyph(item);
  }

  protected monogram(item: BagItem): string {
    return bagItemMonogram(item);
  }

  protected sub(item: BagItem): string {
    return bagItemSub(item);
  }

  protected rim(item: BagItem): string | null {
    return item.rarity ? `var(--rarity-${item.rarity})` : null;
  }
}
