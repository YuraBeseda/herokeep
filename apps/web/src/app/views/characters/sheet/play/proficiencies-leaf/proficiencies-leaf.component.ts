import { Component, computed, inject, input } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CharacterStore } from '@shared/stores/character.store';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { HkLeafComponent } from '../../../../../ui/leaf/leaf.component';
import { HkTagChipComponent } from '../../../../../ui/tag-chip/tag-chip.component';
import { sheetNames } from '../play-names';

/**
 * Proficiencies (armor / weapon / language-of-skill rows), tools, senses and languages as chip
 * groups (spec §4.2, board `H-Hero-Phone`). Every name is pack text resolved through the
 * localizer; a target the index does not resolve (the weapon-category slug `martial`) falls back
 * to its raw slug.
 */
@Component({
  selector: 'app-proficiencies-leaf',
  imports: [TranslocoDirective, HkLeafComponent, HkTagChipComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './proficiencies-leaf.component.html',
  styleUrl: './proficiencies-leaf.component.scss',
})
export class ProficienciesLeafComponent {
  readonly phone = input(false);

  private readonly names = sheetNames(inject(EngineFacade));
  private readonly sheet = inject(CharacterStore).sheet;

  protected readonly proficiencyRows = computed(() =>
    (this.sheet()?.proficiencies ?? [])
      .filter((p) => p.kind !== 'tool')
      .map((p) => ({ kind: p.kind, target: this.names.resolve(p.target), level: p.level })),
  );

  // Plan 13 task 2: tool proficiencies (`kind: 'tool'` rows) listed on their own; a tool target is
  // an item SLUG resolved to the pack's item name, falling back to the raw slug.
  protected readonly toolRows = computed(() =>
    (this.sheet()?.proficiencies ?? [])
      .filter((p) => p.kind === 'tool')
      .map((p) => ({ target: p.target, name: this.names.toolName(p.target) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  protected readonly senseRows = computed(() =>
    (this.sheet()?.senses ?? []).map((s) => ({
      sense: this.names.resolve(s.sense),
      range: s.range,
    })),
  );

  protected readonly languageRows = computed(() =>
    (this.sheet()?.languages ?? []).map((l) => this.names.resolve(l.id)),
  );
}
