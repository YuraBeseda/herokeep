import { Component, computed, input, output } from '@angular/core';
import { provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkIconButtonComponent } from '../icon-button/icon-button.component';
import type { UiIconName } from '../icons/vocabulary';

export type HkToastVariant = 'info' | 'success' | 'error';

const ICON: Record<HkToastVariant, UiIconName> = {
  info: 'details',
  success: 'done',
  error: 'condition',
};

/**
 * `hk-toast` — one parchment slip (design-system Toast): a message, an optional italic detail line
 * (such as a dice breakdown) and an optional Close button. Info and success are a status; an error
 * is an alert. This is the presentational slip only: stacking, timing (4 s, 3 s, errors stay until
 * dismissed) and placement above the strap belong to the toast host that renders these.
 */
@Component({
  selector: 'hk-toast',
  imports: [IconComponent, HkIconButtonComponent],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './toast.component.html',
  styleUrl: './toast.component.scss',
})
export class HkToastComponent {
  // Inputs
  /** Already-translated message. */
  readonly message = input.required<string>();
  readonly detail = input<string | null>(null);
  readonly variant = input<HkToastVariant>('info');
  readonly dismissable = input(false);

  // Outputs
  readonly dismissed = output<void>();

  protected readonly glyph = computed(() => ICON[this.variant()]);
  protected readonly classes = computed(() => `hk-toast hk-toast--${this.variant()}`);
  protected readonly role = computed(() => (this.variant() === 'error' ? 'alert' : 'status'));
}
