import {
  Component,
  afterNextRender,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  Injector,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { IconComponent } from '../../shared/icons/icon.component';
import { uniqueId } from '../format';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { placePopover } from './popover-placement';

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
  private readonly router = inject(Router);
  private readonly chip = viewChild.required<ElementRef<HTMLButtonElement>>('chip');
  private readonly popoverEl = viewChild<ElementRef<HTMLElement>>('popover');
  private readonly injector = inject(Injector);

  // Inputs
  readonly count = input.required<number>();
  readonly options = input.required<readonly OptionsChipOption[]>();
  /** Where the "See all in library" footer link goes; no footer without it. */
  readonly seeAllHref = input<string | null>(null);

  protected readonly open = signal(false);
  /** Viewport coordinates of the open popover (it is fixed, so no scroll box clips it); null until measured. */
  protected readonly position = signal<{ left: number; top: number } | null>(null);
  protected readonly popoverId = uniqueId('hk-options-popover');

  private suppressFocusOpen = false;
  private longPressTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.longPressTimer));

    // Opening places the popover (it first renders hidden, then moves into view).
    effect(() => {
      if (!this.open()) {
        this.position.set(null);
        return;
      }
      afterNextRender(() => this.reposition(), { injector: this.injector });
    });

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
      const onMove = (): void => this.reposition();
      document.addEventListener('pointerdown', onPress);
      window.addEventListener('resize', onMove);
      window.addEventListener('scroll', onMove, true);
      onCleanup(() => {
        document.removeEventListener('pointerdown', onPress);
        window.removeEventListener('resize', onMove);
        window.removeEventListener('scroll', onMove, true);
      });
    });
  }

  /** Keeps the popover fully inside the viewport, wherever the chip is (see `placePopover`). */
  private reposition(): void {
    const popover = this.popoverEl()?.nativeElement;
    if (!popover) return;
    const anchor = this.chip().nativeElement.getBoundingClientRect();
    const box = popover.getBoundingClientRect();
    // The popover is fixed, but an ancestor with a transform or filter would make that relative to
    // itself: the gap between where it was put and where it landed is that ancestor's offset.
    const put = this.position() ?? { left: 0, top: 0 };
    const offset = { left: box.left - put.left, top: box.top - put.top };
    const placed = placePopover(
      anchor,
      { width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    this.position.set({ left: placed.left - offset.left, top: placed.top - offset.top });
  }

  /**
   * A plain click on an option or the footer link goes through the router, so the app is not
   * reloaded; a modified click (new tab, new window) keeps the browser's own handling.
   */
  protected onLink(event: MouseEvent, href: string): void {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    this.open.set(false);
    void this.router.navigateByUrl(href);
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
