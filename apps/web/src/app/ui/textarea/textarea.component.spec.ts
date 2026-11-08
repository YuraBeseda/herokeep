import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { mount, typeInto } from '../testing/harness';
import { provideShellTransloco } from '../testing/transloco-testing';
import { HkTextareaComponent } from './textarea.component';

function area(el: HTMLElement) {
  return el.querySelector<HTMLTextAreaElement>('textarea')!;
}

describe('HkTextareaComponent', () => {
  it('renders a labelled textarea with rows, placeholder and maxlength', async () => {
    const { el } = await mount(HkTextareaComponent, {
      label: 'Notes',
      placeholder: 'Anything…',
      rows: 4,
      maxLength: 500,
    });
    expect(el.querySelector('label')!.htmlFor).toBe(area(el).id);
    expect(area(el).rows).toBe(4);
    expect(area(el).placeholder).toBe('Anything…');
    expect(area(el).maxLength).toBe(500);
  });

  it('defaults to three rows', async () => {
    const { el } = await mount(HkTextareaComponent, { label: 'Notes' });
    expect(area(el).rows).toBe(3);
  });

  it('reports typed text, including new lines', async () => {
    const { fixture, el } = await mount(HkTextareaComponent, { label: 'Notes' });
    typeInto(area(el), 'one\ntwo');
    expect(fixture.componentInstance.value()).toBe('one\ntwo');
  });

  it('links hint and error like the text field', async () => {
    const { el } = await mount(HkTextareaComponent, { label: 'Notes', error: 'Too long' });
    const msg = el.querySelector<HTMLElement>('.hk-field__msg--error')!;
    expect(area(el).getAttribute('aria-invalid')).toBe('true');
    expect(area(el).getAttribute('aria-describedby')).toBe(msg.id);
  });

  it('integrates with reactive forms', async () => {
    @Component({
      imports: [ReactiveFormsModule, HkTextareaComponent],
      template: `<hk-textarea [label]="'Notes'" [formControl]="ctl" />`,
    })
    class Host {
      readonly ctl = new FormControl('hello', { nonNullable: true });
    }
    await TestBed.configureTestingModule({
      providers: [provideShellTransloco()],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(area(el).value).toBe('hello');
    typeInto(area(el), 'bye');
    expect(fixture.componentInstance.ctl.value).toBe('bye');
    area(el).dispatchEvent(new Event('blur'));
    expect(fixture.componentInstance.ctl.touched).toBe(true);
    fixture.componentInstance.ctl.disable();
    fixture.detectChanges();
    expect(area(el).disabled).toBe(true);
  });
});
