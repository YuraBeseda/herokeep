import {
  ApplicationRef,
  type ComponentRef,
  computed,
  DestroyRef,
  Directive,
  ElementRef,
  EnvironmentInjector,
  createComponent,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { HkTipComponent } from './tooltip.component';

/** Design-system tokens `hint-delay-hover` / `hint-delay-touch` (the same values, in ms). */
export const HINT_DELAY_HOVER_MS = 300;
export const HINT_DELAY_TOUCH_MS = 400;
/** A touch hint has no pointer-leave to end it, so it retires on its own. */
const TOUCH_HINT_VISIBLE_MS = 2500;

let nextTipId = 0;

/**
 * `[hkTooltip]` — the hint (design-system Tooltip): a parchment slip naming what a glyph means.
 * Shown after `hkTooltipDelay` (300 ms) on hover, immediately on keyboard focus, and after a
 * 400 ms press on touch; removed on pointer leave, blur or Escape. The host gets
 * `aria-describedby` pointing at the slip. The hint is never the only accessible name: pair it
 * with an `aria-label` carrying the same text (`hk-icon-button` does this).
 */
@Directive({
  selector: '[hkTooltip]',
  host: {
    '[attr.aria-describedby]': 'describedBy()',
    '(mouseenter)': 'onMouseEnter()',
    '(mouseleave)': 'hide()',
    '(focus)': 'show()',
    '(blur)': 'hide()',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointerup)': 'cancelPending()',
    '(pointercancel)': 'cancelPending()',
    '(pointerleave)': 'cancelPending()',
    '(contextmenu)': 'onContextMenu($event)',
  },
})
export class HkTooltipDirective {
  private readonly anchor = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);

  /** The hint text. An empty text never shows a slip. */
  readonly hkTooltip = input('');
  readonly hkTooltipDelay = input(HINT_DELAY_HOVER_MS);

  /**
   * The text actually shown. Follows `hkTooltip` but a component that owns the directive as a
   * host directive (`hk-icon-button`) can set it from translated text.
   */
  readonly text = linkedSignal(() => this.hkTooltip());

  protected readonly tipId = `hk-tip-${nextTipId++}`;

  /**
   * An element id the owner of this directive wants described alongside the slip (a permanent,
   * hidden description such as a disabled reason). Listed first so it is read even when no slip
   * is on screen.
   */
  readonly describedByExtra = signal<string | null>(null);
  protected readonly describedBy = computed(() =>
    [this.describedByExtra(), this.tipId].filter((id) => id !== null).join(' '),
  );

  private tip: ComponentRef<HkTipComponent> | undefined;
  private pending: ReturnType<typeof setTimeout> | undefined;
  private touchExpiry: ReturnType<typeof setTimeout> | undefined;
  private longPressed = false;

  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.hide();
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.hide());
    effect(() => {
      const text = this.text();
      if (!this.tip) return;
      if (text === '') this.hide();
      else this.tip.setInput('text', text);
    });
  }

  protected onMouseEnter(): void {
    this.schedule(this.hkTooltipDelay());
  }

  protected onPointerDown(event: PointerEvent): void {
    this.longPressed = false;
    if (event.pointerType !== 'touch') return;
    this.schedule(HINT_DELAY_TOUCH_MS, true);
  }

  protected onContextMenu(event: Event): void {
    // The browser's long-press menu would cover the hint a touch long-press just opened.
    if (this.longPressed) event.preventDefault();
  }

  protected cancelPending(): void {
    clearTimeout(this.pending);
    this.pending = undefined;
  }

  protected show(): void {
    this.cancelPending();
    if (this.tip || this.text() === '') return;
    const tip = createComponent(HkTipComponent, { environmentInjector: this.injector });
    tip.setInput('text', this.text());
    tip.setInput('tipId', this.tipId);
    this.appRef.attachView(tip.hostView);
    document.body.appendChild(tip.location.nativeElement as HTMLElement);
    tip.changeDetectorRef.detectChanges();
    tip.instance.place(this.anchor.getBoundingClientRect());
    document.addEventListener('keydown', this.onDocumentKeydown);
    this.tip = tip;
  }

  protected hide(): void {
    this.cancelPending();
    clearTimeout(this.touchExpiry);
    this.touchExpiry = undefined;
    if (!this.tip) return;
    document.removeEventListener('keydown', this.onDocumentKeydown);
    this.appRef.detachView(this.tip.hostView);
    this.tip.destroy();
    this.tip = undefined;
  }

  private schedule(delayMs: number, touch = false): void {
    this.cancelPending();
    this.pending = setTimeout(() => {
      this.pending = undefined;
      this.show();
      if (touch) {
        this.longPressed = true;
        this.touchExpiry = setTimeout(() => this.hide(), TOUCH_HINT_VISIBLE_MS);
      }
    }, delayMs);
  }
}
