import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { mount } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkSelectComponent } from './select.component';

const options = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'off', label: 'Off', disabled: true },
];
const base = { label: 'Theme', options };

function select(el: HTMLElement) {
  return el.querySelector<HTMLSelectElement>('select')!;
}

describe('HkSelectComponent', () => {
  it('renders a labelled native select with the options', async () => {
    const { el } = await mount(HkSelectComponent, base);
    expect(el.querySelector('label')!.htmlFor).toBe(select(el).id);
    expect(Array.from(select(el).options).map((o) => o.textContent?.trim())).toEqual([
      'Light',
      'Dark',
      'Off',
    ]);
    expect(select(el).options[2].disabled).toBe(true);
  });

  it('adds a placeholder option while nothing is chosen', async () => {
    const { fixture, el } = await mount(HkSelectComponent, { ...base, placeholder: 'Choose…' });
    expect(select(el).options[0].textContent?.trim()).toBe('Choose…');
    expect(select(el).options[0].disabled).toBe(true);
    expect(select(el).value).toBe('');
    fixture.componentRef.setInput('value', 'dark');
    await fixture.whenStable();
    expect(select(el).value).toBe('dark');
  });

  it('reports the chosen value on change', async () => {
    const { fixture, el } = await mount(HkSelectComponent, { ...base, value: 'light' });
    select(el).value = 'dark';
    select(el).dispatchEvent(new Event('change', { bubbles: true }));
    expect(fixture.componentInstance.value()).toBe('dark');
  });

  it('links an error message and marks the select invalid', async () => {
    const { el } = await mount(HkSelectComponent, { ...base, error: 'Pick one' });
    const message = el.querySelector<HTMLElement>('.hk-field__msg--error')!;
    expect(select(el).getAttribute('aria-invalid')).toBe('true');
    expect(select(el).getAttribute('aria-describedby')).toContain(message.id);
  });

  it('integrates with reactive forms', async () => {
    @Component({
      imports: [ReactiveFormsModule, HkSelectComponent],
      template: `<hk-select [label]="'Theme'" [options]="options" [formControl]="ctl" />`,
    })
    class Host {
      readonly options = options;
      readonly ctl = new FormControl<string | null>('dark');
    }
    await TestBed.configureTestingModule({
      providers: [provideShellTransloco()],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(select(el).value).toBe('dark');
    select(el).value = 'light';
    select(el).dispatchEvent(new Event('change', { bubbles: true }));
    expect(fixture.componentInstance.ctl.value).toBe('light');
    select(el).dispatchEvent(new Event('blur'));
    expect(fixture.componentInstance.ctl.touched).toBe(true);
    fixture.componentInstance.ctl.disable();
    fixture.detectChanges();
    expect(select(el).disabled).toBe(true);
  });
});
