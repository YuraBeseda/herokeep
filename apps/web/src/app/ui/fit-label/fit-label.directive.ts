import { afterNextRender, Directive, ElementRef, inject, DestroyRef } from '@angular/core';

/** Breathing room (px) a label keeps inside its tile: the tile's side padding plus the focus ring. */
const LABEL_SLACK_PX = 8;

/**
 * `[hkFitLabel]` — the fit rule of an icon-over-label tile (action strap, tab bar). When the label
 * (the child marked `data-fit-label`) is wider than the tile, the host gets `hk-fit-label--icon-only`,
 * which hides the label visually but keeps it in the accessible name; the tile's own `hkTooltip`
 * is the visible hint. Re-checked when the tile resizes or the label text changes (a language switch).
 * The label is never clipped: it either fits whole or is replaced by its icon.
 */
@Directive({ selector: '[hkFitLabel]' })
export class HkFitLabelDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const label = this.label();
      if (!label) return;
      this.refit();
      if (typeof ResizeObserver === 'undefined') return;
      const resize = new ResizeObserver(() => this.refit());
      resize.observe(this.host);
      resize.observe(label);
      // A web font that arrives late changes the label's width without resizing anything.
      void document.fonts?.ready.then(() => this.refit());
      const mutation = new MutationObserver(() => this.refit());
      mutation.observe(label, { childList: true, characterData: true, subtree: true });
      destroyRef.onDestroy(() => {
        resize.disconnect();
        mutation.disconnect();
      });
    });
  }

  /** Public for the unit test: jsdom has no layout, so it states the widths and calls this. */
  refit(): void {
    const label = this.label();
    // No layout (hidden, or a test DOM): nothing to measure.
    if (!label || !this.host.clientWidth) return;
    // An icon-only label is 1px wide but keeps its natural `scrollWidth`, so one measure serves both ways.
    this.host.classList.toggle(
      'hk-fit-label--icon-only',
      label.scrollWidth > this.host.clientWidth - LABEL_SLACK_PX,
    );
  }

  private label(): HTMLElement | null {
    return this.host.querySelector<HTMLElement>('[data-fit-label]');
  }
}
