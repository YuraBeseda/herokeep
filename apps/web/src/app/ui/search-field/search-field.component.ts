import { Component, DestroyRef, inject, input, linkedSignal, model, output } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

const DEBOUNCE_MS = 150;

/**
 * `hk-search-field` — a pill-shaped search input with the magnifying-glass glyph (design-system
 * SearchField), for the Library, pickers and the satchel.
 *
 * `value` is a model: the typed text is committed to it 150ms after the last keystroke, and a
 * change from the parent shows in the field at once. The clear button (and Escape while there
 * is text) empties the field immediately, bypassing the debounce, and emits `cleared`. `label` is
 * translated text, visually hidden but the input's name; `placeholder` is translated text.
 * `variant="leather"` is for straps and the phone top bar.
 */
@Component({
  selector: 'hk-search-field',
  imports: [TranslocoDirective, IconComponent, HkTooltipDirective],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './search-field.component.html',
  styleUrl: './search-field.component.scss',
})
export class HkSearchFieldComponent {
  // Inputs / model / outputs
  readonly value = model('');
  readonly label = input.required<string>();
  readonly placeholder = input('');
  readonly variant = input<'leaf' | 'leather'>('leaf');
  readonly cleared = output<void>();

  /** The field's live, uncommitted text; follows `value` when the parent changes it. */
  protected readonly draft = linkedSignal(() => this.value());

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected onInput(raw: string): void {
    this.draft.set(raw);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.value.set(this.draft()), DEBOUNCE_MS);
  }

  protected onEscape(event: Event): void {
    if (this.draft() === '') return;
    event.preventDefault();
    this.clear();
  }

  protected clear(): void {
    clearTimeout(this.timer);
    this.draft.set('');
    this.value.set('');
    this.cleared.emit();
  }
}
