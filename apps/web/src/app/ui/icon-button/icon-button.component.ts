import { Component, computed, effect, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { switchMap } from 'rxjs';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import type { UiIconName } from '../icons/vocabulary';

const SHELL_KEY_PREFIX = 'shell.';

/**
 * `button[hk-icon-button]` — a round brass-rimmed button holding one vocabulary glyph (design-system
 * IconButton). The required `hint` input is an i18n key (`UI_ICONS[name].hint`, scope `shell`); its
 * translation becomes both the `aria-label` and the tooltip, so an icon-only control always has an
 * accessible name and a visible hint (the hint rule).
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

  protected readonly classes = computed(
    () => `hk-icon-button hk-icon-button--${this.variant()} hk-icon-button--${this.size()}`,
  );

  constructor() {
    effect(() => this.tooltip.text.set(this.label()));
  }
}
