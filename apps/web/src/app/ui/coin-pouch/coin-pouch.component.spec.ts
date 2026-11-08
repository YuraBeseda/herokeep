import { hintOf, mount, press } from '../testing/harness';
import { HkCoinPouchComponent } from './coin-pouch.component';

const coins = { pp: 1, gp: 38, sp: 0, cp: 7 };
const base = { coins, total: 79.5 };

function stacks(el: HTMLElement) {
  return Array.from(el.querySelectorAll<HTMLElement>('.hk-coinstack'));
}

describe('HkCoinPouchComponent', () => {
  it('draws four stacks in platinum, gold, silver, copper order, each an image with a spoken amount', async () => {
    const { el } = await mount(HkCoinPouchComponent, base);
    expect(stacks(el).map((s) => s.getAttribute('aria-label'))).toEqual([
      '1 platinum piece',
      '38 gold pieces',
      '0 silver pieces',
      '7 copper pieces',
    ]);
    expect(stacks(el).every((s) => s.getAttribute('role') === 'img')).toBe(true);
  });

  it('shows the counts and unit abbreviations; a zero stack still shows', async () => {
    const { el } = await mount(HkCoinPouchComponent, base);
    expect(stacks(el).map((s) => s.textContent?.replace(/\s+/g, '') ?? '')).toEqual([
      '1pp',
      '38gp',
      '0sp',
      '7cp',
    ]);
  });

  it('names the metal in words, not by colour alone, on every stack', async () => {
    const { el } = await mount(HkCoinPouchComponent, base);
    for (const stack of stacks(el)) expect(stack.getAttribute('aria-label')).toMatch(/piece/);
  });

  it('shows the total it is given and does not compute one', async () => {
    const { el } = await mount(HkCoinPouchComponent, base);
    expect(el.querySelector('.hk-pouch__total')!.textContent?.trim()).toBe('≈ 79.5 gp');
    const none = await mount(HkCoinPouchComponent, { coins, total: null });
    expect(none.el.querySelector('.hk-pouch__total')).toBeNull();
  });

  it('exposes the whole pouch as a labelled group', async () => {
    const { el } = await mount(HkCoinPouchComponent, base);
    expect(el.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Coin pouch');
  });

  it('emits edit from a named, hinted edit button', async () => {
    const { fixture, el } = await mount(HkCoinPouchComponent, base);
    let edits = 0;
    fixture.componentInstance.edit.subscribe(() => edits++);
    const button = el.querySelector<HTMLButtonElement>('button[hk-icon-button]')!;
    expect(button.getAttribute('aria-label')).toBe('Edit');
    expect(hintOf(button)).toBe('Edit');
    press(button);
    expect(edits).toBe(1);
  });

  it('hides the edit button when not editable', async () => {
    const { el } = await mount(HkCoinPouchComponent, { ...base, editable: false });
    expect(el.querySelector('button')).toBeNull();
  });
});
