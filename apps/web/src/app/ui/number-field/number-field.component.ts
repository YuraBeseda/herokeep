import { Component, computed, forwardRef, input, model } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { coarsePointer } from '../coarse-pointer';
import { fieldId, HkValueAccessor } from '../forms/value-accessor';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * `hk-number-field` — a numeric input drawn as a well with a display numeral and round − / +
 * buttons either side (design-system NumberField), for amounts, levels, rounds and coins.
 *
 * `value` is a model (`[(value)]`) and the component is a `ControlValueAccessor`, so it drops into
 * `[formControl]` too. The − / + buttons step by `step` and never leave `min`..`max`; at a limit
 * a button stays focusable (`aria-disabled`) and its hint says why. Typing reports only values in
 * range; on commit (change / blur) an out-of-range number is clamped and written back. An empty
 * field is `null`. `label` is translated text, always rendered (`labelHidden` makes it visually
 * hidden but still the field's name); `error` replaces `hint` below the control.
 *
 * Coarse pointers get the 44px layout (design-system `hk-numfield--phone`).
 */
@Component({
  selector: 'hk-number-field',
  imports: [TranslocoDirective, IconComponent, HkTooltipDirective],
  providers: [
    provideTranslocoScope('shell'),
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => HkNumberFieldComponent),
      multi: true,
    },
  ],
  templateUrl: './number-field.component.html',
  styleUrl: './number-field.component.scss',
})
export class HkNumberFieldComponent extends HkValueAccessor<number | null> {
  readonly value = model<number | null>(null);
  protected readonly empty = null;

  // Inputs
  readonly label = input.required<string>();
  readonly labelHidden = input(false);
  readonly min = input<number | undefined>(undefined);
  readonly max = input<number | undefined>(undefined);
  readonly step = input(1);
  readonly variant = input<'leather' | 'leaf'>('leather');
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);

  protected readonly inputId = fieldId('hk-number');
  protected readonly messageId = `${this.inputId}-msg`;
  protected readonly coarse = coarsePointer();

  protected readonly atMin = computed(() => {
    const value = this.value();
    const min = this.min();
    return value !== null && min !== undefined && value <= min;
  });
  protected readonly atMax = computed(() => {
    const value = this.value();
    const max = this.max();
    return value !== null && max !== undefined && value >= max;
  });
  protected readonly describedBy = computed(() =>
    this.error() || this.hint() ? this.messageId : null,
  );

  private clamp(value: number): number {
    const min = this.min();
    const max = this.max();
    let result = value;
    if (max !== undefined) result = Math.min(max, result);
    if (min !== undefined) result = Math.max(min, result);
    return result;
  }

  protected stepBy(direction: 1 | -1): void {
    if (this.isDisabled()) return;
    if (direction === 1 ? this.atMax() : this.atMin()) return;
    this.commit(this.clamp((this.value() ?? 0) + direction * this.step()));
  }

  /**
   * The soft keypad to ask for. A field that can go negative needs the minus key, which the
   * numeric and decimal pads of some phones lack; a fractional step needs the decimal point.
   */
  protected readonly inputMode = computed(() => {
    const min = this.min();
    if (min === undefined || min < 0) return 'text';
    return Number.isInteger(this.step()) ? 'numeric' : 'decimal';
  });

  protected onInput(field: HTMLInputElement): void {
    const raw = field.value;
    // A half-typed number ("-", "1e") reads as '' with `badInput`: leave it be, or the model
    // update would rewrite the field and swallow the keystroke.
    if (raw === '' && field.validity.badInput) return;
    if (raw === '') {
      this.commit(null);
      return;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && this.clamp(parsed) === parsed) this.commit(parsed);
  }

  protected onCommit(field: HTMLInputElement): void {
    if (field.value === '') return;
    const parsed = Number(field.value);
    if (!Number.isFinite(parsed)) return;
    const clamped = this.clamp(parsed);
    field.value = String(clamped);
    if (clamped !== this.value()) this.commit(clamped);
  }

  protected onBlur(): void {
    this.touch();
  }
}
