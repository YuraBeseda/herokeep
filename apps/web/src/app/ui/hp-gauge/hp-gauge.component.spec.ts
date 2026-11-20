import { TestBed } from '@angular/core/testing';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkHpGaugeComponent } from './hp-gauge.component';

async function make(inputs: Record<string, unknown>) {
  await TestBed.configureTestingModule({
    providers: [provideShellTransloco()],
  }).compileComponents();
  const fixture = TestBed.createComponent(HkHpGaugeComponent);
  for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

async function type(fixture: { whenStable(): Promise<unknown> }, el: HTMLElement, value: string) {
  const input = el.querySelector<HTMLInputElement>('input')!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await fixture.whenStable();
}

/** Chooses an item from the split action's caret menu (it runs the item). */
async function choose(fixture: { whenStable(): Promise<unknown> }, el: HTMLElement, id: string) {
  el.querySelector<HTMLButtonElement>('.hk-menu-button')!.click();
  await fixture.whenStable();
  document.querySelector<HTMLButtonElement>(`[data-menu-item="${id}"]`)!.click();
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
}

function main(el: HTMLElement) {
  return el.querySelector<HTMLButtonElement>('.hk-split__main')!;
}

describe('HkHpGaugeComponent', () => {
  beforeEach(() => localStorage.clear());

  it('names its meter', async () => {
    const { el } = await make({ current: 5, max: 10, temp: 0 });
    expect(el.querySelector('[role="meter"]')!.getAttribute('aria-label')).toBe('Hit points');
  });

  it('is a meter with now/min/max and a text alternative', async () => {
    const { el } = await make({ current: 31, max: 44, temp: 0 });
    const meter = el.querySelector('[role="meter"]')!;
    expect(meter.getAttribute('aria-valuenow')).toBe('31');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('44');
    expect(meter.getAttribute('aria-valuetext')).toBe('31 of 44 hit points');
  });

  it('mentions temporary hit points in the text alternative', async () => {
    const { el } = await make({ current: 31, max: 44, temp: 5 });
    expect(el.querySelector('[role="meter"]')!.getAttribute('aria-valuetext')).toBe(
      '31 of 44 hit points, 5 temporary',
    );
  });

  it('shows the temporary hit points as a chip only when there are some', async () => {
    const { el } = await make({ current: 23, max: 31, temp: 5 });
    expect(el.querySelector('.hk-hp-gauge__temp')!.textContent?.trim()).toBe('+5 temp');
    expect(el.querySelector('[role="meter"]')!.getAttribute('aria-valuetext')).toBe(
      '23 of 31 hit points, 5 temporary',
    );
    TestBed.resetTestingModule();
    expect(
      (await make({ current: 23, max: 31, temp: 0 })).el.querySelector('.hk-hp-gauge__temp'),
    ).toBeNull();
  });

  it('sizes the ember and hatch segments against max + temp', async () => {
    const { el } = await make({ current: 20, max: 40, temp: 10 });
    expect(el.querySelector<HTMLElement>('.hk-gauge__hp')!.style.width).toBe('40%');
    expect(el.querySelector<HTMLElement>('.hk-gauge__temp')!.style.width).toBe('20%');
  });

  it('never overflows the track for over-max values', async () => {
    const { el } = await make({ current: 90, max: 40, temp: 0 });
    expect(el.querySelector<HTMLElement>('.hk-gauge__hp')!.style.width).toBe('100%');
  });

  it('shows current and max as numerals', async () => {
    const { el } = await make({ current: 31, max: 44, temp: 0 });
    expect(el.querySelector('.hk-hp-gauge__current')!.textContent?.trim()).toBe('31');
    expect(el.querySelector('.hk-hp-gauge__max')!.textContent?.replace(/\s+/g, '')).toBe('/44');
  });

  it('emits damage with the typed amount from the main button and clears the field', async () => {
    const { fixture, el } = await make({ current: 31, max: 44, temp: 0 });
    const events: number[] = [];
    fixture.componentInstance.damage.subscribe((n) => events.push(n));
    await type(fixture, el, '7');
    main(el).click();
    expect(events).toEqual([7]);
    await fixture.whenStable();
    expect(el.querySelector('input')!.value).toBe('');
  });

  it('Enter applies the action the main button shows', async () => {
    const { fixture, el } = await make({ current: 31, max: 44, temp: 0 });
    const events: number[] = [];
    fixture.componentInstance.damage.subscribe((n) => events.push(n));
    await type(fixture, el, '3');
    el.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(events).toEqual([3]);
  });

  it('emits heal and setTemp from the menu, and the main button then repeats the last one', async () => {
    const { fixture, el } = await make({ current: 31, max: 44, temp: 0 });
    const heals: number[] = [];
    const temps: number[] = [];
    fixture.componentInstance.heal.subscribe((n) => heals.push(n));
    fixture.componentInstance.setTemp.subscribe((n) => temps.push(n));
    await type(fixture, el, '4');
    await choose(fixture, el, 'heal');
    expect(main(el).textContent).toContain('Heal');
    await type(fixture, el, '9');
    await choose(fixture, el, 'setTemp');
    expect(main(el).textContent).toContain('Temp HP');
    await type(fixture, el, '2');
    main(el).click();
    expect(heals).toEqual([4]);
    expect(temps).toEqual([9, 2]);
  });

  it('emits nothing without a positive whole amount, and says why only by description', async () => {
    const { fixture, el } = await make({ current: 31, max: 44, temp: 0 });
    const events: number[] = [];
    fixture.componentInstance.damage.subscribe((n) => events.push(n));
    main(el).click();
    await type(fixture, el, '-3');
    main(el).click();
    await type(fixture, el, '2.5');
    main(el).click();
    expect(events).toEqual([]);
    expect(main(el).getAttribute('aria-disabled')).toBe('true');
    const visible = el.cloneNode(true) as HTMLElement;
    visible.querySelectorAll('[hidden]').forEach((node) => node.remove());
    expect(visible.textContent).not.toContain('Enter an amount');
  });

  it('labels the amount field for assistive tech without a visible label', async () => {
    const { el } = await make({ current: 1, max: 2, temp: 0 });
    const input = el.querySelector('input')!;
    expect(input.getAttribute('aria-label')).toBe('Amount');
    expect(input.inputMode).toBe('numeric');
  });

  it('keeps aria-valuenow inside the range when current exceeds max or max is 0', async () => {
    const over = await make({ current: 90, max: 40, temp: 0 });
    const meter = over.el.querySelector('[role="meter"]')!;
    expect(meter.getAttribute('aria-valuenow')).toBe('40');
    expect(meter.getAttribute('aria-valuemax')).toBe('40');
    TestBed.resetTestingModule();
    const zero = await make({ current: 0, max: 0, temp: 0 });
    const range = zero.el.querySelector('[role="meter"]')!;
    expect(range.getAttribute('aria-valuemax')).toBe('1');
    expect(range.getAttribute('aria-valuenow')).toBe('0');
    TestBed.resetTestingModule();
    const negative = await make({ current: -5, max: 10, temp: 0 });
    expect(negative.el.querySelector('[role="meter"]')!.getAttribute('aria-valuenow')).toBe('0');
  });

  it('gives its buttons the phone size on coarse pointers and m otherwise', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    const stub = (coarse: boolean) => {
      window.matchMedia = ((query: string) => ({
        matches: coarse && query === '(pointer: coarse)',
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })) as unknown as typeof window.matchMedia;
    };
    const sizes = async (coarse: boolean) => {
      stub(coarse);
      const { el } = await make({ current: 1, max: 2, temp: 0 });
      return Array.from(el.querySelectorAll('.hk-split__main')).map((b) =>
        b.classList.contains('hk-button--phone')
          ? 'phone'
          : b.classList.contains('hk-button--m')
            ? 'm'
            : '?',
      );
    };
    try {
      expect(await sizes(true)).toEqual(['phone']);
      TestBed.resetTestingModule();
      expect(await sizes(false)).toEqual(['m']);
    } finally {
      if (original) Object.defineProperty(window, 'matchMedia', original);
      else Reflect.deleteProperty(window, 'matchMedia');
    }
  });
});
