import { Component, computed, input, output } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { HkIconButtonComponent } from '../icon-button/icon-button.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { HkWaxSealComponent } from '../wax-seal/wax-seal.component';

export type DeathSaveKind = 'success' | 'failure';
const RINGS = [0, 1, 2] as const;

/**
 * `hk-death-saves` — the death-save tracker (design-system DeathSaves): a Successes row and a
 * Failures row of three toggle buttons, each a `hk-wax-seal` that is filled when marked and spent
 * otherwise, plus a Roll button. Successes and failures differ by glyph (check / cross), by row
 * word and by hint, not by colour alone.
 *
 * It displays the counts it is given and reports intent: `ringToggle` carries the pressed ring,
 * `roll` the Roll press. What a mark, a natural 20 or a third failure means is the caller's.
 */
@Component({
  selector: 'hk-death-saves',
  imports: [TranslocoDirective, HkIconButtonComponent, HkTooltipDirective, HkWaxSealComponent],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './death-saves.component.html',
  styleUrl: './death-saves.component.scss',
})
export class HkDeathSavesComponent {
  // Inputs
  readonly successes = input.required<number>();
  readonly failures = input.required<number>();

  // Outputs
  readonly ringToggle = output<{ kind: DeathSaveKind; index: number }>();
  readonly roll = output<void>();

  protected readonly rings = RINGS;
  protected readonly kinds: readonly DeathSaveKind[] = ['success', 'failure'];
  protected readonly marked = computed(() => ({
    success: Math.min(3, Math.max(0, this.successes())),
    failure: Math.min(3, Math.max(0, this.failures())),
  }));
}
