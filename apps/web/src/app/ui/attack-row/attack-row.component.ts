import { Component, computed, input, output } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkButtonComponent } from '../button/button.component';
import { coarsePointer } from '../coarse-pointer';
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
    HkButtonComponent,
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
  readonly roll = output<void>();
  /** To-hit and damage become activatable (keyboard too) so a caller can show how they are built. */
  readonly inspectable = input(false);
  readonly inspect = output<'hit' | 'damage'>();

  protected press(kind: 'hit' | 'damage', event: Event): void {
    if (!this.inspectable()) return;
    event.preventDefault();
    this.inspect.emit(kind);
  }

  private readonly coarse = coarsePointer();
  protected readonly buttonSize = computed(() => (this.coarse() ? 'phone' : 'm'));
  protected readonly toHitText = computed(() => signed(this.toHit()));
}
