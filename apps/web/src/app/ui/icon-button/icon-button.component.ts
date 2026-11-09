import { Component, computed, DestroyRef, effect, ElementRef, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { switchMap } from 'rxjs';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import type { UiIconName } from '../icons/vocabulary';

const SHELL_KEY_PREFIX = 'shell.';
let nextReasonId = 0;

/**
 * `button[hk-icon-button]` — a round brass-rimmed button holding one vocabulary glyph (design-system
 * IconButton). The required `hint` input is an i18n key (`UI_ICONS[name].hint`, scope `shell`); its
 * translation becomes both the `aria-label` and the tooltip, so an icon-only control always has an
 * accessible name and a visible hint (the hint rule).
 *
 * `disabledReason` — already-translated text. While set the button is `aria-disabled` (still
 * focusable, so the reason can be reached by keyboard and touch), swallows activation, and the
 * reason becomes the hint and a hidden description; the accessible name stays the glyph's own.
 *
 * Pressed state: bind `aria-pressed` or `aria-current` on the host; the stylesheet keys off them.
 */
@Component({
  selector: 'button[hk-icon-button]',
  imports: [IconComponent],
  hostDirectives: [HkTooltipDirective],
  templateUrl: './icon-button.component.html',
  styleUrl: './icon-button.component.scss',
  host: {
    '[attr.aria-label]': 'label()',
    '[class]': 'classes()',
    '[attr.aria-disabled]': 'hasReason() ? "true" : null',
  },
})
export class HkIconButtonComponent {
  private readonly transloco = inject(TranslocoService);
  private readonly tooltip = inject(HkTooltipDirective, { self: true });

  // Inputs
  readonly icon = input.required<UiIconName>();
  /** i18n key of the hint, e.g. `shell.icon.roll`. */
  readonly hint = input.required<string>();
  readonly variant = input<'brass' | 'ghost' | 'ember' | 'moss'>('brass');
  readonly size = input<'s' | 'm' | 'l'>('m');
  /** Translated reason the action is unavailable; `null` when it is available. */
  readonly disabledReason = input<string | null>(null);

  // Re-resolves when the hint key changes and when the language changes.
  protected readonly label = toSignal(
    toObservable(this.hint).pipe(
      // A scoped lookup prefixes the scope itself, so the key is passed without its `shell.`.
      switchMap((key) =>
        this.transloco.selectTranslate<string>(key.slice(SHELL_KEY_PREFIX.length), {}, 'shell'),
      ),
    ),
    { initialValue: '' },
  );

  protected readonly reasonId = `hk-icon-button-reason-${nextReasonId++}`;
  protected readonly hasReason = computed(() => (this.disabledReason() ?? '') !== '');

  protected readonly classes = computed(
    () => `hk-icon-button hk-icon-button--${this.variant()} hk-icon-button--${this.size()}`,
  );

  constructor() {
    effect(() => {
      const reason = this.disabledReason() ?? '';
      this.tooltip.text.set(reason !== '' ? reason : this.label());
    });
    effect(() => this.tooltip.describedByExtra.set(this.hasReason() ? this.reasonId : null));

    // A capture listener runs before any click handler the caller bound, so a blocked button never reaches them.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const swallow = (event: Event): void => {
      if (!this.hasReason()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    host.addEventListener('click', swallow, true);
    inject(DestroyRef).onDestroy(() => host.removeEventListener('click', swallow, true));
  }
}
