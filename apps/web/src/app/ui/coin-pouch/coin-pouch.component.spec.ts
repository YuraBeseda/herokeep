import { hintOf, mount, press, typeInto } from '../testing/harness';
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

  it('has a named, hinted edit button that announces edit', async () => {
    const { fixture, el } = await mount(HkCoinPouchComponent, base);
    let edits = 0;
    fixture.componentInstance.edit.subscribe(() => edits++);
    const button = el.querySelector<HTMLButtonElement>('button[hk-icon-button]')!;
    expect(button.getAttribute('aria-label')).toBe('Edit');
    expect(hintOf(button)).toBe('Edit');
    press(button);
    expect(edits).toBe(1);
  });

  describe('edit mode', () => {
    async function editing() {
      const m = await mount(HkCoinPouchComponent, base);
      const saved: unknown[] = [];
      m.fixture.componentInstance.save.subscribe((v) => saved.push(v));
      press(m.el.querySelector<HTMLButtonElement>('button[hk-icon-button]')!);
      m.fixture.detectChanges();
      return { ...m, saved };
    }
    const fields = (el: HTMLElement) =>
      Array.from(el.querySelectorAll<HTMLInputElement>('hk-number-field input'));
    const byClass = (el: HTMLElement, c: string) => el.querySelector<HTMLButtonElement>(`.${c}`)!;

    it('turns each metal into a number field holding its amount, replacing the view', async () => {
      const { el } = await editing();
      expect(fields(el).map((f) => f.value)).toEqual(['1', '38', '0', '7']);
      expect(fields(el).every((f) => f.min === '0')).toBe(true);
      expect(
        Array.from(el.querySelectorAll('hk-number-field label')).map((l) => l.textContent?.trim()),
      ).toEqual(['Platinum', 'Gold', 'Silver', 'Copper']);
      expect(stacks(el)).toHaveLength(0);
      expect(el.querySelector('button[hk-icon-button]')).toBeNull();
    });

    it('saves the four amounts once and returns to the view', async () => {
      const { fixture, el, saved } = await editing();
      typeInto(fields(el)[1], '40');
      press(byClass(el, 'hk-pouch__save'));
      fixture.detectChanges();
      expect(saved).toEqual([{ pp: 1, gp: 40, sp: 0, cp: 7 }]);
      expect(stacks(el)).toHaveLength(4);
    });

    it('treats an emptied field as zero coins', async () => {
      const { fixture, el, saved } = await editing();
      typeInto(fields(el)[3], '');
      press(byClass(el, 'hk-pouch__save'));
      fixture.detectChanges();
      expect(saved).toEqual([{ pp: 1, gp: 38, sp: 0, cp: 0 }]);
    });

    it('cancels without emitting, and a later edit starts from the real amounts', async () => {
      const { fixture, el, saved } = await editing();
      typeInto(fields(el)[1], '99');
      press(byClass(el, 'hk-pouch__cancel'));
      fixture.detectChanges();
      expect(saved).toEqual([]);
      expect(stacks(el)).toHaveLength(4);
      press(el.querySelector<HTMLButtonElement>('button[hk-icon-button]')!);
      fixture.detectChanges();
      expect(fields(el)[1].value).toBe('38');
    });
  });

  it('hides the edit button when not editable', async () => {
    const { el } = await mount(HkCoinPouchComponent, { ...base, editable: false });
    expect(el.querySelector('button')).toBeNull();
  });

  describe('electrum (optional fifth metal)', () => {
    const withEp = { coins: { ...coins, ep: 3 }, total: null };

    it('draws an electrum stack only while the purse holds some; none when ep is absent or zero', async () => {
      expect(stacks((await mount(HkCoinPouchComponent, base)).el)).toHaveLength(4);
      expect(
        stacks((await mount(HkCoinPouchComponent, { coins: { ...coins, ep: 0 } })).el),
      ).toHaveLength(4);
      const { el } = await mount(HkCoinPouchComponent, withEp);
      expect(stacks(el).map((st) => st.getAttribute('aria-label'))).toContain('3 electrum pieces');
    });

    it('edit mode always offers the electrum field when the caller supplies ep, and saves it back', async () => {
      const m = await mount(HkCoinPouchComponent, { coins: { ...coins, ep: 0 } });
      const saved: unknown[] = [];
      m.fixture.componentInstance.save.subscribe((v) => saved.push(v));
      press(m.el.querySelector<HTMLButtonElement>('button[hk-icon-button]')!);
      m.fixture.detectChanges();
      const labels = Array.from(m.el.querySelectorAll('hk-number-field label')).map((l) =>
        l.textContent?.trim(),
      );
      expect(labels).toEqual(['Platinum', 'Gold', 'Electrum', 'Silver', 'Copper']);
      const fields = Array.from(m.el.querySelectorAll<HTMLInputElement>('hk-number-field input'));
      typeInto(fields[2], '5');
      press(m.el.querySelector<HTMLButtonElement>('.hk-pouch__save')!);
      expect(saved).toEqual([{ pp: 1, gp: 38, ep: 5, sp: 0, cp: 7 }]);
    });
  });
});
