import { Directive, ElementRef, inject } from '@angular/core';
import type { FocusableOption } from '@angular/cdk/a11y';
import type { FocusOrigin } from '@angular/cdk/a11y';

// Wraps each rendered tab `<button>` so `FocusKeyManager` can drive it: DOM-node identity is
// stable across re-renders (as long as `@for` doesn't recreate the element), which is what lets
// the key manager track "the same" active item across signal recomputation.
@Directive({
  selector: '[appTabFocusable]',
})
export class TabFocusableDirective implements FocusableOption {
  private readonly host = inject<ElementRef<HTMLButtonElement>>(ElementRef);

  disabled = false;

  focus(_origin?: FocusOrigin): void {
    this.host.nativeElement.focus();
  }
}
