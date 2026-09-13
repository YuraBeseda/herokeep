import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { SheetSectionComponent } from './sheet-section.component';

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({ sheet: { sections: { equipment: 'Equipment' } } });
  }
}

@Component({
  selector: 'app-sheet-section-host',
  imports: [SheetSectionComponent],
  template: `
    <hk-sheet-section [titleKey]="'sheet.sections.equipment'" [collapsible]="collapsible()">
      <p>{{ bodyText() }}</p>
    </hk-sheet-section>
  `,
})
class HostComponent {
  readonly collapsible = signal(false);
  readonly bodyText = signal('Longsword, shield');
}

describe('SheetSectionComponent', () => {
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

  it('renders the translated title and always shows projected content when not collapsible', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Equipment');
    expect(compiled.querySelector('p')?.textContent).toBe('Longsword, shield');
    expect(compiled.querySelector('button')).toBeNull();
  });

  it('renders a toggle button when collapsible, defaulting to expanded', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.collapsible.set(true);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const toggle = compiled.querySelector<HTMLButtonElement>('.hk-sheet-section__toggle')!;
    expect(toggle).not.toBeNull();
    expect(toggle.textContent?.trim()).toBe('Equipment');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const body = compiled.querySelector<HTMLElement>('.hk-sheet-section__body')!;
    expect(body.hidden).toBe(false);
    expect(toggle.getAttribute('aria-controls')).toBe(body.id);
    expect(body.id).toBeTruthy();
  });

  it('toggles the body hidden state and aria-expanded on click', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.collapsible.set(true);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const toggle = compiled.querySelector<HTMLButtonElement>('.hk-sheet-section__toggle')!;
    const body = compiled.querySelector<HTMLElement>('.hk-sheet-section__body')!;

    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);

    toggle.click();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
  });
});
