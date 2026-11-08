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

function buttons(el: HTMLElement) {
  const all = Array.from(el.querySelectorAll<HTMLButtonElement>('button'));
  const named = (label: string) => all.find((b) => b.textContent?.trim().startsWith(label))!;
  return { damage: named('Damage'), heal: named('Heal'), temp: named('Temp') };
}

describe('HkHpGaugeComponent', () => {
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
      '31 of 44 hit points, plus 5 temporary',
    );
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

  it('emits damage with the typed amount and clears the field', async () => {
    const { fixture, el } = await make({ current: 31, max: 44, temp: 0 });
    const events: number[] = [];
    fixture.componentInstance.damage.subscribe((n) => events.push(n));
    await type(fixture, el, '7');
    buttons(el).damage.click();
    expect(events).toEqual([7]);
    await fixture.whenStable();
    expect(el.querySelector('input')!.value).toBe('');
  });

  it('emits heal and setTemp with the typed amount', async () => {
    const { fixture, el } = await make({ current: 31, max: 44, temp: 0 });
    const heals: number[] = [];
    const temps: number[] = [];
    fixture.componentInstance.heal.subscribe((n) => heals.push(n));
    fixture.componentInstance.setTemp.subscribe((n) => temps.push(n));
    await type(fixture, el, '4');
    buttons(el).heal.click();
    await type(fixture, el, '9');
    buttons(el).temp.click();
    expect(heals).toEqual([4]);
    expect(temps).toEqual([9]);
  });

  it('emits nothing without a positive whole amount, and says why only by description', async () => {
    const { fixture, el } = await make({ current: 31, max: 44, temp: 0 });
    const events: number[] = [];
    fixture.componentInstance.damage.subscribe((n) => events.push(n));
    buttons(el).damage.click();
    await type(fixture, el, '-3');
    buttons(el).damage.click();
    await type(fixture, el, '2.5');
    buttons(el).damage.click();
    expect(events).toEqual([]);
    expect(buttons(el).damage.getAttribute('aria-disabled')).toBe('true');
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
      return Array.from(el.querySelectorAll('button')).map((b) =>
        b.classList.contains('hk-button--phone')
          ? 'phone'
          : b.classList.contains('hk-button--m')
            ? 'm'
            : '?',
      );
    };
    try {
      expect(await sizes(true)).toEqual(['phone', 'phone', 'phone']);
      TestBed.resetTestingModule();
      expect(await sizes(false)).toEqual(['m', 'm', 'm']);
    } finally {
      if (original) Object.defineProperty(window, 'matchMedia', original);
      else Reflect.deleteProperty(window, 'matchMedia');
    }
  });
});
