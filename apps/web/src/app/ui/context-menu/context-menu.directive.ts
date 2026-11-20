import { CdkContextMenuTrigger } from '@angular/cdk/menu';
import {
  ApplicationRef,
  type ComponentRef,
  createComponent,
  DestroyRef,
  Directive,
  ElementRef,
  EnvironmentInjector,
  inject,
  input,
} from '@angular/core';
import { HkContextMenuComponent } from './context-menu.component';
import { type HkMenuItems, resolveMenuItems } from './context-menu.types';

export const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

/**
 * `[hkContextMenu]="items"` — opens a context menu (`hk-context-menu`) on the host, built on the
 * CDK's `CdkContextMenuTrigger`: right-click opens it at the pointer, a 500 ms touch press opens it
 * at the finger (a 10 px move cancels; the native callout is suppressed), and the `ContextMenu` key
 * or Shift+F10 opens it under the focused element with the first item focused. Escape or picking an
 * item returns focus to where it was. Pair it with one visible `<hk-menu-button>` per row or block:
 * a menu is never the only way to reach an action.
 */
@Directive({
  selector: '[hkContextMenu]',
  hostDirectives: [CdkContextMenuTrigger],
  host: {
    class: 'hk-context-menu-host',
    '(keydown)': 'onKeydown($event)',
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'cancelPress()',
    '(pointercancel)': 'cancelPress()',
    '(touchend)': 'onTouchEnd($event)',
  },
})
export class HkContextMenuDirective {
  readonly hkContextMenu = input.required<HkMenuItems>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly trigger = inject(CdkContextMenuTrigger, { self: true });
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);
  private menu?: ComponentRef<HkContextMenuComponent>;
  private returnFocus: HTMLElement | null = null;
  private press: { x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private swallowTouchEnd = false;

  constructor() {
    // `opened` fires before the CDK attaches the panel, so the items are fresh for every opening.
    this.trigger.opened.subscribe(() => {
      const active = document.activeElement;
      this.returnFocus = active instanceof HTMLElement ? active : null;
      // Created on the first opening only: a long list of rows does not pay for unopened menus.
      if (!this.menu) {
        this.menu = createComponent(HkContextMenuComponent, { environmentInjector: this.injector });
        this.appRef.attachView(this.menu.hostView);
        this.menu.changeDetectorRef.detectChanges();
      }
      this.menu.instance.items.set(resolveMenuItems(this.hkContextMenu()));
      this.trigger.menuTemplateRef = this.menu.instance.template();
    });
    this.trigger.closed.subscribe(() => {
      const active = document.activeElement;
      if (!active || active === document.body || active.closest('.hk-menu')) {
        this.returnFocus?.focus();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.cancelPress();
      this.menu?.destroy();
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    const target = event.target instanceof HTMLElement ? event.target : this.host;
    const rect = target.getBoundingClientRect();
    this.openAt(rect.left, rect.bottom);
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'touch') return;
    this.cancelPress();
    const { clientX: x, clientY: y } = event;
    const timer = setTimeout(() => {
      this.press = null;
      this.swallowTouchEnd = true;
      this.openAt(x, y);
    }, LONG_PRESS_MS);
    this.press = { x, y, timer };
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.press) return;
    const moved = Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y);
    if (moved > LONG_PRESS_SLOP_PX) this.cancelPress();
  }

  protected cancelPress(): void {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
  }

  /** The finger lifting after a long-press must not click the row under the menu (or close it). */
  protected onTouchEnd(event: TouchEvent): void {
    if (!this.swallowTouchEnd) return;
    this.swallowTouchEnd = false;
    event.preventDefault();
  }

  /**
   * The CDK trigger's own `contextmenu` path opens at the point and, for a non-mouse button (as a
   * keyboard menu key sends), focuses the first item, so every opener goes through it.
   */
  private openAt(x: number, y: number): void {
    this.host.dispatchEvent(
      new MouseEvent('contextmenu', { cancelable: true, button: 0, clientX: x, clientY: y }),
    );
  }
}
