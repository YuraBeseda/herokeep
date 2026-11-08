import { Directive, computed, input, signal, type ModelSignal } from '@angular/core';
import type { ControlValueAccessor } from '@angular/forms';

let nextFieldId = 0;

/** A document-unique id for a field's control and its message, for `for`/`aria-describedby`. */
export function fieldId(prefix: string): string {
  return `${prefix}-${nextFieldId++}`;
}

/**
 * The shared plumbing of the `ui/` form fields: a `value` model (so a view can bind
 * `[(value)]`), the `ControlValueAccessor` contract (so the same component drops into
 * `[formControl]` / `formControlName`), and a `disabled` input merged with the form's disabled
 * state. A field extends this, declares its own `value = model(...)` and provides
 * `NG_VALUE_ACCESSOR` with `forwardRef`.
 */
@Directive()
export abstract class HkValueAccessor<T> implements ControlValueAccessor {
  abstract readonly value: ModelSignal<T>;
  /** What a form `reset()` / `null` writes. */
  protected abstract readonly empty: T;

  readonly disabled = input(false);
  protected readonly formDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.formDisabled());

  // Left unset until Angular Forms registers them; called defensively.
  private changeFn?: (value: T) => void;
  private touchedFn?: () => void;

  writeValue(value: T | null | undefined): void {
    this.value.set(value ?? this.empty);
  }

  registerOnChange(fn: (value: T) => void): void {
    this.changeFn = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.touchedFn = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }

  /** The user changed the value: update the model and tell the form. */
  protected commit(value: T): void {
    this.value.set(value);
    this.changeFn?.(value);
  }

  protected touch(): void {
    this.touchedFn?.();
  }
}
