import { hintOf, mount, nameOf } from '../testing/harness';
import { HkConditionChipComponent } from './condition-chip.component';

describe('HkConditionChipComponent', () => {
  it('shows the glyph and the name', async () => {
    const { el } = await mount(HkConditionChipComponent, { name: 'Poisoned' });
    expect(el.querySelector('hk-icon')).not.toBeNull();
    expect(el.querySelector('.hk-cond__name')!.textContent?.trim()).toBe('Poisoned');
  });

  it('renders no badge without a duration or level (the slice-2 slot stays empty)', async () => {
    const { el } = await mount(HkConditionChipComponent, { name: 'Poisoned' });
    expect(el.querySelector('.hk-cond__dur')).toBeNull();
  });

  it('renders the duration badge when one is given', async () => {
    const { el } = await mount(HkConditionChipComponent, {
      name: 'Poisoned',
      duration: '3 rounds',
    });
    expect(el.querySelector('.hk-cond__dur')!.textContent?.trim()).toBe('3 rounds');
  });

  it('shows a level numeral for a levelled condition', async () => {
    const { el } = await mount(HkConditionChipComponent, { name: 'Exhaustion', level: 2 });
    expect(el.querySelector('.hk-cond__dur')!.textContent?.trim()).toBe('2');
  });

  it('gives a chip without an end or lock control the same end padding as its start', async () => {
    const { fixture, el } = await mount(HkConditionChipComponent, { name: 'Poisoned' });
    expect(el.classList.contains('hk-cond--plain')).toBe(true);
    fixture.componentRef.setInput('removable', true);
    await fixture.whenStable();
    expect(el.classList.contains('hk-cond--plain')).toBe(false);
    fixture.componentRef.setInput('removable', false);
    fixture.componentRef.setInput('locked', true);
    await fixture.whenStable();
    expect(el.classList.contains('hk-cond--plain')).toBe(false);
  });

  it('uses the arcane tone for a beneficial effect', async () => {
    const { el } = await mount(HkConditionChipComponent, { name: 'Blessed', tone: 'arcane' });
    expect(el.classList.contains('hk-cond--arcane')).toBe(true);
  });

  it('has no end button unless removable, and emits remove when pressed', async () => {
    const { fixture, el } = await mount(HkConditionChipComponent, { name: 'Poisoned' });
    expect(el.querySelector('.hk-cond__end')).toBeNull();
    fixture.componentRef.setInput('removable', true);
    await fixture.whenStable();
    const end = el.querySelector<HTMLButtonElement>('.hk-cond__end')!;
    expect(nameOf(end)).toBe('End Poisoned');
    expect(hintOf(end)).toBe('End Poisoned');
    let removed = 0;
    fixture.componentInstance.remove.subscribe(() => removed++);
    end.click();
    expect(removed).toBe(1);
  });

  it('locked shows the lock glyph and the hint, never text, and offers no end button', async () => {
    const { el } = await mount(HkConditionChipComponent, {
      name: 'Frightened',
      removable: true,
      locked: true,
    });
    expect(el.querySelector('.hk-cond__end')).toBeNull();
    const lock = el.querySelector('.hk-cond__lock')!;
    expect(lock.querySelector('hk-icon')).not.toBeNull();
    expect(lock.getAttribute('role')).toBe('img');
    expect(nameOf(lock)).toBe('Locked');
    expect(hintOf(lock)).toBe('Locked');
    expect(lock.textContent?.trim()).toBe('');
  });

  it('puts the whole story in the chip hint, defaulting to the name', async () => {
    const { fixture, el } = await mount(HkConditionChipComponent, { name: 'Poisoned' });
    const main = el.querySelector('.hk-cond__main')!;
    expect(hintOf(main)).toBe('Poisoned');
    fixture.componentRef.setInput('hint', 'Poisoned, 3 rounds left, from Giant Spider');
    await fixture.whenStable();
    expect(hintOf(main)).toBe('Poisoned, 3 rounds left, from Giant Spider');
    expect(nameOf(main)).toBe('Poisoned, 3 rounds left, from Giant Spider');
  });

  it('announces the level and duration badges in the default story', async () => {
    const { fixture, el } = await mount(HkConditionChipComponent, {
      name: 'Exhaustion',
      level: 2,
    });
    const main = el.querySelector('.hk-cond__main')!;
    expect(nameOf(main)).toBe('Exhaustion, level 2');
    expect(hintOf(main)).toBe('Exhaustion, level 2');
    fixture.componentRef.setInput('level', null);
    fixture.componentRef.setInput('duration', '3 rounds');
    await fixture.whenStable();
    expect(nameOf(main)).toBe('Exhaustion, 3 rounds');
    fixture.componentRef.setInput('level', 2);
    await fixture.whenStable();
    expect(nameOf(main)).toBe('Exhaustion, level 2, 3 rounds');
  });
});
