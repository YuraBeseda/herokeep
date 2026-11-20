import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { Sheet } from '@hk/engine';
import {
  DerivedPopoverDirective,
  type DerivedValue,
} from '@shared/directives/derived-popover.directive';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CharacterStore } from '@shared/stores/character.store';
import { HkButtonComponent } from '../../../../../ui/button/button.component';
import { HkLeafComponent } from '../../../../../ui/leaf/leaf.component';
import { HkSpellRowComponent } from '../../../../../ui/spell-row/spell-row.component';
import { HkStatTileComponent } from '../../../../../ui/stat-tile/stat-tile.component';
import { HkTooltipDirective } from '@app/ui/tooltip/tooltip.directive';
import { HkTagChipComponent } from '../../../../../ui/tag-chip/tag-chip.component';
import { HkWaxSealComponent } from '../../../../../ui/wax-seal/wax-seal.component';
import { signed } from '../../../../../ui/format';
import { PlayActionsService, type SpellRow } from '../play-actions.service';
import { breakdownText } from '../breakdown-hint';
import { PlayRollsService, type ScopedT } from '../play-rolls.service';
import { sheetNames } from '../play-names';

type SpellcastingBlock = Sheet['spellcasting'][number];
type SlotRow = SpellcastingBlock['slots'];

// Value identity of a slot row (level/max/used triples) — see `sharedSlotKeys`.
const slotRowKey = (slots: SlotRow): string =>
  slots.map((s) => `${s.level}:${s.max}:${s.used}`).join('|');

interface SpellBlockView extends SpellcastingBlock {
  readonly className: string;
  readonly knownSpells: SpellRow[];
  readonly preparedSpells: SpellRow[];
  readonly slotsShared: boolean;
}

/**
 * Spells (spec §4.2): the concentration banner with End, then per spellcasting class the save DC /
 * spell attack, the slot seals by level (a wax seal per slot with the level numeral, labelled
 * "Level N slots, X of Y"), the pact lane, the prepared count, the known list (cantrips cast
 * directly, prepared-casters Prepare / Unprepare) and the prepared list (Cast). The engine owns
 * every rule: this leaf only forwards clicks to `PlayActionsService`.
 */
@Component({
  selector: 'app-spells-leaf',
  imports: [
    NgTemplateOutlet,
    TranslocoDirective,
    HkLeafComponent,
    HkSpellRowComponent,
    HkWaxSealComponent,
    HkButtonComponent,
    HkStatTileComponent,
    HkTagChipComponent,
    HkTooltipDirective,
    DerivedPopoverDirective,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './spells-leaf.component.html',
  styleUrl: './spells-leaf.component.scss',
})
export class SpellsLeafComponent {
  readonly phone = input(false);

  protected readonly actions = inject(PlayActionsService);
  private readonly rolls = inject(PlayRollsService);
  private readonly names = sheetNames(inject(EngineFacade));
  private readonly sheet = inject(CharacterStore).sheet;
  protected readonly signed = signed;

  /** The explanation, then the live breakdown of the value when the sheet derived one. */
  protected hintWith(explain: string, value: DerivedValue, t: ScopedT): string {
    const parts = breakdownText(value, t, this.names);
    return parts ? `${explain} ${parts}` : explain;
  }

  protected readonly concentration = computed(() => this.sheet()?.concentration);
  protected readonly concentrationName = computed(() => {
    const spellId = this.concentration()?.spellId;
    return spellId ? this.names.resolve(spellId) : null;
  });

  // Pooled-slot dedupe (plan 12 task 4): for a pooled multiclass caster the engine emits the SAME
  // combined slot row on EVERY participating block, so a row that appears (value-identical) on 2+
  // blocks IS the shared pool. No multiclass rules live here: only "identical engine output renders
  // once". A pact block has an empty `slots` row and is never grouped.
  private readonly sharedSlotKeys = computed<ReadonlySet<string>>(() => {
    const counts = new Map<string, number>();
    for (const block of this.sheet()?.spellcasting ?? []) {
      if (block.slots.length === 0) continue;
      const key = slotRowKey(block.slots);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n >= 2).map(([key]) => key));
  });

  protected readonly sharedSlotRows = computed<SlotRow[]>(() => {
    const shared = this.sharedSlotKeys();
    const seen = new Set<string>();
    const rows: SlotRow[] = [];
    for (const block of this.sheet()?.spellcasting ?? []) {
      const key = slotRowKey(block.slots);
      if (shared.has(key) && !seen.has(key)) {
        seen.add(key);
        rows.push(block.slots);
      }
    }
    return rows;
  });

  protected readonly blocks = computed<SpellBlockView[]>(() => {
    const shared = this.sharedSlotKeys();
    return (this.sheet()?.spellcasting ?? []).map((block) => ({
      ...block,
      className: this.names.resolve(block.classId),
      knownSpells: block.known.map((id) => this.names.spellRow(id)),
      preparedSpells: block.prepared.map((id) => this.names.spellRow(id)),
      slotsShared: shared.has(slotRowKey(block.slots)),
    }));
  });

  protected icon(spell: SpellRow): string {
    return this.names.iconOf(spell.id, 'ui:spells');
  }

  protected isPrepared(block: SpellcastingBlock, spellId: string): boolean {
    return block.prepared.includes(spellId);
  }

  protected isAlwaysPrepared(block: SpellcastingBlock, spellId: string): boolean {
    return block.alwaysPrepared?.includes(spellId) ?? false;
  }

  /** `block.prepared` INCLUDES always-prepared grants, which do not count against the cap. */
  protected preparedCount(block: SpellcastingBlock): number {
    return block.prepared.length - (block.alwaysPrepared?.length ?? 0);
  }

  protected seals(max: number): number[] {
    return Array.from({ length: max }, (_, i) => i);
  }

  /** A seal is filled while its slot is still available (the first `max - used` of the row). */
  protected available(max: number, used: number, index: number): boolean {
    return index < max - used;
  }

  protected cast(block: SpellcastingBlock, spell: SpellRow): void {
    if (spell.level === 0) {
      this.actions.castCantrip(spell.id, spell.concentration);
      return;
    }
    void this.actions.castLeveled(block, spell, (resource) => this.names.resourceLabel(resource));
  }

  protected rollSpellAttack(block: SpellBlockView, t: ScopedT): void {
    this.rolls.rollSpellAttack(block.className, block.attack.value, t);
  }
}
