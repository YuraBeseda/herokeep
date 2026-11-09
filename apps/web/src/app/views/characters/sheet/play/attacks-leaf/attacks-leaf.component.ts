import { Component, computed, inject, input } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { DerivedValue } from '@shared/directives/derived-popover.directive';
import { CharacterStore } from '@shared/stores/character.store';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import {
  HkAttackRowComponent,
  type AttackTag,
} from '../../../../../ui/attack-row/attack-row.component';
import { HkButtonComponent } from '../../../../../ui/button/button.component';
import { HkLeafComponent } from '../../../../../ui/leaf/leaf.component';
import type { DamageInk } from '../../../../../ui/tag-chip/damage-type';
import { signed } from '../../../../../ui/format';
import { breakdownOpener } from '../open-breakdown';
import { PlayRollsService, type ScopedT } from '../play-rolls.service';
import { sheetNames } from '../play-names';

const DAMAGE_INKS: ReadonlySet<string> = new Set<DamageInk>([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);

interface AttackView {
  readonly instanceId: string;
  readonly name: string;
  readonly icon: string;
  readonly toHit: number;
  readonly toHitDerived: DerivedValue;
  readonly bonusDerived: DerivedValue;
  readonly dice: string;
  readonly bonus: number;
  readonly damageText: string;
  readonly damageType: { label: string; damage?: DamageInk };
  readonly tags: AttackTag[];
}

/**
 * Attacks (spec §4.2): `hk-attack-row` per weapon — ring glyph, to-hit and damage numerals, the
 * damage type as a tinted tag, property / mastery chips and a Roll (to hit) button — plus a
 * "Roll damage" button under each row. Every number is the row's already-derived value; nothing
 * is recomputed here. Rolling stays enabled under the campaign edit lock (ruling 7).
 */
@Component({
  selector: 'app-attacks-leaf',
  imports: [TranslocoDirective, HkLeafComponent, HkAttackRowComponent, HkButtonComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './attacks-leaf.component.html',
  styleUrl: './attacks-leaf.component.scss',
})
export class AttacksLeafComponent {
  readonly phone = input(false);

  private readonly rolls = inject(PlayRollsService);
  private readonly names = sheetNames(inject(EngineFacade));
  private readonly sheet = inject(CharacterStore).sheet;

  protected readonly attacks = computed<AttackView[]>(() =>
    (this.sheet()?.attacks ?? []).map((row) => {
      const type = row.damage.type;
      const bonus = row.damage.bonus.value;
      return {
        instanceId: row.instanceId,
        name: this.names.resolve(row.name),
        icon: this.names.iconOf(row.itemId, 'ui:attacks'),
        toHit: row.toHit.value,
        toHitDerived: row.toHit,
        bonusDerived: row.damage.bonus,
        dice: row.damage.dice,
        bonus,
        damageText: `${row.damage.dice}${bonus === 0 ? '' : signed(bonus)}`,
        damageType: {
          label: this.names.damageTypeName(type),
          ...(DAMAGE_INKS.has(type) ? { damage: type as DamageInk } : {}),
        },
        tags: [
          ...row.properties.map((property) => ({ label: this.names.resolve(property) })),
          ...(row.mastery
            ? [
                {
                  label: this.names.resolve(row.mastery),
                  icon: 'ui:mastery',
                  tone: 'arcane' as const,
                },
              ]
            : []),
        ],
      };
    }),
  );

  protected readonly openBreakdown = breakdownOpener();

  protected rollToHit(attack: AttackView, t: ScopedT): void {
    this.rolls.rollAttackToHit(attack.name, attack.toHit, t);
  }

  protected rollDamage(attack: AttackView, t: ScopedT): void {
    this.rolls.rollAttackDamage(attack.name, attack.dice, attack.bonus, t);
  }
}
