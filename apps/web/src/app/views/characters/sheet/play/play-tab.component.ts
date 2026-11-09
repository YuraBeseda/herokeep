import { Component } from '@angular/core';
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
    AttacksLeafComponent,
    ResourcesLeafComponent,
    ConditionsLeafComponent,
    FeaturesLeafComponent,
    ProficienciesLeafComponent,
    SpellsLeafComponent,
    BagLeafComponent,
  ],
  template: `
    <div class="play-tab">
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

    @media (min-width: 1200px) {
      .play-tab {
        grid-template-columns: minmax(0, 560fr) minmax(0, 460fr);
      }
    }
  `,
})
export class PlayTabComponent {}
