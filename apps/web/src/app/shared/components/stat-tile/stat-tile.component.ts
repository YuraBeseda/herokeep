import { Component, input } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

// Deliberately plain: the sheet attaches a provenance attribute directive (`hkDerived`,
// task T10) straight onto the `<hk-stat-tile>` host tag for stats that need a "why" popover.
// This component knows nothing about that directive — it just renders label/value/sub, so
// nothing here needs to change when T10 lands.
@Component({
  selector: 'hk-stat-tile',
  imports: [TranslocoDirective],
  templateUrl: './stat-tile.component.html',
  styleUrl: './stat-tile.component.scss',
  host: {
    '[class.hk-stat-tile--emphasized]': 'emphasized()',
  },
})
export class StatTileComponent {
  // Inputs
  readonly labelKey = input.required<string>();
  readonly value = input.required<number | string>();
  readonly sub = input<string | undefined>(undefined);
  readonly emphasized = input(false);
}
