import { placePopover } from './popover-placement';

const viewport = { width: 390, height: 844 };
const size = { width: 200, height: 120 };
const anchorAt = (left: number, top = 300) => ({ left, top, right: left + 40, bottom: top + 22 });

describe('placePopover', () => {
  it('starts level with the anchor and just below it when everything fits', () => {
    expect(placePopover(anchorAt(100), size, viewport)).toEqual({ left: 100, top: 322 });
  });

  it('keeps the whole popover on screen for an anchor at the left edge', () => {
    expect(placePopover(anchorAt(-6), size, viewport).left).toBe(8);
  });

  it('keeps the whole popover on screen for an anchor at the right edge', () => {
    const { left } = placePopover(anchorAt(350), size, viewport);
    expect(left + size.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(left).toBe(182);
  });

  it('flips above the anchor when there is no room below but room above', () => {
    expect(placePopover(anchorAt(100, 760), size, viewport).top).toBe(760 - 120);
  });

  it('stays below when it fits neither way', () => {
    expect(placePopover(anchorAt(100, 40), size, { width: 390, height: 100 }).top).toBe(62);
  });

  it('sits at the start margin when it is wider than the viewport', () => {
    expect(placePopover(anchorAt(100), { width: 500, height: 50 }, viewport).left).toBe(8);
  });
});
