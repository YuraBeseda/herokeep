import { Component, computed, inject, input, resource } from '@angular/core';
import type { Entity } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { HkTagChipComponent } from '../tag-chip/tag-chip.component';

type Spell = Extract<Entity, { type: 'spell' }>;

const DICE_RE = /^(\d+)d(\d+)$/;
const MAX_SLOT = 9;

/** One chip: the i18n key of its label and that label's params. */
interface Chip {
  readonly key: string;
  readonly params: Record<string, string | number>;
}

/** The chips a spell's parsed `higherLevelDice` yields; a per-slot total needs the same die as the base damage. */
function chipsFor(spell: Spell): readonly Chip[] {
  const dice = spell.higherLevelDice;
  if (!dice) return [];
  if ('cantrip' in dice) {
    return dice.cantrip.map((row) => ({
      key: 'detail.cantripLevel',
      params: { level: row.level, dice: row.dice },
    }));
  }
  const { dice: step, aboveLevel } = dice.perSlot;
  const [, baseCount, baseDie] = DICE_RE.exec(spell.damage?.dice ?? '') ?? [];
  const [, addCount, addDie] = DICE_RE.exec(step) ?? [];
  if (!baseCount || !addCount || baseDie !== addDie) {
    return [{ key: 'detail.perSlot', params: { dice: step, level: aboveLevel } }];
  }
  const slots = Array.from({ length: MAX_SLOT - aboveLevel }, (_, i) => aboveLevel + 1 + i);
  return slots.map((slot) => ({
    key: 'detail.slotTotal',
    params: {
      slot,
      dice: `${Number(baseCount) + (slot - aboveLevel) * Number(addCount)}d${baseDie}`,
    },
  }));
}

/**
 * `hk-spell-higher-levels` — the "At higher levels" section of a spell: the SRD text plus the
 * chips the content transform parsed into `higherLevelDice`. Renders nothing for a spell with no
 * `higherLevels` text; shared by the library detail page and the description drawer.
 */
@Component({
  selector: 'hk-spell-higher-levels',
  imports: [TranslocoDirective, HkTagChipComponent],
  providers: [provideTranslocoScope('library')],
  template: `
    @if (html.value(); as body) {
      <section class="hk-higher-levels" *transloco="let t; read: 'library'">
        <h3 class="hk-higher-levels__title">{{ t('detail.higherLevels') }}</h3>
        <div [innerHTML]="body"></div>
        @if (chips().length > 0) {
          <ul class="hk-higher-levels__chips">
            @for (chip of chips(); track chip.key + chip.params['slot'] + chip.params['level']) {
              <li><hk-tag-chip [label]="t(chip.key, chip.params)" /></li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: `
    .hk-higher-levels__title {
      font-size: var(--hk-text-md, 1rem);
      margin: var(--hk-space-3, 0.75rem) 0 var(--hk-space-1, 0.25rem);
    }
    .hk-higher-levels__chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--hk-space-1, 0.25rem);
      list-style: none;
      margin: 0;
      padding: 0;
    }
  `,
})
export class HkSpellHigherLevelsComponent {
  private readonly engineFacade = inject(EngineFacade);
  private readonly markdownService = inject(MarkdownService);

  readonly spell = input.required<Spell>();

  protected readonly chips = computed(() => chipsFor(this.spell()));
  protected readonly html = resource({
    params: () => this.engineFacade.localizer().text(this.spell().id, 'higherLevels').text,
    loader: async ({ params }) =>
      params ? this.markdownService.render(params, this.engineFacade.localizer()) : undefined,
  });
}
