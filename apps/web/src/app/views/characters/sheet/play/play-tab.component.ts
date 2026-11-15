import { Component, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { AttacksLeafComponent } from './attacks-leaf/attacks-leaf.component';
import { BagLeafComponent } from './bag-leaf/bag-leaf.component';
import { ConditionsLeafComponent } from './conditions-leaf/conditions-leaf.component';
import { FeaturesLeafComponent } from './features-leaf/features-leaf.component';
import { ProficienciesLeafComponent } from './proficiencies-leaf/proficiencies-leaf.component';
import { ResourcesLeafComponent } from './resources-leaf/resources-leaf.component';
import { SpellsLeafComponent } from './spells-leaf/spells-leaf.component';

/**
 * `/c/:id/play` on tablet and desktop — the Play tab beside the shell's folio (board `Main`): the
 * centre column (attacks, resources, conditions with death saves and inspiration, features,
 * proficiencies) and the right column (spells, bag). It composes the leaves and holds no logic of
 * its own; the folio's vitals, abilities and skills are placed by the shell, and the phone's
 * Combat · Spells · Bag · Hero tabs compose these same leaves.
 */
@Component({
  selector: 'app-play-tab',
  imports: [
    TranslocoDirective,
    AttacksLeafComponent,
    ResourcesLeafComponent,
    ConditionsLeafComponent,
    FeaturesLeafComponent,
    ProficienciesLeafComponent,
    SpellsLeafComponent,
    BagLeafComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  template: `
    <div class="play-tab" [attr.data-section]="section()" *transloco="let t; read: 'characters'">
      <!-- Tablet only (768-1199 px, board IA-Sheet-Tablet): one column at a time. Hidden from 1200 px up. -->
      <div
        class="play-tab__sections"
        role="tablist"
        [attr.aria-label]="t('sheet.play.sections.label')"
      >
        @for (id of sections; track id) {
          <button
            type="button"
            role="tab"
            class="play-tab__section"
            [attr.aria-selected]="section() === id"
            [tabindex]="section() === id ? 0 : -1"
            (click)="section.set(id)"
          >
            {{
              id === 'combat' ? t('sheet.play.sections.combat') : t('sheet.play.sections.spellsBag')
            }}
          </button>
        }
      </div>
      <div class="play-tab__column play-tab__column--centre">
        <app-attacks-leaf />
        <app-resources-leaf />
        <app-conditions-leaf />
        <app-features-leaf />
        <app-proficiencies-leaf />
      </div>
      <div class="play-tab__column play-tab__column--side">
        <app-spells-leaf />
        <app-bag-leaf />
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .play-tab {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-4);
      align-items: start;
    }

    .play-tab__column {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      min-inline-size: 0;
    }

    .play-tab__sections {
      display: flex;
      gap: var(--space-1);
      grid-column: 1 / -1;
    }

    .play-tab__section {
      flex: 0 1 auto;
      min-block-size: var(--touch-target, 44px);
      padding: 0 var(--space-4);
      border: 0;
      border-radius: var(--radius-s) var(--radius-s) 0 0;
      background: linear-gradient(180deg, var(--leather-light), var(--leather));
      box-shadow: inset 0 0 0 1px var(--border-brass);
      color: var(--text-on-leather);
      font-family: var(--font-display);
      font-size: 1rem;
      cursor: pointer;

      &:focus-visible {
        outline: 2px solid var(--focus-ring);
        outline-offset: 2px;
      }

      &[aria-selected='true'] {
        background: linear-gradient(180deg, var(--brass-top), var(--brass));
        color: var(--text-on-brass);
      }
    }

    /* Below 1200 px only the chosen section shows. */
    .play-tab[data-section='combat'] .play-tab__column--side,
    .play-tab[data-section='spells'] .play-tab__column--centre {
      display: none;
    }

    @media (min-width: 1200px) {
      .play-tab__sections {
        display: none;
      }

      .play-tab[data-section] .play-tab__column {
        display: flex;
      }

      .play-tab {
        grid-template-columns: minmax(0, 560fr) minmax(0, 460fr);
      }
    }
  `,
})
export class PlayTabComponent {
  protected readonly sections = ['combat', 'spells'] as const;
  protected readonly section = signal<(typeof this.sections)[number]>('combat');
}
