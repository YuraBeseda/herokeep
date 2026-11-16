import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Sheet } from '@hk/engine';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { HkDescriptionDrawerComponent } from '../../../../ui/description-drawer/description-drawer.component';
import { HkIconButtonComponent } from '../../../../ui/icon-button/icon-button.component';
import { HkButtonComponent } from '../../../../ui/button/button.component';
import { HkNumberFieldComponent } from '../../../../ui/number-field/number-field.component';
import { HkPickerCardComponent } from '../../../../ui/picker-card/picker-card.component';
import { HkTagChipComponent } from '../../../../ui/tag-chip/tag-chip.component';
import { HkToggleComponent } from '../../../../ui/toggle/toggle.component';
import { HkTooltipDirective } from '../../../../ui/tooltip/tooltip.directive';
import { CreateWizardState, type KitLabel, type KitSource } from '../create-wizard.state';
import { EntityPickerComponent } from './entity-picker.component';

type InventoryRow = Sheet['inventory'][number];
type Denomination = 'cp' | 'sp' | 'ep' | 'gp' | 'pp';

// `hk-entity-picker`'s R3 render cap (task-6 fix round) — the real SRD pack carries 960 items.
const ITEM_PICKER_LIMIT = 60;

// Only these item categories ever get an equip toggle (task-8-brief.md).
const EQUIPPABLE_CATEGORIES: ReadonlySet<string> = new Set(['weapon', 'armor', 'shield']);

const DENOMINATIONS: readonly Denomination[] = ['cp', 'sp', 'ep', 'gp', 'pp'];

const KIT_SOURCES: readonly KitSource[] = ['class', 'background'];

interface KitCard {
  label: KitLabel;
  items: { name: string; qty: number }[];
  notes: string[];
  gp: number;
}

interface KitGroup {
  source: KitSource;
  ownerName: string;
  chosen: KitLabel | null;
  cards: KitCard[];
}

/**
 * The 'equipment' step (task-8-brief.md): add-from-library + currency. Unlike the spells step,
 * this one has no gate of its own — it always renders (both the fighter and wizard creation
 * paths reach it; the fighter path sees ONLY this step, no 'spells').
 *
 * Every add/equip/currency edit routes through `CreateWizardState`'s own extraDrafts mutators, so
 * `state.draftSheet().inventory`/`.currency` (both derived FROM those same drafts, via `reduce`
 * + `derive` over the synthetic draft event stream — see the state's class doc) are always the
 * live, authoritative read model here; this component keeps no inventory/currency copy of its
 * own, only the transient "qty to add next" draft.
 */
@Component({
  selector: 'hk-equipment-step',
  imports: [
    TranslocoDirective,
    FormsModule,
    EntityPickerComponent,
    HkButtonComponent,
    HkDescriptionDrawerComponent,
    HkIconButtonComponent,
    HkNumberFieldComponent,
    HkPickerCardComponent,
    HkTagChipComponent,
    HkToggleComponent,
    HkTooltipDirective,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './equipment-step.component.html',
  styleUrl: './equipment-step.component.scss',
})
export class EquipmentStepComponent {
  private readonly state = inject(CreateWizardState);
  private readonly engineFacade = inject(EngineFacade);

  protected readonly itemPickerLimit = ITEM_PICKER_LIMIT;
  protected readonly denominations = DENOMINATIONS;

  protected readonly itemIds = computed<string[]>(() =>
    this.engineFacade
      .index()
      .query({ type: 'item' })
      .map((e) => e.id),
  );

  protected readonly inventory = computed<InventoryRow[]>(
    () => this.state.draftSheet()?.inventory ?? [],
  );

  // Cosmetic only (`hk-entity-picker`'s `selectedIds` just highlights) — an item can be added
  // more than once (each add mints its own `instanceId`), so this is never a membership set in
  // the strict sense, only "already present at least once".
  protected readonly addedItemIds = computed<string[]>(() =>
    this.inventory()
      .map((entry) => entry.itemId)
      .filter((id): id is string => id !== undefined),
  );

  /** W09 kit cards: one group per chosen class/background that has starting equipment. */
  protected readonly kitGroups = computed<KitGroup[]>(() => {
    const localizer = this.engineFacade.localizer();
    return KIT_SOURCES.flatMap((source) => {
      const owner = this.state.kitOwner(source);
      const options = this.state.kitOptions(source);
      if (!owner || options.length === 0) return [];
      return [
        {
          source,
          ownerName: localizer.name(owner),
          chosen: this.state.kitChoice(source)(),
          cards: options.map((o) => ({
            label: o.label,
            items: o.items.map(({ item, qty }) => ({ name: localizer.name(item), qty })),
            // Notes are pack text; translations key them by their path on the owning entity.
            notes: o.notes.map(
              (note, i) =>
                localizer.text(owner, `startingEquipment.${o.label}.notes.${i}`, note).text,
            ),
            gp: o.gp,
          })),
        },
      ];
    });
  });

  /** The card's chips: each item (with its count past one), then the gold. */
  protected kitMeta(card: KitCard, t: (key: string, params: object) => string): string[] {
    return [
      ...card.items.map(({ name, qty }) => (qty > 1 ? `${name} ×${qty}` : name)),
      t('wizard.equipment.kits.gold', { gp: card.gp }),
    ];
  }

  protected onChooseKit(source: KitSource, label: KitLabel): void {
    this.state.chooseKit(source, label);
  }

  protected readonly qty = signal(1);
  /** The library list stays folded until asked for: 960 items are never the first thing on screen. */
  protected readonly libraryOpen = signal(false);

  protected readonly currencyDraft = computed<Sheet['currency']>(
    () => this.state.draftSheet()?.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  );

  protected readonly detailsId = signal<string | undefined>(undefined);
  protected readonly detailsOpen = signal(false);
  protected readonly detailsOpener = signal<HTMLElement | null>(null);

  /** Opens an item's full description (the bag row's name may be cut short). */
  protected openDetails(event: Event, itemId: string): void {
    const target = event.currentTarget;
    this.detailsOpener.set(target instanceof HTMLElement ? target : null);
    this.detailsId.set(itemId);
    this.detailsOpen.set(true);
  }

  protected entryName(entry: InventoryRow): string {
    return entry.itemId ? this.itemName(entry.itemId) : (entry.name ?? entry.instanceId);
  }

  protected itemName(id: string): string {
    return this.engineFacade.localizer().name(id);
  }

  protected isEquipEligible(itemId: string | undefined): boolean {
    if (!itemId) return false;
    const entity = this.engineFacade.index().get(itemId);
    return entity?.type === 'item' && EQUIPPABLE_CATEGORIES.has(entity.category);
  }

  protected onQtyChange(value: number | null): void {
    this.qty.set(value !== null && value >= 1 ? Math.floor(value) : 1);
  }

  protected onAddItem(itemId: string): void {
    this.state.addItem(itemId, this.qty());
  }

  protected onToggleEquip(entry: InventoryRow): void {
    if (entry.equipped) this.state.unequipItem(entry.instanceId);
    else this.state.equipItem(entry.instanceId);
  }

  protected onCurrencyChange(denom: Denomination, value: number | null): void {
    this.state.setCurrency({ ...this.currencyDraft(), [denom]: value ?? 0 });
  }
}
