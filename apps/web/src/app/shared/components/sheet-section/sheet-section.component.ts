import { Component, input, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

// Collapse state is internal: the header button IS the title (its accessible name comes
// straight from `titleKey`, so no separate "expand"/"collapse" string is needed), toggled
// via `aria-expanded` + hiding the body. `collapsible` decides whether that header renders
// as a button at all; when false the title is inert text and the body always shows —
// meant for sections that only need collapsing on narrow (phone) layouts, where the
// consumer binds `collapsible` from a breakpoint signal.
@Component({
  selector: 'hk-sheet-section',
  imports: [TranslocoDirective],
  templateUrl: './sheet-section.component.html',
  styleUrl: './sheet-section.component.scss',
})
export class SheetSectionComponent {
  // Inputs
  readonly titleKey = input.required<string>();
  readonly collapsible = input(false);

  // State
  protected readonly collapsed = signal(false);

  // Methods

  protected isBodyHidden(): boolean {
    return this.collapsible() && this.collapsed();
  }

  protected toggle(): void {
    this.collapsed.update((value) => !value);
  }
}
