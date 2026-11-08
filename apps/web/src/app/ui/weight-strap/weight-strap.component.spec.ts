import { hintOf, mount } from '../testing/harness';
import { HkWeightStrapComponent } from './weight-strap.component';

const base = { current: 108, capacity: 240, unit: 'lb', state: 'light' };

function meter(el: HTMLElement) {
  return el.querySelector<HTMLElement>('[role="img"]')!;
}
function fill(el: HTMLElement) {
  return el.querySelector<HTMLElement>('.hk-weight__fill')!;
}

describe('HkWeightStrapComponent', () => {
  it('shows the numbers it is given with the unit', async () => {
    const { el } = await mount(HkWeightStrapComponent, base);
    expect(el.querySelector('.hk-weight__numeral')!.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '108 / 240 lb',
    );
  });

  it('gives the gauge an image role naming the numbers and the state word', async () => {
    const { el } = await mount(HkWeightStrapComponent, base);
    expect(meter(el).getAttribute('aria-label')).toBe('108 of 240 lb, Lightly loaded');
  });

  it('fills in proportion to the load', async () => {
    const { el } = await mount(HkWeightStrapComponent, base);
    expect(fill(el).style.width).toBe('45%');
  });

  it('clamps the fill to the track and survives a zero capacity', async () => {
    const over = await mount(HkWeightStrapComponent, { ...base, current: 400, state: 'over' });
    expect(fill(over.el).style.width).toBe('100%');
    const zero = await mount(HkWeightStrapComponent, { ...base, capacity: 0 });
    expect(fill(zero.el).style.width).toBe('0%');
  });

  it.each([
    ['loaded', 'Carrying'],
    ['light', 'Lightly loaded'],
    ['encumbered', 'Encumbered'],
    ['heavy', 'Heavily encumbered'],
    ['over', 'Over capacity'],
  ])('shows the %s state as a word in the chip', async (state, word) => {
    const { el } = await mount(HkWeightStrapComponent, { ...base, state });
    expect(el.querySelector('.hk-weight__chip')!.textContent?.trim()).toBe(word);
    expect(
      el.querySelector('.hk-weight__chip')!.classList.contains(`hk-weight__chip--${state}`),
    ).toBe(true);
  });

  it('puts the effect text the caller gives in the chip hint, keeping the state word in the name', async () => {
    const { el } = await mount(HkWeightStrapComponent, {
      ...base,
      state: 'encumbered',
      stateHint: 'Encumbered: speed −10 ft',
    });
    const chip = el.querySelector<HTMLElement>('.hk-weight__chip')!;
    expect(hintOf(chip)).toBe('Encumbered: speed −10 ft');
    expect(meter(el).getAttribute('aria-label')).toBe('108 of 240 lb, Encumbered');
  });

  it('the chip hint is the state word when no effect text is given', async () => {
    const { el } = await mount(HkWeightStrapComponent, base);
    expect(hintOf(el.querySelector('.hk-weight__chip')!)).toBe('Lightly loaded');
  });

  it('marks the numeral when over capacity', async () => {
    const { el } = await mount(HkWeightStrapComponent, { ...base, current: 300, state: 'over' });
    expect(el.querySelector('.hk-weight__numeral--over')).not.toBeNull();
    expect(fill(el).classList.contains('hk-weight__fill--over')).toBe(true);
  });
});
