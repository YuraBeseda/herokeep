import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { mount, press } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkToggleComponent } from './toggle.component';

function sw(el: HTMLElement) {
  return el.querySelector<HTMLButtonElement>('button[role="switch"]')!;
}

describe('HkToggleComponent', () => {
  it('is a switch named by its label and starts off', async () => {
    const { el } = await mount(HkToggleComponent, { label: 'Variant encumbrance' });
    expect(sw(el).getAttribute('aria-checked')).toBe('false');
    expect(sw(el).textContent).toContain('Variant encumbrance');
  });

  it('flips on a real press and reports the value', async () => {
    const { fixture, el } = await mount(HkToggleComponent, { label: 'Sound' });
    press(sw(el));
    fixture.detectChanges();
    expect(sw(el).getAttribute('aria-checked')).toBe('true');
    expect(fixture.componentInstance.value()).toBe(true);
    press(sw(el));
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe(false);
  });

  it('flips with a touch tap', async () => {
    const { fixture, el } = await mount(HkToggleComponent, { label: 'Sound' });
    press(sw(el), 'touch');
    expect(fixture.componentInstance.value()).toBe(true);
  });

  it('does nothing while disabled', async () => {
    const { fixture, el } = await mount(HkToggleComponent, { label: 'Sound', disabled: true });
    expect(sw(el).disabled).toBe(true);
    press(sw(el));
    expect(fixture.componentInstance.value()).toBe(false);
  });

  it('carries the optional description as the accessible description', async () => {
    const { el } = await mount(HkToggleComponent, { label: 'Sound', description: 'Dice clatter' });
    const note = el.querySelector<HTMLElement>('.hk-toggle__note')!;
    expect(note.textContent?.trim()).toBe('Dice clatter');
    expect(sw(el).getAttribute('aria-describedby')).toBe(note.id);
  });

  it('integrates with reactive forms', async () => {
    @Component({
      imports: [ReactiveFormsModule, HkToggleComponent],
      template: `<hk-toggle [label]="'Sound'" [formControl]="ctl" />`,
    })
    class Host {
      readonly ctl = new FormControl(true, { nonNullable: true });
    }
    await TestBed.configureTestingModule({
      providers: [provideShellTransloco()],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(sw(el).getAttribute('aria-checked')).toBe('true');
    press(sw(el));
    expect(fixture.componentInstance.ctl.value).toBe(false);
    expect(fixture.componentInstance.ctl.touched).toBe(false);
    sw(el).dispatchEvent(new Event('blur'));
    expect(fixture.componentInstance.ctl.touched).toBe(true);
    fixture.componentInstance.ctl.disable();
    fixture.detectChanges();
    expect(sw(el).disabled).toBe(true);
  });
});
