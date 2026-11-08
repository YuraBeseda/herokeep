import { Component, forwardRef, input, model } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { fieldId, HkValueAccessor } from '../forms/value-accessor';

/**
 * `hk-toggle` — an on/off switch with a visible label (design-system `hk-toggle`): a recessed
 * track with a brass knob. It is a `button role="switch"` with `aria-checked`, so Space and
 * Enter flip it natively.
 *
 * `value` is a model and the component is a `ControlValueAccessor`. `label` is translated text;
 * the optional `description` is a second line, linked as the switch's accessible description.
 * The touch target is at least 44px high on coarse pointers.
 */
@Component({
  selector: 'hk-toggle',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => HkToggleComponent), multi: true },
  ],
  templateUrl: './toggle.component.html',
  styleUrl: './toggle.component.scss',
})
export class HkToggleComponent extends HkValueAccessor<boolean> {
  readonly value = model(false);
  protected readonly empty = false;

  // Inputs
  readonly label = input.required<string>();
  readonly description = input<string | null>(null);

  protected readonly noteId = fieldId('hk-toggle-note');

  protected flip(): void {
    if (this.isDisabled()) return;
    this.commit(!this.value());
  }

  protected onBlur(): void {
    this.touch();
  }
}
