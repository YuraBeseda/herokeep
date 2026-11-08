import { Component, DestroyRef, ElementRef, computed, effect, inject, input } from '@angular/core';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

export type HkButtonVariant =
  'primary' | 'parchment' | 'ghost' | 'ghost-leather' | 'ember' | 'moss';
export type HkButtonSize = 'm' | 'l' | 'phone';

let nextReasonId = 0;

/**
 * `button[hk-button]` — the pill-shaped text button (design-system Button). Variants: `primary`
 * (brass, one per zone), `parchment` (secondary on leather), `ghost` (tertiary), `ember`
 * (destructive; keeps its text, never icon-only). `moss` is Heal and `ghost-leather` is the ghost
 * on a leather strap. Put an `<hk-icon>` before the label for a glyph.
 *
 * `disabledReason` — already-translated text. While set the button is `aria-disabled` (still
 * focusable, so its hint can be reached by keyboard and touch), swallows activation, and the
 * reason is attached as a hidden description (`aria-describedby`) and as the tooltip. It is never
 * printed next to the button.
 *
 * `loading` — `aria-busy`, a spinner in place of the glyph, label at 55%, no activation.
 */
@Component({
  selector: 'button[hk-button]',
  hostDirectives: [HkTooltipDirective],
  templateUrl: './button.component.html',
  styleUrl: './button.component.scss',
  host: {
    '[class]': 'classes()',
    '[attr.type]': 'type()',
    '[attr.aria-busy]': 'loading() ? "true" : null',
    '[attr.aria-disabled]': 'blocked() ? "true" : null',
  },
})
export class HkButtonComponent {
  private readonly tooltip = inject(HkTooltipDirective, { self: true });

  // Inputs
  readonly variant = input<HkButtonVariant>('primary');
  readonly size = input<HkButtonSize>('m');
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly loading = input(false);
  /** Translated reason the action is unavailable; `null` when it is available. */
  readonly disabledReason = input<string | null>(null);

  protected readonly reasonId = `hk-button-reason-${nextReasonId++}`;
  protected readonly hasReason = computed(() => (this.disabledReason() ?? '') !== '');
  protected readonly blocked = computed(() => this.loading() || this.hasReason());
  protected readonly classes = computed(
    () =>
      `hk-button hk-button--${this.variant()} hk-button--${this.size()}` +
      (this.loading() ? ' hk-button--loading' : ''),
  );

  constructor() {
    effect(() => this.tooltip.text.set(this.disabledReason() ?? ''));
    effect(() => this.tooltip.describedByExtra.set(this.hasReason() ? this.reasonId : null));

    // A capture listener on the button itself runs before any (bubble-phase) click handler the
    // caller bound, so a blocked button never reaches them.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const swallow = (event: Event): void => {
      if (!this.blocked()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    host.addEventListener('click', swallow, true);
    inject(DestroyRef).onDestroy(() => host.removeEventListener('click', swallow, true));
  }
}
