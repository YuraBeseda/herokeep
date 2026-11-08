import { Component, computed, forwardRef, input, model } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { IconComponent } from '../../shared/icons/icon.component';
import { fieldId, HkValueAccessor } from '../forms/value-accessor';

export interface SelectOption {
  readonly value: string;
  /** Translated text. */
  readonly label: string;
  readonly disabled?: boolean;
}

/**
 * `hk-select` — a labelled choice among a few options, in the parchment field frame (design-system
 * NumberField README: "selects and textareas share the same frame"). It is a native `<select>` on
 * purpose: the browser supplies the listbox, keyboard model, Escape, outside-press dismissal and
 * the full-screen picker on phones, none of which a custom popover would match.
 *
 * `value` is a model and the component is a `ControlValueAccessor`. With a `placeholder`, an
 * unselectable first option shows it while nothing is chosen (`null`). `label`, option labels,
 * `placeholder`, `hint` and `error` are translated text.
 */
@Component({
  selector: 'hk-select',
  imports: [IconComponent],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => HkSelectComponent), multi: true },
  ],
  templateUrl: './select.component.html',
  styleUrl: './select.component.scss',
})
export class HkSelectComponent extends HkValueAccessor<string | null> {
  readonly value = model<string | null>(null);
  protected readonly empty = null;

  // Inputs
  readonly label = input.required<string>();
  readonly options = input.required<readonly SelectOption[]>();
  readonly placeholder = input<string | null>(null);
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);

  protected readonly selectId = fieldId('hk-select');
  protected readonly messageId = `${this.selectId}-msg`;
  protected readonly describedBy = computed(() =>
    this.error() || this.hint() ? this.messageId : null,
  );

  protected onChange(field: HTMLSelectElement): void {
    this.commit(field.value);
  }

  protected onBlur(): void {
    this.touch();
  }
}
