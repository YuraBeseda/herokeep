import { Component, computed, input, output } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { ItemIconRefSchema } from '@hk/protocol';
import { BlobUrlPipe } from '@shared/pipes/blob-url.pipe';
import { IconComponent } from '../../shared/icons/icon.component';
import { bagItemSentence, bagItemSub, bagItemWords, type BagItem } from '../bag-item';
import { HkItemMarksComponent } from '../item-marks/item-marks.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

type Translate = (key: string, params?: Record<string, unknown>) => string;
/** What a slot draws: a sprite id, a local blob hash, or (neither) the monogram. */
interface Glyph {
  sprite?: string;
  blob?: string;
}

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
  imports: [TranslocoDirective, BlobUrlPipe, IconComponent, HkItemMarksComponent, HkTooltipDirective],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './satchel-grid.component.html',
  styleUrl: './satchel-grid.component.scss',
})
export class HkSatchelGridComponent {
  // Inputs
  readonly items = input.required<readonly BagItem[]>();
  readonly selectedId = input<string | null>(null);
  readonly minSlots = input(16);

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

  /** Pack icon first, else a valid `custom.icon`; an invalid one is a monogram, never a broken image. */
  protected glyph(item: BagItem): Glyph {
    if (item.blobIcon) return { blob: item.blobIcon };
    if (item.customIcon === undefined) return { sprite: item.icon };
    const ref = ItemIconRefSchema.safeParse(item.customIcon);
    if (!ref.success) return {};
    return ref.data.kind === 'gi' ? { sprite: `gi:${ref.data.id}` } : { blob: ref.data.hash };
  }

  protected monogram(item: BagItem): string {
    return Array.from(item.name.trim())[0]?.toLocaleUpperCase() ?? '';
  }

  protected sub(item: BagItem): string {
    return bagItemSub(item);
  }

  protected rim(item: BagItem): string | null {
    return item.rarity ? `var(--rarity-${item.rarity})` : null;
  }
}
