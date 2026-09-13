import { Component, forwardRef, input, signal } from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';

// A form-control-compatible numeric input: wraps a native <input type="number"> in a
// <label> (implicit label association — no generated id/for pair to manage) and
// implements ControlValueAccessor so it drops straight into [formControl] /
// formControlName, same as any native form element would.
@Component({
  selector: 'hk-number-field',
  imports: [TranslocoDirective],
  templateUrl: './number-field.component.html',
  styleUrl: './number-field.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => NumberFieldComponent),
      multi: true,
    },
  ],
})
export class NumberFieldComponent implements ControlValueAccessor {
  // Inputs
  readonly labelKey = input.required<string>();
  readonly min = input<number | undefined>(undefined);
  readonly max = input<number | undefined>(undefined);
  readonly step = input<number | undefined>(undefined);

  // CVA state
  protected readonly value = signal<number | null>(null);
  protected readonly disabled = signal(false);

  // Left unset until Angular Forms wires them up via registerOnChange/registerOnTouched;
  // called defensively (`?.()`) rather than defaulted to no-op arrow functions, which
  // `@typescript-eslint/no-empty-function` flags.
  private onChange?: (value: number | null) => void;
  private onTouched?: () => void;

  // ControlValueAccessor

  writeValue(value: number | null): void {
    this.value.set(value ?? null);
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  // Methods

  protected onInput(raw: string): void {
    const parsed = raw === '' ? null : Number(raw);
    this.value.set(parsed);
    this.onChange?.(parsed);
  }

  protected onBlur(): void {
    this.onTouched?.();
  }
}
