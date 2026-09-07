import { Component, input, model, output, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

@Component({
  selector: 'hk-search-field',
  imports: [TranslocoDirective],
  templateUrl: './search-field.component.html',
  styleUrl: './search-field.component.scss',
})
export class SearchFieldComponent {
  // Inputs / model / outputs
  readonly value = model<string>('');
  // Full, global Transloco keys (e.g. `'library.search.placeholder'`) — this component has no
  // scope of its own, see SKILL.md for why that still resolves.
  readonly placeholderKey = input.required<string>();
  readonly clearLabelKey = input.required<string>();
  readonly cleared = output<void>();

  // The input's live, uncommitted text. Only written back to `value` 150ms after the user
  // stops typing; `onClear` bypasses the debounce entirely.
  protected readonly draft = signal('');

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Methods

  protected onInput(raw: string): void {
    this.draft.set(raw);
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.value.set(this.draft());
    }, 150);
  }

  protected onClear(): void {
    clearTimeout(this.debounceTimer);
    this.draft.set('');
    this.value.set('');
    this.cleared.emit();
  }
}
