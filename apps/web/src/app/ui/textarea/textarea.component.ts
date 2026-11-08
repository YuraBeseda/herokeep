import { Component, computed, forwardRef, input, model } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { fieldId, HkValueAccessor } from '../forms/value-accessor';

/**
 * `hk-textarea` — a labelled multi-line text input in the same frame as `hk-text-field`, for notes
 * and descriptions. It starts at `rows` lines (3) and grows with its text up to 6 lines in
 * browsers that support `field-sizing`, then scrolls.
 *
 * `value` is a model and the component is a `ControlValueAccessor`. `label`, `placeholder`,
 * `hint` and `error` are translated text.
 */
@Component({
  selector: 'hk-textarea',
  imports: [IconComponent],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => HkTextareaComponent), multi: true },
  ],
  templateUrl: './textarea.component.html',
  styleUrl: './textarea.component.scss',
})
export class HkTextareaComponent extends HkValueAccessor<string> {
  readonly value = model('');
  protected readonly empty = '';

  // Inputs
  readonly label = input.required<string>();
  readonly rows = input(3);
  readonly placeholder = input('');
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly maxLength = input<number | null>(null);

  protected readonly areaId = fieldId('hk-textarea');
  protected readonly messageId = `${this.areaId}-msg`;
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
