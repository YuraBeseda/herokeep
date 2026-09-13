import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import charactersEn from '../../../assets/i18n/characters/en.json';
import { EngineFacade } from '../services/engine/engine.facade';
import { DerivedPopoverDirective, type DerivedValue } from './derived-popover.directive';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    return of({});
  }
}

// A minimal stand-in `ContentIndex`/`Localizer` pair — this directive spec exercises its OWN
// open/close/keyboard mechanics and rendering, not real pack localization (that's covered by
// `play-tab.component.spec.ts`'s real-fighter AC-tile assertion instead, per task-10-brief.md).
const NAMES: Record<string, string> = {
  'srd-5e-2024:item/chain-mail': 'Chain Mail',
  'srd-5e-2024:item/shield': 'Shield',
  'srd-5e-2024:feat/defense': 'Defense',
};

function stubEngineFacade(): Partial<EngineFacade> {
  return {
    index: signal({
      has: (id: string) => id in NAMES,
    }) as unknown as EngineFacade['index'],
    localizer: signal({
      name: (id: string) => NAMES[id] ?? id,
    }) as unknown as EngineFacade['localizer'],
  };
}

@Component({
  selector: 'app-derived-host',
  imports: [DerivedPopoverDirective],
  // `{{ label }}` (bound, not a literal text node) sidesteps the template `i18n` lint rule —
  // this is a test-only host fixture, not user-facing copy.
  template: `<div class="host-tile" hkDerived [hkDerivedBreakdown]="derived()">{{ label }}</div>`,
})
class DerivedHostComponent {
  protected readonly label = 'AC 19';

  readonly derived = signal<DerivedValue>({
    value: 19,
    contributions: [
      { source: 'srd-5e-2024:item/chain-mail', kind: 'armor.ac', amount: 16 },
      { source: 'srd-5e-2024:item/shield', kind: 'ac.bonus', amount: 2, key: 'shield' },
      { source: 'srd-5e-2024:feat/defense', kind: 'ac.bonus', amount: 1 },
    ],
  });
}

function configure(): void {
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: {
          availableLangs: ['en', 'ru', 'uk'],
          defaultLang: 'en',
          fallbackLang: 'en',
          reRenderOnLangChange: true,
          prodMode: true,
        },
        loader: StubLoader,
      }),
      { provide: EngineFacade, useValue: stubEngineFacade() },
    ],
  });
}

describe('DerivedPopoverDirective', () => {
  beforeEach(() => configure());

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('marks its host as a keyboard-activatable button', async () => {
    const fixture = TestBed.createComponent(DerivedHostComponent);
    await fixture.whenStable();

    const host = (fixture.nativeElement as HTMLElement).querySelector('.host-tile')!;
    expect(host.getAttribute('role')).toBe('button');
    expect(host.getAttribute('tabindex')).toBe('0');
  });

  it('click opens a popover listing every contribution with its localized source and amount', async () => {
    const fixture = TestBed.createComponent(DerivedHostComponent);
    await fixture.whenStable();

    const host = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.host-tile')!;
    host.click();
    TestBed.tick();

    const overlay = document.querySelector('.cdk-overlay-container')!;
    const rows = Array.from(overlay.querySelectorAll('.derived-popover__row'));
    expect(rows).toHaveLength(3);
    const text = overlay.textContent ?? '';
    expect(text).toContain('Chain Mail');
    expect(text).toContain('Shield');
    expect(text).toContain('Defense');
    expect(text).toContain('+16');
    expect(text).toContain('+2');
    expect(text).toContain('+1');
  });

  it('Enter opens the popover', async () => {
    const fixture = TestBed.createComponent(DerivedHostComponent);
    await fixture.whenStable();
    const host = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.host-tile')!;

    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    TestBed.tick();
    expect(document.querySelector('.cdk-overlay-container hk-dialog')).not.toBeNull();
  });

  it('Space opens the popover and prevents the page from scrolling', async () => {
    const fixture = TestBed.createComponent(DerivedHostComponent);
    await fixture.whenStable();
    const host = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.host-tile')!;

    const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    host.dispatchEvent(spaceEvent);
    TestBed.tick();
    expect(document.querySelector('.cdk-overlay-container hk-dialog')).not.toBeNull();
    expect(spaceEvent.defaultPrevented).toBe(true);
  });

  it('the close button dismisses the popover', async () => {
    const fixture = TestBed.createComponent(DerivedHostComponent);
    await fixture.whenStable();
    const host = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.host-tile')!;
    host.click();
    TestBed.tick();

    const closeButton = document.querySelector<HTMLButtonElement>('.derived-popover__close')!;
    closeButton.click();
    TestBed.tick();

    expect(document.querySelector('hk-dialog')).toBeNull();
  });

  it('renders an empty-state message when there are no contributions', async () => {
    const fixture = TestBed.createComponent(DerivedHostComponent);
    await fixture.whenStable();
    fixture.componentInstance.derived.set({ value: 10, contributions: [] });
    await fixture.whenStable();

    const host = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.host-tile')!;
    host.click();
    TestBed.tick();

    expect(document.querySelector('.derived-popover__empty')).not.toBeNull();
    expect(document.querySelector('.derived-popover__row')).toBeNull();
  });
});
