import { Component, computed, inject, input } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CharacterStore } from '@shared/stores/character.store';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { HkButtonComponent } from '../../../../../ui/button/button.component';
import { HkConditionChipComponent } from '../../../../../ui/condition-chip/condition-chip.component';
import {
  HkDeathSavesComponent,
  type DeathSaveKind,
} from '../../../../../ui/death-saves/death-saves.component';
import { HkInspirationToggleComponent } from '../../../../../ui/inspiration-toggle/inspiration-toggle.component';
import { HkLeafComponent } from '../../../../../ui/leaf/leaf.component';
import { HkTagChipComponent } from '../../../../../ui/tag-chip/tag-chip.component';
import { PlayActionsService } from '../play-actions.service';
import { PlayRollsService, type ScopedT } from '../play-rolls.service';
import { sheetNames } from '../play-names';

interface ListedSource {
  readonly id: string;
  readonly name: string;
  readonly sources: string;
}

/**
 * Conditions, immunities, resistances, death saves and heroic inspiration (spec §4.2, the Combat
 * tab's last three blocks). Conditions are chips (a level badge for exhaustion-style conditions;
 * the duration badge is the slice-2 data slot and stays empty) with Add condition beside them.
 * The death-save rings and the two critical buttons record through `propose.deathSave` — the
 * engine owns what a ring or a natural 20 means.
 */
@Component({
  selector: 'app-conditions-leaf',
  imports: [
    TranslocoDirective,
    HkLeafComponent,
    HkConditionChipComponent,
    HkButtonComponent,
    HkTagChipComponent,
    HkDeathSavesComponent,
    HkInspirationToggleComponent,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './conditions-leaf.component.html',
  styleUrl: './conditions-leaf.component.scss',
})
export class ConditionsLeafComponent {
  readonly phone = input(false);

  protected readonly actions = inject(PlayActionsService);
  private readonly rolls = inject(PlayRollsService);
  private readonly engineFacade = inject(EngineFacade);
  private readonly names = sheetNames(this.engineFacade);
  protected readonly sheet = inject(CharacterStore).sheet;

  protected readonly conditions = computed(() =>
    (this.sheet()?.conditions ?? []).map((c) => ({
      id: c.conditionId,
      name: this.names.resolve(c.conditionId),
      level: c.level ?? null,
      icon: this.names.iconOf(c.conditionId, 'ui:condition'),
      // Run out (0 rounds left) reads the same as an ended condition.
      ended: c.ended === true || (c.remaining?.kind === 'rounds' && c.remaining.value === 0),
      // A rounds badge: the clock's remaining count, else the full duration (no clock yet).
      rounds:
        c.remaining?.kind === 'rounds'
          ? c.remaining.value
          : c.duration?.kind === 'rounds'
            ? c.duration.amount
            : null,
    })),
  );

  // Plan 13 task 5: `sheet.immunities` (display-only) — each immune condition's localized name plus
  // the localized names of the features granting it.
  protected readonly immunities = computed<ListedSource[]>(() =>
    (this.sheet()?.immunities ?? []).map((i) => ({
      id: i.condition,
      name: this.names.resolve(i.condition),
      sources: i.sources.map((source) => this.names.resolve(source)).join(', '),
    })),
  );

  // Plan 14 Task 6: `sheet.resistances` (display-only), named through `rule/damage-type-<slug>`.
  protected readonly resistances = computed<ListedSource[]>(() =>
    (this.sheet()?.resistances ?? []).map((r) => ({
      id: r.type,
      name: this.names.damageTypeName(r.type),
      sources: r.sources.map((source) => this.names.resolve(source)).join(', '),
    })),
  );

  protected addCondition(): void {
    void this.actions.addCondition(this.names.conditionOptions());
  }

  /** Death-save rings only ever add the NEXT mark (the engine has no un-mark event). */
  protected onRing(event: { kind: DeathSaveKind; index: number }, marked: number): void {
    if (event.index < marked) return;
    this.actions.deathSave(event.kind);
  }

  protected rollDeathSave(t: ScopedT): void {
    this.rolls.rollPlainSave(t('sheet.hp.deathSaveRollName'), t);
  }
}
