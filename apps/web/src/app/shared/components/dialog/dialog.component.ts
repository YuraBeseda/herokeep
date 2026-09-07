import { Component, input } from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { type ComponentPortal, PortalModule } from '@angular/cdk/portal';

// The shell every `DialogService.open()` call attaches to the overlay. It owns the visible
// "surface" (background, radius, sheet-vs-centered sizing) and the focus trap; the caller's
// own component is attached *inside* it via a nested `ComponentPortal`, injected as `contentPortal`
// — see dialog.service.ts. Kept deliberately dumb: no content-projection, just a portal outlet.
@Component({
  selector: 'hk-dialog',
  imports: [PortalModule, CdkTrapFocus],
  templateUrl: './dialog.component.html',
  styleUrl: './dialog.component.scss',
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    '[class.hk-dialog--sheet]': 'sheet()',
  },
})
export class DialogComponent {
  readonly contentPortal = input.required<ComponentPortal<unknown>>();
  readonly sheet = input(false);
}
