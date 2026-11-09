import { Component, computed, input, output } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkButtonComponent } from '../button/button.component';
import { HkTagChipComponent } from '../tag-chip/tag-chip.component';
import { HkWaxSealComponent } from '../wax-seal/wax-seal.component';

let nextReasonId = 0;

/**
 * `hk-picker-card` — one option in a picker grid (design-system PickerCard): species, background,
 * class, feat, spell, item, fighting style, mastery. A glyph and the title, a one-line description,
 * meta chips and a Choose button.
 *
 * Two controls, never nested: the card body opens the description (`details`) and the Choose button
 * picks (`choose`). A selected card wears a wax seal and its Choose button reads Chosen
 * (`aria-pressed`). A gated option stays listed and still opens its description, but cannot be
 * chosen: the `reason` is printed on the card and is the Choose button's hint. Choosing an already
 * selected gated card stays possible, so a pick the rules now refuse can still be undone.
 *
 * It shows values it is given; the host owns what "selected" and "gated" mean.
 */
@Component({
  selector: 'hk-picker-card',
  imports: [
    TranslocoDirective,
    IconComponent,
    HkButtonComponent,
    HkTagChipComponent,
    HkWaxSealComponent,
  ],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './picker-card.component.html',
  styleUrl: './picker-card.component.scss',
  host: {
    '[class.hk-picker-card--selected]': 'selected()',
    '[class.hk-picker-card--gated]': 'gated()',
  },
})
export class HkPickerCardComponent {
  // Inputs / Outputs
  /** Already-translated option name. */
  readonly name = input.required<string>();
  /** One already-translated line describing the option. */
  readonly description = input<string | null>(null);
  /** A sprite id (`gi:<slug>` or `ui:<name>`) drawn before the title. */
  readonly icon = input<string | null>(null);
  /** Already-translated meta chips ("d10", "STR, CON", "Level 1"). */
  readonly meta = input<readonly string[]>([]);
  readonly selected = input(false);
  readonly gated = input(false);
  /** Already-translated reason a gated option cannot be chosen. */
  readonly reason = input<string | null>(null);
  readonly choose = output<void>();
  readonly details = output<void>();

  protected readonly reasonId = `hk-picker-card-reason-${nextReasonId++}`;

  /** The reason shown as the Choose button's hint while the option cannot be chosen. */
  /** The body button's name carries the visible facts too, so a screen reader hears what a sighted user sees. */
  protected bodyLabel(base: string): string {
    return this.meta().length > 0 ? `${base} — ${this.meta().join(', ')}` : base;
  }

  protected readonly blockedReason = computed(() =>
    this.gated() && !this.selected() ? (this.reason() ?? '') : null,
  );
}
