import { hintOf, mount } from '../testing/harness';
import { HkFilterChipsComponent } from './filter-chips.component';

const options = [
  { id: 'cantrip', label: 'Cantrip' },
  { id: 'ritual', label: 'Ritual', count: 3 },
  { id: 'fire', label: 'Fire', damage: 'fire' as const },
  { id: 'none', label: 'Divine', disabledReason: 'No divine spells in the installed packs' },
];

function chips(el: HTMLElement) {
  return Array.from(el.querySelectorAll<HTMLButtonElement>('.hk-filter-chips__chip'));
}

describe('HkFilterChipsComponent', () => {
  it('is a labelled group of toggle buttons', async () => {
    const { el } = await mount(HkFilterChipsComponent, { label: 'Filters', options, selected: [] });
    expect(el.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Filters');
    expect(chips(el).map((c) => c.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'false',
      'false',
    ]);
  });

  it('marks selected chips as pressed', async () => {
    const { el } = await mount(HkFilterChipsComponent, {
      label: 'Filters',
      options,
      selected: ['ritual'],
    });
    expect(chips(el)[1].getAttribute('aria-pressed')).toBe('true');
    expect(chips(el)[1].classList.contains('hk-filter-chips__chip--selected')).toBe(true);
  });

  it('emits the new selection when a chip is clicked', async () => {
    const { fixture, el } = await mount(HkFilterChipsComponent, {
      label: 'Filters',
      options,
      selected: ['ritual'],
    });
    const seen: (readonly string[])[] = [];
    fixture.componentInstance.selected.subscribe((v) => seen.push(v));
    chips(el)[0].click();
    await fixture.whenStable();
    chips(el)[1].click();
    expect(seen).toEqual([['ritual', 'cantrip'], ['cantrip']]);
  });

  it('shows the count badge', async () => {
    const { el } = await mount(HkFilterChipsComponent, { label: 'F', options, selected: [] });
    expect(el.querySelector('.hk-filter-chips__count')!.textContent?.trim()).toBe('3');
  });

  it('inks a damage chip with its damage token', async () => {
    const { el } = await mount(HkFilterChipsComponent, { label: 'F', options, selected: [] });
    expect(chips(el)[2].style.getPropertyValue('--dmg')).toBe('var(--damage-fire)');
  });

  it('keeps a disabled chip focusable and inert, explaining itself only in the hint', async () => {
    const { fixture, el } = await mount(HkFilterChipsComponent, {
      label: 'F',
      options,
      selected: [],
    });
    const seen: (readonly string[])[] = [];
    fixture.componentInstance.selected.subscribe((v) => seen.push(v));
    const chip = chips(el)[3];
    expect(chip.getAttribute('aria-disabled')).toBe('true');
    chip.click();
    expect(seen).toEqual([]);
    expect(hintOf(chip)).toBe('Divine: No divine spells in the installed packs');
    expect(el.textContent).not.toContain('No divine spells');
  });

  it('gives an ellipsising chip its full label as the hint', async () => {
    const long = 'A very long translated filter label';
    const { el } = await mount(HkFilterChipsComponent, {
      label: 'F',
      options: [{ id: 'x', label: long }],
      selected: [],
    });
    expect(hintOf(chips(el)[0])).toBe(long);
  });

  it('offers Clear filters only while something is selected, and clears', async () => {
    const { fixture, el } = await mount(HkFilterChipsComponent, {
      label: 'F',
      options,
      selected: [],
    });
    expect(el.querySelector('.hk-filter-chips__clear')).toBeNull();
    fixture.componentRef.setInput('selected', ['fire']);
    await fixture.whenStable();
    const clear = el.querySelector<HTMLButtonElement>('.hk-filter-chips__clear')!;
    expect(clear.textContent?.trim()).toBe('Clear filters');
    const seen: (readonly string[])[] = [];
    fixture.componentInstance.selected.subscribe((v) => seen.push(v));
    clear.click();
    expect(seen).toEqual([[]]);
  });
});
