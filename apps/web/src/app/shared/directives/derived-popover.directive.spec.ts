import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import charactersEn from '../../../assets/i18n/characters/en.json';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { EngineFacade, provideEngineScope } from '../services/engine/engine.facade';
import { CharacterEngineScope } from '../stores/character-engine-scope';
import { CharacterStore } from '../stores/character.store';
import { PackStore } from '../stores/pack.store';
import sampleJson from '../../../testing/fixtures/packs/sample-content.json';
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

  // Plan 14 Task 6 (ruling 9): the engine stamps a formula contribution's evaluated `amount` next
  // to the kept `formula` — the row shows the number, with the formula as secondary (title) text.
  it('shows a formula contribution as its resolved number, with the formula as the title', async () => {
    const formula = '10 + 5 * floor((classLevel(monk) - 2) / 4)';
    const fixture = TestBed.createComponent(DerivedHostComponent);
    await fixture.whenStable();
    fixture.componentInstance.derived.set({
      value: 40,
      contributions: [
        { source: 'srd-5e-2024:feat/defense', kind: 'speed.bonus', formula, amount: 10 },
      ],
    });
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.host-tile')!.click();
    TestBed.tick();

    const amount = document.querySelector<HTMLElement>('.derived-popover__amount')!;
    expect(amount.textContent?.trim()).toBe('+10');
    expect(amount.getAttribute('title')).toBe(formula);
    expect(document.querySelector('.cdk-overlay-container')!.textContent).not.toContain('floor');
  });

  it('a plain amount carries no formula title', async () => {
    const fixture = TestBed.createComponent(DerivedHostComponent);
    await fixture.whenStable();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.host-tile')!.click();
    TestBed.tick();

    const amount = document.querySelector<HTMLElement>('.derived-popover__amount')!;
    expect(amount.textContent?.trim()).toBe('+16');
    expect(amount.hasAttribute('title')).toBe(false);
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

// --- Plan 15 Task 4 fix round 1: the popover opens through `DialogService`, whose dialog content
// must resolve against the OPENER's pack set (the sheet's `EngineScope`), not the core-only root.
const parsedSample = parsePack(sampleJson);
if (!parsedSample.ok) throw new Error('sample-content.json fixture no longer parses');
const sample = parsedSample.pack;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..');
const parsedCore = parsePack(
  JSON.parse(
    readFileSync(
      join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
      'utf8',
    ),
  ) as unknown,
);
if (!parsedCore.ok) throw new Error('core pack failed validation');
const corePack: Pack = parsedCore.pack;

@Component({
  selector: 'app-scoped-derived-host',
  imports: [DerivedPopoverDirective],
  providers: [CharacterEngineScope, provideEngineScope(CharacterEngineScope)],
  template: `<div class="host-tile" hkDerived [hkDerivedBreakdown]="derived">{{ label }}</div>`,
})
class ScopedDerivedHostComponent {
  protected readonly label = 'AC 13';
  readonly derived: DerivedValue = {
    value: 13,
    contributions: [{ source: 'sample-content:feat/lunar-insight', kind: 'ac.bonus', amount: 3 }],
  };
}

describe('DerivedPopoverDirective — opened inside a character scope (plan 15 Task 4)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideTransloco({
          config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true },
          loader: StubLoader,
        }),
        {
          provide: PackStore,
          useValue: { packs: signal([corePack, sample]), ready: signal(true) },
        },
        {
          provide: CharacterStore,
          useValue: {
            facts: signal({
              pins: { [corePack.id]: corePack.version, [sample.id]: sample.version },
            }),
          },
        },
      ],
    });
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it("names a contribution from a pinned pack (the opener's scope), not its raw id", async () => {
    const fixture = TestBed.createComponent(ScopedDerivedHostComponent);
    await fixture.whenStable();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.host-tile')!.click();
    await fixture.whenStable();

    const popover = document.querySelector('.derived-popover__list');
    expect(popover?.textContent).toContain('Lunar Insight');
    expect(popover?.textContent).not.toContain('sample-content:feat/lunar-insight');
    expect(TestBed.inject(EngineFacade).index().has('sample-content:feat/lunar-insight')).toBe(
      false,
    );
  });
});
