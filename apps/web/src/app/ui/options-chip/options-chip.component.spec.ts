import { mount } from '../testing/harness';
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
});
