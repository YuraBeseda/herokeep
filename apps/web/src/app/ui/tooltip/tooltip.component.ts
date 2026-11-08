import { Component, ElementRef, inject, input } from '@angular/core';

const GAP_PX = 10;
const VIEWPORT_MARGIN_PX = 8;

/**
 * The hint slip itself (`hk-tip`, design-system Tooltip). Created and positioned by
 * `HkTooltipDirective` and attached to `document.body`, so no ancestor's `overflow` or stacking
 * context can clip it. Never interactive.
 */
@Component({
  selector: 'hk-tip',
  template: `{{ text() }}`,
  styleUrl: './tooltip.component.scss',
  host: {
    role: 'tooltip',
    '[id]': 'tipId()',
  },
})
export class HkTipComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly text = input.required<string>();
  readonly tipId = input.required<string>();

  /** Places the slip centred below `anchor`, or above it when there is no room below. */
  place(anchor: DOMRect): void {
    const tip = this.host.nativeElement;
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const maxLeft = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - width - VIEWPORT_MARGIN_PX);
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN_PX, anchor.left + anchor.width / 2 - width / 2),
      maxLeft,
    );
    const below = anchor.bottom + GAP_PX;
    const fitsBelow = below + height + VIEWPORT_MARGIN_PX <= window.innerHeight;
    const top = fitsBelow ? below : Math.max(VIEWPORT_MARGIN_PX, anchor.top - GAP_PX - height);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.classList.toggle('hk-tip--above', !fitsBelow);
  }
}
