import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, Injector, input, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { Sheet } from '@hk/engine';
import { ItemIconRefSchema } from '@hk/protocol';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CharacterStore } from '@shared/stores/character.store';
import type { BagItem } from '../../../../../ui/bag-item';
import { HkButtonComponent } from '../../../../../ui/button/button.component';
import { HkContextMenuDirective } from '../../../../../ui/context-menu/context-menu.directive';
import type { HkMenuItem } from '../../../../../ui/context-menu/context-menu.types';
import { HkMenuButtonComponent } from '../../../../../ui/context-menu/menu-button.component';
import {
  HkCoinPouchComponent,
  type CoinPurse,
} from '../../../../../ui/coin-pouch/coin-pouch.component';
import { PeekService } from '../../../../../ui/description-drawer/peek.service';
import { HkItemRowComponent } from '../../../../../ui/item-row/item-row.component';
import { HkLeafComponent } from '../../../../../ui/leaf/leaf.component';
import { HkSatchelGridComponent } from '../../../../../ui/satchel-grid/satchel-grid.component';
import {
  HkWeightStrapComponent,
  type WeightState,
} from '../../../../../ui/weight-strap/weight-strap.component';
import { PlayActionsService, type InventoryRow } from '../play-actions.service';
import type { ScopedT } from '../play-rolls.service';
import { sheetNames } from '../play-names';

// Only these item categories ever get an equip toggle (pack data: `item.category`) — the same set
// the creation wizard's equipment step uses; `consumable` is the category a stack is Used from.
const EQUIPPABLE_CATEGORIES: ReadonlySet<string> = new Set(['weapon', 'armor', 'shield']);
const USABLE_CATEGORIES: ReadonlySet<string> = new Set(['consumable']);

// `Sheet.carry.state` -> the weight strap's states. Presentation only: the engine decided the state.
const WEIGHT_STATE: Record<NonNullable<Sheet['carry']>['state'], WeightState> = {
  normal: 'loaded',
  encumbered: 'encumbered',
  heavilyEncumbered: 'heavy',
  overloaded: 'over',
};

interface BagRow {
  readonly row: InventoryRow;
  readonly item: BagItem;
  readonly itemId: string | undefined;
  readonly weight: number | undefined;
  readonly unresolved: boolean;
  readonly equipEligible: boolean;
  readonly attuneEligible: boolean;
  readonly usable: boolean;
}

/**
 * The bag (spec §4.2): the satchel — a leather flap with a brass buckle over a grid of slots
 * (desktop/tablet) or the ledger of item rows (phone) — with the selected item's action strip
 * (Use for consumables, Equip, Attune, Details, quantity, Remove), the add buttons, the coin pouch
 * and the weight strap. Add / Use / Equip / Attune / Remove / quantity / coin edits all go through
 * `PlayActionsService`; weight is the pack's own item weight times the quantity, summed for display.
 */
@Component({
  selector: 'app-bag-leaf',
  imports: [
    NgTemplateOutlet,
    TranslocoDirective,
    HkLeafComponent,
    HkButtonComponent,
    HkSatchelGridComponent,
    HkItemRowComponent,
    HkCoinPouchComponent,
    HkWeightStrapComponent,
    HkContextMenuDirective,
    HkMenuButtonComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './bag-leaf.component.html',
  styleUrl: './bag-leaf.component.scss',
})
export class BagLeafComponent {
  /** The phone shows the ledger of item rows instead of the satchel grid. */
  readonly phone = input(false);

  protected readonly actions = inject(PlayActionsService);
  private readonly engineFacade = inject(EngineFacade);
  private readonly names = sheetNames(this.engineFacade);
  protected readonly sheet = inject(CharacterStore).sheet;

  // `row.resolved` is false only for a STALE itemId; a custom item has none. The bag renders both
  // by name with the unresolved treatment — `unresolved` here is the UI's broader "no live pack
  // entity behind the row" flag. `weight` is the item ENTITY's weight × qty, display only.
  protected readonly rows = computed<BagRow[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    const index = this.engineFacade.index();
    return sheet.inventory.map((row) => {
      const entity = row.itemId ? index.get(row.itemId) : undefined;
      const item = entity?.type === 'item' ? entity : undefined;
      const weight = item?.weight !== undefined ? item.weight * row.qty : undefined;
      return {
        row,
        item: {
          id: row.instanceId,
          name: this.names.itemName(row),
          icon: row.itemId ? this.names.iconOf(row.itemId, 'ui:bag') : 'ui:bag',
          ...(entity?.icon?.startsWith('sha256:') ? { blobIcon: entity.icon } : {}),
          ...(!row.itemId && row.custom?.['icon'] !== undefined
            ? { customIcon: row.custom['icon'] }
            : {}),
          qty: row.qty,
          equipped: row.equipped,
          attuned: row.attuned,
        },
        itemId: row.itemId,
        weight,
        unresolved: !row.itemId || !row.resolved,
        equipEligible: item !== undefined && EQUIPPABLE_CATEGORIES.has(item.category),
        // Gated by the item ENTITY's own `attunement.required` — only `true` opts a row in; a custom
        // row (no entity) is never attune-eligible.
        attuneEligible: item?.attunement?.required === true,
        usable: item !== undefined && USABLE_CATEGORIES.has(item.category),
      };
    });
  });

  /** The game-icon slugs this bag already shows (library items through the sheet's scoped facade,
   * and picked custom glyphs), in bag order: the custom item's icon picker lists them first. */
  protected readonly usedGlyphs = computed(() => {
    const slugs = this.rows().map(({ item }) => {
      const ref = ItemIconRefSchema.safeParse(item.customIcon);
      if (!ref.success) return item.icon;
      return ref.data.kind === 'gi' ? `gi:${ref.data.id}` : '';
    });
    return [...new Set(slugs.filter((s) => s.startsWith('gi:')).map((s) => s.slice(3)))];
  });

  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed<BagRow | undefined>(() =>
    this.rows().find((r) => r.row.instanceId === this.selectedId()),
  );

  // The simple sum of every row's own (already qty-multiplied) weight; no encumbrance thresholds.
  protected readonly totalWeight = computed(() =>
    this.rows().reduce((sum, entry) => sum + (entry.weight ?? 0), 0),
  );

  protected readonly coins = computed<CoinPurse>(() => {
    const currency = this.sheet()?.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
    return { pp: currency.pp, gp: currency.gp, ep: currency.ep, sp: currency.sp, cp: currency.cp };
  });

  // `Sheet.carry` is present ONLY when encumbrance is in force for this character (a campaign house
  // rule, or the character's own Build → Options choice); absent, not a zeroed struct, otherwise.
  protected readonly carry = computed(() => this.sheet()?.carry);
  protected readonly weightState = computed<WeightState>(() => {
    const carry = this.carry();
    return carry ? WEIGHT_STATE[carry.state] : 'loaded';
  });

  // `variant.thresholds[].speedPenalty` lives on the PACK's `system.encumbrance` config, never on
  // `Sheet.carry`; display only — the matched threshold's penalty when the pack authored one.
  protected readonly carrySpeedPenalty = computed<number | undefined>(() => {
    const carry = this.carry();
    if (carry?.mode !== 'variant') return undefined;
    const thresholds = this.engineFacade.index().system().encumbrance?.variant?.thresholds ?? [];
    return thresholds.find((t) => t.state === carry.state)?.speedPenalty;
  });

  private readonly peek = inject(PeekService);
  private readonly injector = inject(Injector);

  // A bag item's sub-caption is translated text (the weight), so the display items are built with
  // the template's `t`; cached on (rows, t) so the grid's input is stable between renders.
  private itemsCache?: { rows: BagRow[]; t: ScopedT; items: BagItem[] };

  protected itemsFor(t: ScopedT): BagItem[] {
    const rows = this.rows();
    if (this.itemsCache?.rows === rows && this.itemsCache.t === t) return this.itemsCache.items;
    const items = rows.map((entry) => ({
      ...entry.item,
      sub: entry.weight !== undefined ? t('sheet.inventory.weight', { value: entry.weight }) : null,
      // A stale pack reference (not a custom item) is an unidentified item.
      unknown: !!entry.itemId && !entry.row.resolved,
    }));
    this.itemsCache = { rows, t, items };
    return items;
  }

  protected select(id: string): void {
    this.selectedId.update((current) => (current === id ? null : id));
  }

  protected openDetails(entry: BagRow): void {
    if (!entry.itemId || !this.engineFacade.index().has(entry.itemId)) return;
    const active = document.activeElement;
    this.peek.open(entry.itemId, active instanceof HTMLElement ? active : undefined, {
      injector: this.injector,
    });
  }

  /** A row's context menu: the same actions as its strip (keys are full `characters.` keys). */
  protected menuFor(entry: BagRow): HkMenuItem[] {
    const k = 'characters.sheet.inventory.';
    const locked = this.actions.editLocked() ? 'characters.sheet.editLocked' : undefined;
    const row = entry.row;
    const lock = (item: HkMenuItem): HkMenuItem =>
      locked ? { ...item, disabledReasonKey: locked } : item;
    const items: HkMenuItem[] = [];
    if (entry.usable) {
      items.push(
        lock({
          id: 'use',
          labelKey: `${k}use`,
          icon: 'ui:use',
          run: () => this.actions.useOne(row),
        }),
      );
    }
    if (entry.equipEligible) {
      items.push(
        lock({
          id: 'equip',
          labelKey: `${k}${row.equipped ? 'unequip' : 'equip'}`,
          icon: row.equipped ? 'ui:unequip' : 'ui:equip',
          run: () => this.actions.toggleEquip(row),
        }),
      );
    }
    if (entry.attuneEligible) {
      items.push(
        lock({
          id: 'attune',
          labelKey: `${k}${row.attuned ? 'unattune' : 'attune'}`,
          icon: 'ui:attune',
          run: () => this.actions.toggleAttune(row),
        }),
      );
    }
    if (this.canShowDetails(entry)) {
      items.push({
        id: 'details',
        labelKey: `${k}details`,
        icon: 'ui:details',
        run: () => this.openDetails(entry),
      });
    }
    items.push(
      lock({
        id: 'qty-up',
        labelKey: `${k}qtyIncrease`,
        icon: 'ui:add',
        detail: String(row.qty),
        run: () => this.actions.increaseQty(row),
      }),
      row.qty <= 1
        ? {
            id: 'qty-down',
            labelKey: `${k}qtyDecrease`,
            icon: 'ui:remove',
            disabledReasonKey: `${k}qtyMinimum`,
            run: () => undefined,
          }
        : lock({
            id: 'qty-down',
            labelKey: `${k}qtyDecrease`,
            icon: 'ui:remove',
            run: () => this.actions.decreaseQty(row),
          }),
      lock({
        id: 'remove',
        labelKey: `${k}remove`,
        icon: 'ui:close',
        run: () => void this.actions.removeItem(row),
      }),
    );
    return items;
  }

  /** The satchel's per-slot menu, by item id. */
  /** The row's menu, built when it opens rather than on every render. */
  protected menuThunk(entry: BagRow): () => HkMenuItem[] {
    return () => this.menuFor(entry);
  }

  protected readonly menuOf = (id: string): HkMenuItem[] => {
    const entry = this.rows().find((r) => r.row.instanceId === id);
    return entry ? this.menuFor(entry) : [];
  };

  protected canShowDetails(entry: BagRow): boolean {
    return !!entry.itemId && this.engineFacade.index().has(entry.itemId);
  }

  protected saveCoins(purse: CoinPurse): void {
    const sheet = this.sheet();
    if (!sheet) return;
    this.actions.applyCurrency({ ...sheet.currency, ...purse });
  }

  protected carryStateKey(state: NonNullable<Sheet['carry']>['state']): string {
    return `sheet.inventory.carry.state.${state}`;
  }
}
