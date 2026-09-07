import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { SearchFieldComponent } from './search-field.component';

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({
      library: {
        search: {
          placeholder: 'Search the library',
          clear: 'Clear search',
        },
      },
    });
  }
}

@Component({
  selector: 'app-search-field-host',
  imports: [SearchFieldComponent],
  template: `
    <hk-search-field
      [(value)]="value"
      [placeholderKey]="'library.search.placeholder'"
      [clearLabelKey]="'library.search.clear'"
      (cleared)="onCleared()"
    />
  `,
})
class HostComponent {
  value = signal('');
  clears = 0;

  onCleared(): void {
    this.clears++;
  }
}

describe('SearchFieldComponent', () => {
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

  // Fake timers are enabled only *after* the fixture has stabilized: `fixture.whenStable()`
  // depends on real macrotasks internally, so awaiting it while timers are faked hangs.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the translated placeholder and clear label', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const input = compiled.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(input.getAttribute('placeholder')).toBe('Search the library');
    const clearButton = compiled.querySelector<HTMLButtonElement>('.hk-search-field__clear')!;
    expect(clearButton.getAttribute('aria-label')).toBe('Clear search');
  });

  it('debounces typing for 150ms before writing the value model', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('input[type="search"]')!;

    vi.useFakeTimers();
    input.value = 'dragon';
    input.dispatchEvent(new Event('input'));
    TestBed.tick();

    expect(fixture.componentInstance.value()).toBe('');

    vi.advanceTimersByTime(149);
    TestBed.tick();
    expect(fixture.componentInstance.value()).toBe('');

    vi.advanceTimersByTime(1);
    TestBed.tick();
    expect(fixture.componentInstance.value()).toBe('dragon');
  });

  it('resets the value immediately and emits cleared when the clear button is clicked', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const input = compiled.querySelector<HTMLInputElement>('input[type="search"]')!;

    vi.useFakeTimers();
    input.value = 'dragon';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(150);
    TestBed.tick();
    expect(fixture.componentInstance.value()).toBe('dragon');

    const clearButton = compiled.querySelector<HTMLButtonElement>('.hk-search-field__clear')!;
    clearButton.click();
    TestBed.tick();

    expect(fixture.componentInstance.value()).toBe('');
    expect(input.value).toBe('');
    expect(fixture.componentInstance.clears).toBe(1);

    // Clearing must not be debounced — no timer advance was needed above, and advancing past
    // the debounce window now must not re-write a stale draft.
    vi.advanceTimersByTime(150);
    TestBed.tick();
    expect(fixture.componentInstance.value()).toBe('');
  });
});
