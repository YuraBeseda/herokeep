import { Component, computed, inject, input, output } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '@shared/icons/icon.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { HkSpellRowComponent } from '../../../../ui/spell-row/spell-row.component';
import { HkTagChipComponent } from '../../../../ui/tag-chip/tag-chip.component';
import { HkTooltipDirective } from '../../../../ui/tooltip/tooltip.directive';
import { HkWaxSealComponent } from '../../../../ui/wax-seal/wax-seal.component';

let nextSpellReasonId = 0;

/**
 * One spell of the spells step: a tick seal you press to learn / prepare it, the spell's row (glyph,
 * name, the concentration orb, a ritual chip) and an info button that opens its description.
 *
 * The tick seal is the single marker for known, in the book and prepared; what it means is its hint
 * ("Known cantrip", "Prepared"). A capped or always-prepared row cannot be toggled; the reason is the
 * toggle's hint, never text on the row.
 */
@Component({
  selector: 'hk-spell-pick-row',
  imports: [
    TranslocoDirective,
    HkSpellRowComponent,
    HkTagChipComponent,
    HkTooltipDirective,
    HkWaxSealComponent,
    IconComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './spell-pick-row.component.html',
  styleUrl: './spell-pick-row.component.scss',
})
export class SpellPickRowComponent {
  private readonly engineFacade = inject(EngineFacade);

  // Inputs / Outputs
  readonly spellId = input.required<string>();
  readonly chosen = input(false);
  /** What the tick means for this row ("Known cantrip", "Prepared"). */
  readonly chosenHint = input.required<string>();
  /** Why the row cannot change now (cap reached, granted), or null. */
  readonly blockedReason = input<string | null>(null);
  /** Set for a spell the class always has prepared: the hint naming where it comes from. */
  readonly alwaysPrepared = input<string | null>(null);
  readonly toggled = output<void>();
  readonly details = output<HTMLElement>();

  protected readonly entity = computed(() => {
    const entity = this.engineFacade.index().get(this.spellId());
    return entity?.type === 'spell' ? entity : undefined;
  });
  protected readonly name = computed(() => this.engineFacade.localizer().name(this.spellId()));
  protected readonly icon = computed(() => {
    const entity = this.entity();
    return entity ? this.engineFacade.iconFor(entity) : 'ui:spells';
  });
  /** The name reflects the real state: the hint ("Known cantrip") only once it is true. */
  protected readonly toggleLabel = computed(() =>
    this.chosen() ? `${this.name()} — ${this.chosenHint()}` : this.name(),
  );
  protected readonly reasonId = `spell-pick-reason-${nextSpellReasonId++}`;
}
