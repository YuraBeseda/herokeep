import { Component, input, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

// Per-instance unique suffix for the body region id the toggle's `aria-controls` points
// at — module-scoped counter, not `Math.random`/a UUID; deterministic and good enough for
// an in-page DOM id.
let nextSheetSectionId = 0;

// Collapse state is internal: the header button IS the title (its accessible name comes
// straight from `titleKey`, so no separate "expand"/"collapse" string is needed), toggled
// via `aria-expanded` + `aria-controls` + hiding the body. `collapsible` decides whether
// that header renders as a button at all; when false the title is inert text and the body
// always shows. `collapsible` is just a static per-section flag the consumer sets — there
// is no built-in breakpoint/viewport wiring, and none is expected.
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
  protected readonly bodyId = `hk-sheet-section-body-${nextSheetSectionId++}`;

  // Methods

  protected isBodyHidden(): boolean {
    return this.collapsible() && this.collapsed();
  }

  protected toggle(): void {
    this.collapsed.update((value) => !value);
  }
}
