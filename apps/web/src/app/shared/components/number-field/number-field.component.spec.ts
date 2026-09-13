import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { NumberFieldComponent } from './number-field.component';

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({ characters: { abilities: { str: 'Strength' } } });
  }
}

@Component({
  selector: 'app-number-field-host',
  imports: [NumberFieldComponent, ReactiveFormsModule],
  template: `
    <hk-number-field
      [labelKey]="'characters.abilities.str'"
      [min]="8"
      [max]="20"
      [step]="1"
      [formControl]="control"
    />
  `,
})
class HostComponent {
  readonly control = new FormControl<number | null>(10);
}

describe('NumberFieldComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTransloco({
          config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true },
          loader: StubLoader,
        }),
      ],
    }).compileComponents();
  });

  it('renders the translated label and the min/max/step on the native input', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.hk-number-field__label')?.textContent?.trim()).toBe('Strength');
    const input = compiled.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(input.min).toBe('8');
    expect(input.max).toBe('20');
    expect(input.step).toBe('1');
  });

  it('writeValue: reflects the FormControl initial value on the native input', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(input.value).toBe('10');
  });

  it('registerOnChange: typing writes back to the FormControl', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('input[type="number"]')!;

    input.value = '15';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(fixture.componentInstance.control.value).toBe(15);
  });

  it('writeValue: a later FormControl.setValue re-renders the native input', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    fixture.componentInstance.control.setValue(18);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(input.value).toBe('18');
  });

  it('setDisabledState: FormControl.disable() disables the native input', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    fixture.componentInstance.control.disable();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(input.disabled).toBe(true);
  });
});
