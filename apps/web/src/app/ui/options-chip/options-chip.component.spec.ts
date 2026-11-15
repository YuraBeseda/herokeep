import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { hintOf, mount } from '../testing/harness';
import { HkOptionsChipComponent } from './options-chip.component';

const options = [
  { id: 'a', name: 'Archery', href: '/library/feats/archery' },
  { id: 'b', name: 'Defense', href: '/library/feats/defense' },
];
const base = { count: 2, options, seeAllHref: '/library/feats' };

function chip(el: HTMLElement) {
  return el.querySelector<HTMLButtonElement>('.hk-options-chip__chip')!;
}
function popover(el: HTMLElement) {
  return el.querySelector<HTMLElement>('.hk-options-chip__popover');
}

describe('HkOptionsChipComponent', () => {
  it('shows the count and starts closed', async () => {
    const { el } = await mount(HkOptionsChipComponent, base);
    expect(chip(el).textContent?.trim()).toContain('2');
    expect(chip(el).getAttribute('aria-expanded')).toBe('false');
    expect(chip(el).getAttribute('aria-label')).toBe('2 options');
    expect(popover(el)).toBeNull();
  });

  it('names a single option in the singular', async () => {
    const { el } = await mount(HkOptionsChipComponent, { ...base, count: 1 });
    expect(chip(el).getAttribute('aria-label')).toBe('1 option');
  });

  it('opens on click and lists the options as links plus a See all footer link', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    chip(el).click();
    await fixture.whenStable();
    expect(chip(el).getAttribute('aria-expanded')).toBe('true');
    const links = Array.from(popover(el)!.querySelectorAll('a'));
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Archery',
      'Defense',
      'See all in library',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/library/feats/archery',
      '/library/feats/defense',
      '/library/feats',
    ]);
  });

  it('opens on hover and closes when the pointer leaves', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    el.dispatchEvent(new Event('mouseenter'));
    await fixture.whenStable();
    expect(popover(el)).not.toBeNull();
    el.dispatchEvent(new Event('mouseleave'));
    await fixture.whenStable();
    expect(popover(el)).toBeNull();
  });

  it('opens on keyboard focus and closes when focus leaves', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    chip(el).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await fixture.whenStable();
    expect(popover(el)).not.toBeNull();
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    await fixture.whenStable();
    expect(popover(el)).toBeNull();
  });

  it('opens on a touch long-press', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    vi.useFakeTimers();
    try {
      const down = new Event('pointerdown', { bubbles: true });
      Object.defineProperty(down, 'pointerType', { value: 'touch' });
      chip(el).dispatchEvent(down);
      vi.advanceTimersByTime(399);
      fixture.detectChanges();
      expect(popover(el)).toBeNull();
      vi.advanceTimersByTime(1);
      fixture.detectChanges();
      expect(popover(el)).not.toBeNull();
      // The click that ends the press must not close what the press opened.
      chip(el).click();
      fixture.detectChanges();
      expect(popover(el)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes on Escape and returns focus to the chip', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    chip(el).click();
    await fixture.whenStable();
    popover(el)!.querySelector('a')!.focus();
    popover(el)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(popover(el)).toBeNull();
    expect(document.activeElement).toBe(chip(el));
  });

  it('does not reopen when Escape returns focus to the chip', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    chip(el).click();
    await fixture.whenStable();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    chip(el).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await fixture.whenStable();
    expect(popover(el)).toBeNull();
  });

  it('omits the See all link without a seeAllHref', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, { count: 2, options });
    chip(el).click();
    await fixture.whenStable();
    expect(popover(el)!.querySelectorAll('a')).toHaveLength(2);
  });

  it('stays open for a mouse click while hovering (mouseenter then click)', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    el.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();
    chip(el).click();
    fixture.detectChanges();
    expect(popover(el)).not.toBeNull();
  });

  it('stays open for Enter after Tab focus (focusin then click)', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    chip(el).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    fixture.detectChanges();
    chip(el).click();
    fixture.detectChanges();
    expect(popover(el)).not.toBeNull();
  });

  it('stays open for a touch tap (pointerdown, emulated mouseenter, click)', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    const down = new Event('pointerdown', { bubbles: true });
    Object.defineProperty(down, 'pointerType', { value: 'touch' });
    chip(el).dispatchEvent(down);
    el.dispatchEvent(new Event('mouseenter'));
    chip(el).dispatchEvent(new Event('pointerup', { bubbles: true }));
    fixture.detectChanges();
    chip(el).click();
    fixture.detectChanges();
    expect(popover(el)).not.toBeNull();
  });

  it('closes on a pointer press outside, and a later click opens it again', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    chip(el).click();
    fixture.detectChanges();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(popover(el)).toBeNull();
    chip(el).click();
    fixture.detectChanges();
    expect(popover(el)).not.toBeNull();
  });

  it('does not close when the press lands on a popover link', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    chip(el).click();
    fixture.detectChanges();
    popover(el)!
      .querySelector('a')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(popover(el)).not.toBeNull();
  });

  it('ignores a focusout without a related target (a mousedown on nothing focusable)', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    chip(el).click();
    fixture.detectChanges();
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    fixture.detectChanges();
    expect(popover(el)).not.toBeNull();
  });

  it('removes the outside-press listener on close and on destroy', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    const removed = vi.spyOn(document, 'removeEventListener');
    chip(el).click();
    fixture.detectChanges();
    el.dispatchEvent(new Event('mouseleave'));
    fixture.detectChanges();
    expect(removed.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1);
    chip(el).click();
    fixture.detectChanges();
    fixture.destroy();
    expect(removed.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(2);
    removed.mockRestore();
  });

  it('a long-press with no following click does not swallow the next real click', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    vi.useFakeTimers();
    try {
      const down = new Event('pointerdown', { bubbles: true });
      Object.defineProperty(down, 'pointerType', { value: 'touch' });
      chip(el).dispatchEvent(down);
      vi.advanceTimersByTime(400);
      fixture.detectChanges();
      expect(popover(el)).not.toBeNull();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      fixture.detectChanges();
      expect(popover(el)).toBeNull();
      chip(el).click();
      fixture.detectChanges();
      expect(popover(el)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives each ellipsising link its full name as the hint', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    chip(el).click();
    fixture.detectChanges();
    const links = Array.from(popover(el)!.querySelectorAll('a'));
    expect(links.map((a) => hintOf(a))).toEqual(['Archery', 'Defense', 'See all in library']);
  });
  it('follows an option link inside the app, without a page load, and leaves a modified click alone', async () => {
    const { fixture, el } = await mount(HkOptionsChipComponent, base);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    chip(el).click();
    await fixture.whenStable();
    const link = popover(el)!.querySelector<HTMLAnchorElement>('a')!;

    const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/library/feats/archery');

    chip(el).click();
    await fixture.whenStable();
    const modified = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    });
    popover(el)!.querySelector('a')!.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  describe('viewport placement', () => {
    const POPOVER = { width: 200, height: 100 };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restored as the same prototype method
    const original = Element.prototype.getBoundingClientRect;

    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    });
    afterEach(() => {
      Element.prototype.getBoundingClientRect = original;
    });

    /** jsdom has no layout: the chip sits at `chipLeft`, the popover has a fixed size. */
    function layOut(chipLeft: number, ancestorOffset = 0): void {
      Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
        const isPopover = this.classList.contains('hk-options-chip__popover');
        const w = isPopover ? POPOVER.width : 40;
        const h = isPopover ? POPOVER.height : 22;
        const left = isPopover
          ? (parseFloat((this as HTMLElement).style.left) || 0) + ancestorOffset
          : chipLeft;
        const top = isPopover ? 0 : 300;
        return {
          left,
          top,
          right: left + w,
          bottom: top + h,
          width: w,
          height: h,
          x: left,
          y: top,
          toJSON: () => ({}),
        };
      };
    }

    async function openAt(chipLeft: number, ancestorOffset = 0): Promise<HTMLElement> {
      layOut(chipLeft, ancestorOffset);
      const { fixture, el } = await mount(HkOptionsChipComponent, base);
      chip(el).click();
      await fixture.whenStable();
      await fixture.whenStable();
      return popover(el)!;
    }

    it('keeps the popover on screen for a chip at the left edge', async () => {
      const pop = await openAt(2);
      expect(parseFloat(pop.style.left)).toBeGreaterThanOrEqual(8);
    });

    it('keeps the popover on screen when an ancestor offsets fixed positioning (a transform)', async () => {
      const pop = await openAt(348, 20);
      expect(parseFloat(pop.style.left) + 20 + POPOVER.width).toBeLessThanOrEqual(390 - 8);
      const left = await openAt(2, 20);
      expect(parseFloat(left.style.left) + 20).toBeGreaterThanOrEqual(8);
    });

    it('keeps the popover on screen for a chip at the right edge', async () => {
      const pop = await openAt(348);
      expect(parseFloat(pop.style.left) + POPOVER.width).toBeLessThanOrEqual(390 - 8);
    });
  });
});
