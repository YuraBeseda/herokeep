import { Component, computed, forwardRef, input, model } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { fieldId, HkValueAccessor } from '../forms/value-accessor';

/**
 * `hk-text-field` — a labelled single-line text input in the parchment field frame (design-system
 * NumberField README: `hk-field` + `hk-input`).
 *
 * `value` is a model and the component is a `ControlValueAccessor`. `label`, `placeholder`,
 * `hint` and `error` are translated text; `error` replaces `hint` below the control, is linked
 * with `aria-describedby` and marks the input `aria-invalid`.
 */
@Component({
  selector: 'hk-text-field',
  imports: [IconComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => HkTextFieldComponent),
      multi: true,
    },
  ],
  templateUrl: './text-field.component.html',
  styleUrl: './text-field.component.scss',
})
export class HkTextFieldComponent extends HkValueAccessor<string> {
  readonly value = model('');
  protected readonly empty = '';

  // Inputs
  readonly label = input.required<string>();
  readonly type = input<'text' | 'email' | 'password' | 'url' | 'tel'>('text');
  readonly placeholder = input('');
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly maxLength = input<number | null>(null);
  readonly autocomplete = input<string | null>(null);
  readonly required = input(false);

  protected readonly inputId = fieldId('hk-text');
  protected readonly messageId = `${this.inputId}-msg`;
  protected readonly describedBy = computed(() =>
    this.error() || this.hint() ? this.messageId : null,
  );

  protected onInput(raw: string): void {
    this.commit(raw);
  }

  protected onBlur(): void {
    this.touch();
  }
}
