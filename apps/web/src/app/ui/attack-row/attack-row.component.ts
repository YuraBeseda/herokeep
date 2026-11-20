import { Component, computed, input, output } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkMenuButtonComponent } from '../context-menu/menu-button.component';
import type { HkMenuItem } from '../context-menu/context-menu.types';
import { signed } from '../format';
import { HkTagChipComponent, type TagChipTone } from '../tag-chip/tag-chip.component';
import type { DamageInk } from '../tag-chip/damage-type';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

export interface AttackTag {
  /** Translated label ("versatile 1d10", "Sap", "equipped"). */
  readonly label: string;
  readonly tone?: TagChipTone;
  readonly icon?: string;
  /** Translated hint, such as "Weapon mastery: Sap". */
  readonly hint?: string;
}

/**
 * `hk-attack-row` — one attack (design-system AttackRow): a leather ring with the weapon's own
 * glyph, the name, to-hit and damage numerals, the damage type as a tinted tag, property /
 * mastery / equipped chips under them and a brass Roll button that emits `roll`.
 *
 * Rendering only: to-hit, damage and tags arrive computed; texts are already translated.
 * `attuned` is the hint of the gem shown beside a magic weapon's name (`null` for none).
 */
@Component({
  selector: 'hk-attack-row',
  imports: [
    TranslocoDirective,
    IconComponent,
    HkMenuButtonComponent,
    HkTagChipComponent,
    HkTooltipDirective,
  ],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './attack-row.component.html',
  styleUrl: './attack-row.component.scss',
})
export class HkAttackRowComponent {
  // Inputs
  readonly name = input.required<string>();
  /** The weapon's own glyph (`gi:<slug>`), never an action glyph. */
  readonly icon = input.required<string>();
  readonly toHit = input.required<number>();
  /** Damage expression as displayed ("1d8+3"). */
  readonly damage = input.required<string>();
  readonly damageType = input<{ label: string; damage?: DamageInk } | null>(null);
  readonly tags = input<readonly AttackTag[]>([]);
  readonly attuned = input<string | null>(null);

  // Outputs
  /** To-hit roll (menu: "Attack roll"). */
  readonly roll = output<void>();
  readonly rollDamage = output<void>();
  /** To-hit and damage become activatable (keyboard too) so a caller can show how they are built. */
  readonly inspectable = input(false);
  readonly inspect = output<'hit' | 'damage'>();

  protected press(kind: 'hit' | 'damage', event: Event): void {
    if (!this.inspectable()) return;
    event.preventDefault();
    this.inspect.emit(kind);
  }

  /** The dice menu; also bound by the caller to `[hkContextMenu]` on the row (`#row`). */
  readonly menuItems = (): HkMenuItem[] => [
    {
      id: 'hit',
      labelKey: 'shell.ui.attack.menu.hit',
      icon: 'ui:roll',
      detail: this.toHitText(),
      run: () => this.roll.emit(),
    },
    {
      id: 'damage',
      labelKey: 'shell.ui.attack.menu.damage',
      icon: 'ui:roll',
      detail: [this.damage(), this.damageType()?.label].filter(Boolean).join(' '),
      run: () => this.rollDamage.emit(),
    },
  ];

  protected readonly toHitText = computed(() => signed(this.toHit()));
}
