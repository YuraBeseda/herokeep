import { hintOf, mount, press } from '../testing/harness';
import { HkPickerCardComponent } from './picker-card.component';

const base = {
  name: 'Elf',
  description: 'Graceful and long-lived.',
  icon: 'ui:heroes',
  meta: ['Medium', 'Darkvision'],
};

function choose(el: HTMLElement): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>('.hk-picker-card__choose')!;
}

describe('HkPickerCardComponent', () => {
  it('shows the name, the description line and the meta chips', async () => {
    const { el } = await mount(HkPickerCardComponent, base);
    expect(el.querySelector('.hk-picker-card__name')!.textContent).toBe('Elf');
    expect(el.querySelector('.hk-picker-card__desc')!.textContent).toBe('Graceful and long-lived.');
    expect(
      Array.from(el.querySelectorAll('.hk-tag-chip__label')).map((c) => c.textContent),
    ).toEqual(['Medium', 'Darkvision']);
    expect(choose(el).textContent.trim()).toBe('Choose');
  });

  it('opens the details from the card body and picks from the Choose button, never both', async () => {
    const { fixture, el } = await mount(HkPickerCardComponent, base);
    const picked = vi.fn();
    const opened = vi.fn();
    fixture.componentInstance.choose.subscribe(picked);
    fixture.componentInstance.details.subscribe(opened);

    const body = el.querySelector<HTMLButtonElement>('.hk-picker-card__body')!;
    expect(body.getAttribute('aria-label')).toBe('Details: Elf');
    press(body);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(picked).not.toHaveBeenCalled();

    press(choose(el));
    expect(picked).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('a selected card wears the seal and its button reads Chosen, pressed', async () => {
    const { el } = await mount(HkPickerCardComponent, { ...base, selected: true });
    expect(el.querySelector('hk-wax-seal')).not.toBeNull();
    expect(choose(el).textContent.trim()).toBe('Chosen');
    expect(choose(el).getAttribute('aria-pressed')).toBe('true');
  });

  it('a gated card prints the reason, keeps it as the Choose hint and cannot be chosen, but still opens its details', async () => {
    const { fixture, el } = await mount(HkPickerCardComponent, {
      ...base,
      gated: true,
      reason: 'Needs 2 more levels',
    });
    const picked = vi.fn();
    const opened = vi.fn();
    fixture.componentInstance.choose.subscribe(picked);
    fixture.componentInstance.details.subscribe(opened);

    expect(el.querySelector('.hk-picker-card__gate')!.textContent).toContain('Needs 2 more levels');
    expect(choose(el).getAttribute('aria-disabled')).toBe('true');
    expect(hintOf(choose(el))).toBe('Needs 2 more levels');

    press(choose(el));
    expect(picked).not.toHaveBeenCalled();
    press(el.querySelector('.hk-picker-card__body')!);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('an already selected gated card can still be un-chosen', async () => {
    const { fixture, el } = await mount(HkPickerCardComponent, {
      ...base,
      gated: true,
      selected: true,
      reason: 'Needs 2 more levels',
    });
    const picked = vi.fn();
    fixture.componentInstance.choose.subscribe(picked);
    expect(choose(el).getAttribute('aria-disabled')).toBeNull();
    press(choose(el));
    expect(picked).toHaveBeenCalledTimes(1);
  });
});
