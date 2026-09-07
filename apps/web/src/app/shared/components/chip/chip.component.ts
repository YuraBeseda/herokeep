import { Component, ElementRef, inject, input, output } from '@angular/core';

@Component({
  selector: 'hk-chip',
  templateUrl: './chip.component.html',
  styleUrl: './chip.component.scss',
  host: {
    role: 'button',
    tabindex: '0',
    '[class.hk-chip--selected]': 'selected()',
    '[attr.aria-pressed]': 'selected()',
    '(keydown.enter)': 'activateFromKeyboard($event)',
    '(keydown.space)': 'activateFromKeyboard($event)',
  },
})
export class ChipComponent {
  // Dependencies
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  // Inputs / Outputs
  readonly selected = input(false);
  readonly removable = input(false);
  readonly remove = output<void>();

  // Methods

  // The remove affordance sits inside the chip; stop its click from bubbling to
  // whatever `(click)` handler the consumer attached to the chip host itself, so
  // removing never also triggers selection.
  protected onRemoveClick(event: MouseEvent): void {
    event.stopPropagation();
    this.remove.emit();
  }

  // Synthesizes a real `click` on the host so a consumer's native `(click)` binding
  // fires for keyboard activation too. Ignores keydown events that bubbled up from a
  // descendant (e.g. the remove button), which already handle their own activation.
  protected activateFromKeyboard(event: Event): void {
    if (event.target !== this.elementRef.nativeElement) {
      return;
    }
    event.preventDefault();
    this.elementRef.nativeElement.click();
  }
}
