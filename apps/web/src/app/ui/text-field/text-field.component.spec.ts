import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { mount, typeInto } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkTextFieldComponent } from './text-field.component';

function input(el: HTMLElement) {
  return el.querySelector<HTMLInputElement>('input')!;
}

describe('HkTextFieldComponent', () => {
  it('renders a labelled input with placeholder and type', async () => {
    const { el } = await mount(HkTextFieldComponent, {
      label: 'Name',
      placeholder: 'Aria',
      type: 'email',
    });
    expect(el.querySelector('label')!.htmlFor).toBe(input(el).id);
    expect(input(el).placeholder).toBe('Aria');
    expect(input(el).type).toBe('email');
  });

  it('reports typed text', async () => {
    const { fixture, el } = await mount(HkTextFieldComponent, { label: 'Name' });
    typeInto(input(el), 'Aria');
    expect(fixture.componentInstance.value()).toBe('Aria');
  });

  it('shows the hint under the field and links it', async () => {
    const { el } = await mount(HkTextFieldComponent, { label: 'Name', hint: 'As on the sheet' });
    const msg = el.querySelector<HTMLElement>('.hk-field__msg')!;
    expect(msg.textContent?.trim()).toBe('As on the sheet');
    expect(input(el).getAttribute('aria-describedby')).toBe(msg.id);
    expect(input(el).getAttribute('aria-invalid')).toBeNull();
  });

  it('an error replaces the hint, is linked, and marks the input invalid', async () => {
    const { el } = await mount(HkTextFieldComponent, {
      label: 'Name',
      hint: 'As on the sheet',
      error: 'Required',
    });
    const msg = el.querySelector<HTMLElement>('.hk-field__msg')!;
    expect(msg.classList.contains('hk-field__msg--error')).toBe(true);
    expect(msg.textContent).toContain('Required');
    expect(msg.textContent).not.toContain('As on the sheet');
    expect(input(el).getAttribute('aria-invalid')).toBe('true');
    expect(input(el).getAttribute('aria-describedby')).toBe(msg.id);
    expect(input(el).classList.contains('hk-input--error')).toBe(true);
  });

  it('passes maxlength and autocomplete through', async () => {
    const { el } = await mount(HkTextFieldComponent, {
      label: 'Name',
      maxLength: 40,
      autocomplete: 'off',
    });
    expect(input(el).maxLength).toBe(40);
    expect(input(el).getAttribute('autocomplete')).toBe('off');
  });

  it('integrates with reactive forms', async () => {
    @Component({
      imports: [ReactiveFormsModule, HkTextFieldComponent],
      template: `<hk-text-field [label]="'Name'" [formControl]="ctl" />`,
    })
    class Host {
      readonly ctl = new FormControl('Mira', { nonNullable: true });
    }
    await TestBed.configureTestingModule({
      providers: [provideShellTransloco()],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(input(el).value).toBe('Mira');
    typeInto(input(el), 'Mirela');
    expect(fixture.componentInstance.ctl.value).toBe('Mirela');
    fixture.componentInstance.ctl.setValue('Zed');
    fixture.detectChanges();
    expect(input(el).value).toBe('Zed');
    input(el).dispatchEvent(new Event('blur'));
    expect(fixture.componentInstance.ctl.touched).toBe(true);
    fixture.componentInstance.ctl.disable();
    fixture.detectChanges();
    expect(input(el).disabled).toBe(true);
  });
});
