import { Component, input, output } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * `hk-inspiration-toggle` — the heroic-inspiration toggle as a header icon button: pressed means
 * available and pressing it spends it; unpressed means none and pressing it marks a grant.
 *
 * It reports intent only: `activeChange` carries the next state. `disabledReason` (translated) blocks
 * the control while keeping it focusable; the reason lives in the hint, never beside the toggle.
 */
@Component({
  selector: 'hk-inspiration-toggle',
  imports: [TranslocoDirective, IconComponent, HkTooltipDirective],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './inspiration-toggle.component.html',
  styleUrl: './inspiration-toggle.component.scss',
})
export class HkInspirationToggleComponent {
  // Inputs
  readonly active = input.required<boolean>();
  /** Translated reason the toggle is blocked; `null` when it can be pressed. */
  readonly disabledReason = input<string | null>(null);
  /** Optional translated explanation shown before the press hint. */
  readonly explain = input<string | null>(null);

  // Outputs
  readonly activeChange = output<boolean>();

  protected press(): void {
    if (this.disabledReason()) return;
    this.activeChange.emit(!this.active());
  }
}
