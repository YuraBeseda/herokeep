import { Component, computed, inject, input } from '@angular/core';
import { propose, type CharacterOptions } from '@hk/engine';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CharacterStore } from '@shared/stores/character.store';
import { HkLeafComponent } from '../../../../ui/leaf/leaf.component';
import { HkTagChipComponent } from '../../../../ui/tag-chip/tag-chip.component';

type EncumbranceOption = NonNullable<CharacterOptions['encumbrance']>;

// Plan 14 (phase 4 slice 4) Task 5, design ruling 8 — the per-character encumbrance select. Static
// keys (the keys-manager detective cannot see concatenated ones); wording mirrors the campaign
// settings' own `settings.houseRules.encumbrance.*`.
const ENCUMBRANCE_OPTIONS: readonly { value: EncumbranceOption; labelKey: string }[] = [
  { value: 'off', labelKey: 'sheet.options.encumbrance.off' },
  { value: 'standard', labelKey: 'sheet.options.encumbrance.standard' },
  { value: 'variant', labelKey: 'sheet.options.encumbrance.variant' },
];

/**
 * Board B01, "Rule options": the character's own `character.options.set@1` (stored on
 * `sheet().options`, absent = 'off'). A campaign house rule — `CharacterStore.campaignOverrides()
 * .encumbrance`, any defined value, even 'off' — wins over it in `derive()`: the select then SHOWS
 * that effective value, disabled, with a "campaign rule" chip whose tooltip carries the reason and
 * a visually hidden copy the select is described by (plan 13's disabled-with-reason pattern; the
 * reason is a hint, never printed beside the control).
 */
@Component({
  selector: 'app-build-options-section',
  imports: [TranslocoDirective, HkLeafComponent, HkTagChipComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './build-options-section.component.html',
  styleUrl: './build-options-section.component.scss',
})
export class BuildOptionsSectionComponent {
  private readonly store = inject(CharacterStore);

  // Inputs
  /** The campaign edit lock (`BuildTabComponent.editLocked`). */
  readonly disabled = input(false);

  protected readonly encumbranceOptions = ENCUMBRANCE_OPTIONS;
  protected readonly encumbranceReasonId = 'build-tab-options-encumbrance-reason';
  protected readonly encumbranceHouseRule = computed<EncumbranceOption | undefined>(
    () => this.store.campaignOverrides().encumbrance,
  );
  protected readonly encumbranceValue = computed<EncumbranceOption>(
    () => this.encumbranceHouseRule() ?? this.store.sheet()?.options?.encumbrance ?? 'off',
  );

  protected onEncumbranceChange(value: string): void {
    const sheet = this.store.sheet();
    const option = ENCUMBRANCE_OPTIONS.find((o) => o.value === value);
    if (!sheet || !option || this.encumbranceHouseRule() !== undefined || this.disabled()) return;
    const drafts = propose.setOptions(sheet, { encumbrance: option.value });
    if (drafts.length === 0) return;
    void this.store.appendTx(drafts);
  }
}
