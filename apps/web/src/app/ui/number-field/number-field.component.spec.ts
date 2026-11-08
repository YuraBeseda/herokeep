import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { hintOf, mount, press, typeInto } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkNumberFieldComponent } from './number-field.component';

const base = { label: 'Damage', min: 0, max: 5, step: 1 };

function input(el: HTMLElement) {
  return el.querySelector<HTMLInputElement>('input')!;
}
function minus(el: HTMLElement) {
  return el.querySelector<HTMLButtonElement>('.hk-numfield__minus')!;
}
function plus(el: HTMLElement) {
  return el.querySelector<HTMLButtonElement>('.hk-numfield__plus')!;
}

describe('HkNumberFieldComponent', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders a visible label bound to a number input with the range attributes', async () => {
    const { el } = await mount(HkNumberFieldComponent, base);
    const label = el.querySelector<HTMLLabelElement>('label')!;
    expect(label.textContent?.trim()).toBe('Damage');
    expect(label.htmlFor).toBe(input(el).id);
    expect(input(el).type).toBe('number');
    expect(input(el).min).toBe('0');
    expect(input(el).max).toBe('5');
    expect(input(el).step).toBe('1');
  });

  it('names the buttons after the step and the field', async () => {
    const { el } = await mount(HkNumberFieldComponent, { ...base, step: 5, max: 100 });
    expect(minus(el).getAttribute('aria-label')).toBe('Decrease Damage by 5');
    expect(plus(el).getAttribute('aria-label')).toBe('Increase Damage by 5');
  });

  it('steps up and down with a real press and reports the value', async () => {
    const { fixture, el } = await mount(HkNumberFieldComponent, { ...base, value: 2 });
    const seen: (number | null)[] = [];
    fixture.componentInstance.value.subscribe((v) => seen.push(v));
    press(plus(el));
    fixture.detectChanges();
    expect(input(el).value).toBe('3');
    press(minus(el));
    press(minus(el));
    fixture.detectChanges();
    expect(input(el).value).toBe('1');
    expect(seen).toEqual([3, 2, 1]);
  });

  it('treats an empty field as zero for the first step', async () => {
    const { fixture, el } = await mount(HkNumberFieldComponent, { ...base, min: -5 });
    press(plus(el));
    fixture.detectChanges();
    expect(input(el).value).toBe('1');
  });

  it('does not step past the maximum and says why in the hint', async () => {
    const { fixture, el } = await mount(HkNumberFieldComponent, { ...base, value: 5 });
    expect(plus(el).getAttribute('aria-disabled')).toBe('true');
    press(plus(el));
    fixture.detectChanges();
    expect(input(el).value).toBe('5');
    expect(hintOf(plus(el))).toBe('Damage is at its maximum, 5');
  });

  it('does not step below the minimum and says why in the hint', async () => {
    const { el } = await mount(HkNumberFieldComponent, { ...base, value: 0 });
    expect(minus(el).getAttribute('aria-disabled')).toBe('true');
    expect(hintOf(minus(el))).toBe('Damage is at its minimum, 0');
  });

  it('keeps the at-limit buttons keyboard-focusable (aria-disabled, not disabled)', async () => {
    const { el } = await mount(HkNumberFieldComponent, { ...base, value: 5 });
    expect(plus(el).disabled).toBe(false);
  });

  it('clamps a typed value on commit and writes it back to the field', async () => {
    const { fixture, el } = await mount(HkNumberFieldComponent, base);
    const seen: (number | null)[] = [];
    fixture.componentInstance.value.subscribe((v) => seen.push(v));
    typeInto(input(el), '3');
    expect(seen).toEqual([3]);
    typeInto(input(el), '99');
    expect(seen).toEqual([3]); // out of range: nothing reported while typing
    input(el).dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(input(el).value).toBe('5');
    expect(seen).toEqual([3, 5]);
  });

  it('reports null for an empty field', async () => {
    const { fixture, el } = await mount(HkNumberFieldComponent, { ...base, value: 3 });
    const seen: (number | null)[] = [];
    fixture.componentInstance.value.subscribe((v) => seen.push(v));
    typeInto(input(el), '');
    expect(seen).toEqual([null]);
  });

  it('does not wipe a half-typed minus, and takes the negative number once finished', async () => {
    const { fixture, el } = await mount(HkNumberFieldComponent, {
      label: 'Temp',
      min: -10,
      max: 10,
    });
    const seen: (number | null)[] = [];
    fixture.componentInstance.value.subscribe((v) => seen.push(v));
    // The browser reports a lone "-" as an empty value with badInput.
    Object.defineProperty(input(el), 'validity', { value: { badInput: true }, configurable: true });
    typeInto(input(el), '');
    fixture.detectChanges();
    expect(seen).toEqual([]);
    expect(fixture.componentInstance.value()).toBeNull();
    Object.defineProperty(input(el), 'validity', {
      value: { badInput: false },
      configurable: true,
    });
    typeInto(input(el), '-3');
    expect(seen).toEqual([-3]);
  });

  it.each([
    [{ min: 0 }, 'numeric'],
    [{ min: 0, step: 0.5 }, 'decimal'],
    [{ min: -5 }, 'text'],
    [{}, 'text'],
  ])('asks for the keypad that suits the constraints %j', async (constraints, mode) => {
    const { el } = await mount(HkNumberFieldComponent, { label: 'N', ...constraints });
    expect(input(el).getAttribute('inputmode')).toBe(mode);
  });

  it('uses the 44px phone layout on a coarse pointer', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { el } = await mount(HkNumberFieldComponent, base);
    expect(el.querySelector('.hk-numfield--phone')).not.toBeNull();
  });

  it('links an error message to the input and marks it invalid', async () => {
    const { el } = await mount(HkNumberFieldComponent, { ...base, error: 'Too much' });
    const message = el.querySelector<HTMLElement>('.hk-field__msg--error')!;
    expect(message.textContent).toContain('Too much');
    expect(input(el).getAttribute('aria-invalid')).toBe('true');
    expect(input(el).getAttribute('aria-describedby')).toContain(message.id);
  });

  it('can hide the label visually while keeping it for assistive tech', async () => {
    const { el } = await mount(HkNumberFieldComponent, { ...base, labelHidden: true });
    expect(el.querySelector('label')!.classList.contains('hk-visually-hidden')).toBe(true);
  });

  it('integrates with reactive forms: write, edit, touched and disabled', async () => {
    @Component({
      imports: [ReactiveFormsModule, HkNumberFieldComponent],
      template: `<hk-number-field [label]="'Level'" [min]="1" [max]="20" [formControl]="ctl" />`,
    })
    class Host {
      readonly ctl = new FormControl<number | null>(4);
    }
    await TestBed.configureTestingModule({
      providers: [provideShellTransloco()],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(input(el).value).toBe('4');
    press(plus(el));
    expect(fixture.componentInstance.ctl.value).toBe(5);
    fixture.componentInstance.ctl.setValue(9);
    fixture.detectChanges();
    expect(input(el).value).toBe('9');
    input(el).dispatchEvent(new Event('blur'));
    expect(fixture.componentInstance.ctl.touched).toBe(true);
    fixture.componentInstance.ctl.disable();
    fixture.detectChanges();
    expect(input(el).disabled).toBe(true);
    expect(plus(el).getAttribute('aria-disabled')).toBe('true');
    press(plus(el));
    expect(fixture.componentInstance.ctl.value).toBe(9);
  });
});
