/** The edges of a box in viewport coordinates (what `getBoundingClientRect` returns). */
export interface PlacementBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface PlacementSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Where a popover goes so it stays fully inside the viewport. It starts level with the anchor's
 * start edge and directly below it (no gap, so a pointer moving onto it never leaves the chip); the horizontal position is then clamped into the viewport (so a
 * chip at either edge keeps the whole list on screen), and the popover flips above the anchor when
 * there is no room below but room above. A popover wider than the viewport sits at the start margin.
 */
export function placePopover(
  anchor: PlacementBox,
  size: PlacementSize,
  viewport: PlacementSize,
  margin = 8,
  gap = 0,
): { left: number; top: number } {
  const maxLeft = viewport.width - margin - size.width;
  const left = Math.max(margin, Math.min(anchor.left, maxLeft));

  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const fitsBelow = below + size.height <= viewport.height - margin;
  const top = fitsBelow || above < margin ? below : above;
  return { left, top };
}
