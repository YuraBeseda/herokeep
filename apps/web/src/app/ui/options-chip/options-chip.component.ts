import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { uniqueId } from '../format';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';

export interface OptionsChipOption {
  readonly id: string;
  /** Translated name. */
  readonly name: string;
  readonly href: string;
}

const LONG_PRESS_MS = 400;

/**
 * `hk-options-chip` — a count chip that lists the options a feature or item offers in a popover
 * (hover, keyboard focus, touch long-press or a click/tap). The popover lists each option as a
 * link and ends with a "See all in library" link to `seeAllHref`. Escape closes it and returns
 * focus to the chip; so does a pointer press outside it, a pointer leaving it, or focus moving
 * to something outside.
 *
 * A click only ever opens: hover and focus have usually opened it already, so a click must not
 * undo them. It renders the options it is given; where they come from (and the hrefs) is the
 * caller's. Names are already-translated text; long names ellipsise with the full name as hint.
 */
@Component({
  selector: 'hk-options-chip',
  imports: [TranslocoDirective, IconComponent, HkTooltipDirective],
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

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.longPressTimer));

    // While open, a press anywhere outside the chip closes it. Touch browsers that do not focus
    // buttons or links on tap never fire a `focusout`, so this is the reliable way out. The
    // listener exists only while open, and its cleanup also runs on destroy.
    effect((onCleanup) => {
      if (!this.open()) return;
      const onPress = (event: Event): void => {
        const target = event.target;
        if (target instanceof Node && this.host.contains(target)) return;
        this.open.set(false);
      };
      document.addEventListener('pointerdown', onPress);
      onCleanup(() => document.removeEventListener('pointerdown', onPress));
    });
  }

  protected onClick(): void {
    this.open.set(true);
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'touch') return;
    clearTimeout(this.longPressTimer);
    this.longPressTimer = setTimeout(() => this.open.set(true), LONG_PRESS_MS);
  }

  protected cancelLongPress(): void {
    clearTimeout(this.longPressTimer);
  }

  protected onFocusIn(): void {
    if (!this.suppressFocusOpen) this.open.set(true);
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    // No related target means focus left to nothing we can see (a mousedown on a non-focusable
    // spot, the browser chrome): the outside-press listener handles real clicks elsewhere.
    if (!(next instanceof Node) || this.host.contains(next)) return;
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
