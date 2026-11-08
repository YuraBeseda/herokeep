import { Component, computed, input, output } from '@angular/core';
import { provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkIconButtonComponent } from '../icon-button/icon-button.component';
import type { UiIconName } from '../icons/vocabulary';

export type HkBannerVariant = 'warning' | 'info' | 'arcane';

const DEFAULT_ICON: Record<HkBannerVariant, UiIconName> = {
  warning: 'details',
  info: 'details',
  arcane: 'concentration',
};

/**
 * `hk-banner` — a full-width parchment notice for things the user must act on before the screen is
 * right (design-system Banner): missing packs (warning), campaign packs to pin (arcane), an app
 * update (info). The sentence is the content; actions go in `[hkBannerActions]`. Show one at a
 * time, above the first leaf, never over the rail. `dismissable` adds a Close button (only for
 * states the user may ignore); `urgent` makes the region an alert instead of a status.
 */
@Component({
  selector: 'hk-banner',
  imports: [IconComponent, HkIconButtonComponent],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './banner.component.html',
  styleUrl: './banner.component.scss',
})
export class HkBannerComponent {
  // Inputs
  readonly variant = input<HkBannerVariant>('warning');
  /** Already-translated title line; the banner is a single sentence without it. */
  readonly heading = input<string | null>(null);
  readonly icon = input<UiIconName | null>(null);
  readonly dismissable = input(false);
  readonly urgent = input(false);

  // Outputs
  readonly dismissed = output<void>();

  protected readonly glyph = computed(() => this.icon() ?? DEFAULT_ICON[this.variant()]);
  protected readonly classes = computed(() => `hk-banner hk-banner--${this.variant()}`);
}
