import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CharacterStore } from '@shared/stores/character.store';
import { AbilitiesLeafComponent } from '../abilities-leaf/abilities-leaf.component';
import { AttacksLeafComponent } from '../attacks-leaf/attacks-leaf.component';
import { BagLeafComponent } from '../bag-leaf/bag-leaf.component';
import { ConditionsLeafComponent } from '../conditions-leaf/conditions-leaf.component';
import { FeaturesLeafComponent } from '../features-leaf/features-leaf.component';
import { ProficienciesLeafComponent } from '../proficiencies-leaf/proficiencies-leaf.component';
import { ResourcesLeafComponent } from '../resources-leaf/resources-leaf.component';
import { SpellsLeafComponent } from '../spells-leaf/spells-leaf.component';
import { VitalsLeafComponent } from '../vitals-leaf/vitals-leaf.component';
import { SheetChromeService } from '../../sheet-chrome.service';

/**
 * The phone's tabs (`/c/:id/{combat,spells,bag,hero,more}`, boards `A2-Phone` and `H-Hero-Phone`).
 * Each tab is a plain composition of the leaves the desktop Play tab and folio also compose — one
 * component per leaf, never a copy per width — and holds no logic of its own, except `more`, which
 * is a list of links and actions.
 */
const STACK = `
  :host {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-inline-size: 0;
  }
`;

/** Combat: HP, AC / initiative / speed, saves, attacks, resources, conditions, death saves,
 * inspiration — in that DOM order. */
@Component({
  selector: 'app-combat-tab',
  imports: [
    VitalsLeafComponent,
    AbilitiesLeafComponent,
    AttacksLeafComponent,
    ResourcesLeafComponent,
    ConditionsLeafComponent,
  ],
  template: `
    <app-vitals-leaf [compact]="true" />
    <app-abilities-leaf [mode]="'saves'" [phone]="true" />
    <app-attacks-leaf [phone]="true" />
    <app-resources-leaf [phone]="true" />
    <app-conditions-leaf [phone]="true" />
  `,
  styles: STACK,
})
export class CombatTabComponent {}

/** Spells: the slot seals, the pact lane, the prepared and known lists. */
@Component({
  selector: 'app-spells-tab',
  imports: [SpellsLeafComponent],
  template: `<app-spells-leaf [phone]="true" />`,
  styles: STACK,
})
export class SpellsTabComponent {}

/** Bag: the ledger of item rows, the selected item's actions, the coin pouch and the weight strap. */
@Component({
  selector: 'app-bag-tab',
  imports: [BagLeafComponent],
  template: `<app-bag-leaf [phone]="true" />`,
  styles: STACK,
})
export class BagTabComponent {}

/** Hero: abilities with their saves and skills, proficiencies, languages and features. */
@Component({
  selector: 'app-hero-tab',
  imports: [AbilitiesLeafComponent, ProficienciesLeafComponent, FeaturesLeafComponent],
  template: `
    <app-abilities-leaf [mode]="'full'" [showPassive]="true" [phone]="true" />
    <app-proficiencies-leaf [phone]="true" />
    <app-features-leaf [phone]="true" />
  `,
  styles: STACK,
})
export class HeroTabComponent {}

/** More: Build, Timeline, Notes, Roll log, Content packs, Export and — when XP allows it — Level
 * up. The wake-lock toggle lives here too, since the phone's folio has no room for it. */
@Component({
  selector: 'app-more-tab',
  imports: [TranslocoDirective, RouterLink],
  providers: [provideTranslocoScope('characters')],
  template: `
    <ng-container *transloco="let t; read: 'characters'">
      <ul class="more">
        <li>
          <a class="more__row more__build" routerLink="../build">{{ t('sheet.tabs.build') }}</a>
        </li>
        <li>
          <a class="more__row more__timeline" routerLink="../timeline">{{
            t('sheet.tabs.timeline')
          }}</a>
        </li>
        <li>
          <button
            type="button"
            class="more__row more__notes"
            (click)="chrome.openNotes($any($event.currentTarget))"
          >
            {{ t('sheet.notes.title') }}
          </button>
        </li>
        <li>
          <button
            type="button"
            class="more__row more__roll-log"
            (click)="chrome.openRollLog($any($event.currentTarget))"
          >
            {{ t('sheet.roll.logTitle') }}
          </button>
        </li>
        <li>
          <a class="more__row more__packs" routerLink="/packs">{{ t('sheet.more.packs') }}</a>
        </li>
        <li>
          <button
            type="button"
            class="more__row more__export"
            [attr.aria-disabled]="chrome.exporting()"
            (click)="chrome.exportHero(t)"
          >
            {{ t('sheet.header.export') }}
          </button>
        </li>
        @if (levelUpAvailable()) {
          <li>
            <a class="more__row more__level-up" routerLink="../level-up">{{
              t('sheet.header.levelUp')
            }}</a>
          </li>
        }
      </ul>
    </ng-container>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    .more {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .more__row {
      display: flex;
      align-items: center;
      box-sizing: border-box;
      inline-size: 100%;
      min-block-size: 52px;
      padding: 0 var(--space-4);
      border: 0;
      border-radius: var(--radius-frame);
      background: linear-gradient(180deg, var(--leather-light), var(--leather));
      box-shadow: inset 0 0 0 1px var(--border-brass);
      color: var(--text-on-leather);
      font: inherit;
      font-family: var(--font-display);
      text-align: start;
      text-decoration: none;
      cursor: pointer;

      &:focus-visible {
        outline: 2px solid var(--focus-ring);
        outline-offset: 2px;
      }
    }
  `,
})
export class MoreTabComponent {
  protected readonly chrome = inject(SheetChromeService);
  private readonly characterStore = inject(CharacterStore);

  /** Level up appears only when XP allows it, as on desktop. */
  protected readonly levelUpAvailable = () => this.characterStore.advancements().length > 0;
}
