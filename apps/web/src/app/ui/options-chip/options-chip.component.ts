import { Component, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { uniqueId } from '../format';

export interface OptionsChipOption {
  readonly id: string;
  /** Translated name. */
  readonly name: string;
  readonly href: string;
}

const LONG_PRESS_MS = 400;

/**
 * `hk-options-chip` — a count chip that lists the options a feature or item offers in a popover
 * (hover, keyboard focus or touch long-press; a tap toggles it). The popover lists each option as
 * a link and ends with a "See all in library" link to `seeAllHref`. Escape closes it and returns
 * focus to the chip.
 *
 * It renders the options it is given; where they come from (and the hrefs) is the caller's. Names
 * are already-translated text.
 */
@Component({
  selector: 'hk-options-chip',
  imports: [TranslocoDirective, IconComponent],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './options-chip.component.html',
  styleUrl: './options-chip.component.scss',
  host: {
    '(mouseenter)': 'open.set(true)',
    '(mouseleave)': 'open.set(false)',
    '(focusin)': 'onFocusIn()',
    '(focusout)': 'onFocusOut($event)',
    '(keydown.escape)': 'onEscape()',
  },
})
export class HkOptionsChipComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly chip = viewChild.required<ElementRef<HTMLButtonElement>>('chip');

  // Inputs
  readonly count = input.required<number>();
  readonly options = input.required<readonly OptionsChipOption[]>();
  /** Where the "See all in library" footer link goes; no footer without it. */
  readonly seeAllHref = input<string | null>(null);

  protected readonly open = signal(false);
  protected readonly popoverId = uniqueId('hk-options-popover');

  private suppressFocusOpen = false;
  private longPressTimer: ReturnType<typeof setTimeout> | undefined;
  private longPressed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.longPressTimer));
  }

  protected onClick(): void {
    // The click that ends a long-press must not close what the long-press just opened.
    if (this.longPressed) {
      this.longPressed = false;
      return;
    }
    this.open.update((value) => !value);
  }

  protected onPointerDown(event: PointerEvent): void {
    this.longPressed = false;
    if (event.pointerType !== 'touch') return;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = setTimeout(() => {
      this.longPressed = true;
      this.open.set(true);
    }, LONG_PRESS_MS);
  }

  protected cancelLongPress(): void {
    clearTimeout(this.longPressTimer);
  }

  protected onFocusIn(): void {
    if (!this.suppressFocusOpen) this.open.set(true);
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.contains(next)) return;
    this.open.set(false);
  }

  protected onEscape(): void {
    if (!this.open()) return;
    this.open.set(false);
    // Focus returning to the chip must not reopen the popover it just closed.
    this.suppressFocusOpen = true;
    this.chip().nativeElement.focus();
    queueMicrotask(() => (this.suppressFocusOpen = false));
  }
}
