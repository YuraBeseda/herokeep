import { Component, input } from '@angular/core';

@Component({
  selector: 'button[hk-icon-button]',
  templateUrl: './icon-button.component.html',
  styleUrl: './icon-button.component.scss',
  host: {
    '[attr.aria-label]': 'label()',
    '[attr.data-icon]': 'icon()',
    '[class.hk-icon-button--primary]': "variant() === 'primary'",
    '[class.hk-icon-button--ghost]': "variant() === 'ghost'",
    '[class.hk-icon-button--danger]': "variant() === 'danger'",
  },
})
export class IconButtonComponent {
  // Inputs
  readonly icon = input.required<string>();
  readonly label = input.required<string>();
  readonly variant = input<'primary' | 'ghost' | 'danger'>('primary');
}
