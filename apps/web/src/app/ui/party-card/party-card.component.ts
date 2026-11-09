import { Component, computed, input, output } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkConditionChipComponent } from '../condition-chip/condition-chip.component';
import { fieldId } from '../forms/value-accessor';
import { HkPortraitFrameComponent } from '../portrait-frame/portrait-frame.component';
import { HkShieldBadgeComponent } from '../shield-badge/shield-badge.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

/** One active condition on a party member, already resolved by the caller. */
export interface PartyCondition {
  readonly id: string;
  /** Translated name. */
  readonly name: string;
  /** A sprite id; defaults to the skull. */
  readonly icon?: string;
  readonly level?: number | null;
  /** Translated duration text; the slice-2 slot, empty until it is filled. */
  readonly duration?: string | null;
  /** Translated full story for the chip's hint. */
  readonly hint?: string | null;
}

/** Share of the track for `part`, as a percentage clamped to 0..100. */
function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

/**
 * `hk-party-card` — one party member on the campaign's Party tab (design-system PartyCard):
 * portrait, name (with the concentration orb while concentrating), class and player line, AC
 * shield, a slim HP strap, the member's condition chips and the inspiration mark.
 *
 * It displays what it is given and emits `open`. Quick-effect chips (the DM's Damage, Heal, Temp
 * HP … row) are the projected `[hkPartyFx]` slot, filled by the campaign view; with nothing
 * projected the row is not shown. `subtitle` and `dyingHint` are translated text built by the
 * caller. The HP strap is a meter with a text alternative. `online` is `null` when presence is
 * unknown (nothing is shown). No encounter plate: that is plan slice 2.
 */
@Component({
  selector: 'hk-party-card',
  imports: [
    TranslocoDirective,
    IconComponent,
    HkPortraitFrameComponent,
    HkShieldBadgeComponent,
    HkConditionChipComponent,
    HkTooltipDirective,
  ],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './party-card.component.html',
  styleUrl: './party-card.component.scss',
})
export class HkPartyCardComponent {
  // Inputs
  readonly name = input.required<string>();
  readonly subtitle = input.required<string>();
  readonly portraitSrc = input<string | null>(null);
  readonly ac = input.required<number>();
  readonly hpCurrent = input.required<number>();
  readonly hpMax = input.required<number>();
  readonly hpTemp = input(0);
  readonly conditions = input<readonly PartyCondition[]>([]);
  readonly concentrating = input(false);
  readonly inspiration = input(false);
  readonly online = input<boolean | null>(null);
  readonly dying = input(false);
  /** Translated death-save story for the dying chip's hint; defaults to the word. */
  readonly dyingHint = input<string | null>(null);

  // Outputs
  /** `false` hides the open button, for a viewer who has nothing to open. */
  readonly openable = input(true);

  readonly open = output<void>();

  protected readonly nameId = fieldId('hk-party-name');

  protected readonly rangeMax = computed(() => Math.max(1, this.hpMax()));
  protected readonly now = computed(() => Math.min(this.rangeMax(), Math.max(0, this.hpCurrent())));
  protected readonly total = computed(() => this.hpMax() + this.hpTemp());
  protected readonly hpWidth = computed(() => percent(this.hpCurrent(), this.total()));
  protected readonly tempWidth = computed(() =>
    Math.min(100 - this.hpWidth(), percent(this.hpTemp(), this.total())),
  );
  protected readonly showChips = computed(() => this.conditions().length > 0 || this.inspiration());
}
