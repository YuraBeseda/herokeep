import { Directive, ElementRef, inject, Injector, input } from '@angular/core';
import { PeekService, type EntityId } from './peek.service';

/**
 * `[hkPeek]="entityId"` on an `<a routerLink>`: a plain left click opens the side panel instead of
 * navigating. Modified clicks (Ctrl/Meta/Shift, middle button) keep the native navigation, so
 * "open in a new tab" still works; Enter on the focused link arrives here as a plain click.
 */
@Directive({ selector: 'a[hkPeek]' })
export class HkPeekLinkDirective {
  readonly hkPeek = input.required<EntityId>();
  private readonly peek = inject(PeekService);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** The caller's scope, so hero-pinned and homebrew packs resolve in the panel. */
  private readonly injector = inject(Injector);

  constructor() {
    // Capture phase: runs before RouterLink's own click handler whatever the directive order.
    this.el.addEventListener('click', (event) => this.onClick(event), { capture: true });
  }

  private onClick(event: MouseEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.peek.open(this.hkPeek(), this.el, { injector: this.injector });
  }
}
