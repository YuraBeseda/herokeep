import { Component, input } from '@angular/core';

@Component({
  selector: 'button[hk-button]',
  templateUrl: './button.component.html',
  styleUrl: './button.component.scss',
  host: {
    '[class.hk-button--primary]': "variant() === 'primary'",
    '[class.hk-button--ghost]': "variant() === 'ghost'",
    '[class.hk-button--danger]': "variant() === 'danger'",
    '[attr.aria-disabled]': "disabled() ? 'true' : null",
    '[disabled]': 'disabled()',
  },
})
export class ButtonComponent {
  // Inputs
  readonly variant = input<'primary' | 'ghost' | 'danger'>('primary');
  readonly disabled = input(false);
}
