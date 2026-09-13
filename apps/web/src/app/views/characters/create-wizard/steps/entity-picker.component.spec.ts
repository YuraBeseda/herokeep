import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { EntityPickerComponent } from './entity-picker.component';

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling) — `pretest`
// (apps/web/package.json) builds it before this file ever runs.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = parsePack(raw);
  if (!result.ok) {
    throw new Error(
      `fixture pack at ${path} failed validation: ${result.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);
const speciesIds = corePack.entities
  .filter((e) => e.type === 'species')
  .map((e) => e.id)
  .sort();

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    return of({});
  }
}

@Component({
  selector: 'app-entity-picker-host',
  imports: [EntityPickerComponent],
  template: `
    <hk-entity-picker
      [ids]="ids()"
      [selectedIds]="selectedIds()"
      [limit]="limit()"
      (toggled)="onToggle($event)"
    />
  `,
})
class HostComponent {
  readonly ids = signal<readonly string[]>([]);
  readonly selectedIds = signal<readonly string[]>([]);
  readonly limit = signal<number | undefined>(undefined);
  readonly toggled: string[] = [];

  onToggle(id: string): void {
    this.toggled.push(id);
  }
}

function configure(): void {
  TestBed.configureTestingModule({
    imports: [HostComponent],
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
      provideTranslocoMessageformat(),
      {
        provide: PackStore,
        useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
      },
    ],
  });
}

describe('EntityPickerComponent', () => {
  beforeEach(() => configure());

  it('renders a card with the localized name for each provided entity id', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.ids.set(speciesIds);
    await fixture.whenStable();

    const names = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.entity-picker__name'),
    ).map((el) => el.textContent?.trim());
    expect(names.length).toBe(speciesIds.length);
    expect(names).toContain('Human');
  });

  it('clicking a card select button emits toggle with that entity id', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.ids.set(speciesIds);
    await fixture.whenStable();

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.entity-picker__select',
    );
    expect(button).toBeTruthy();
    button!.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.toggled.length).toBe(1);
    expect(speciesIds).toContain(fixture.componentInstance.toggled[0]);
  });

  it("marks a selected id's button as pressed", async () => {
    const humanId = speciesIds.find((id) => id.endsWith('/human'))!;
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.ids.set(speciesIds);
    fixture.componentInstance.selectedIds.set([humanId]);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const humanRow = Array.from(compiled.querySelectorAll('.entity-picker__card')).find(
      (card) => card.querySelector('.entity-picker__name')?.textContent?.trim() === 'Human',
    );
    const button = humanRow?.querySelector('.entity-picker__select');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
  });

  it('filters cards by the search field text', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.ids.set(speciesIds);
    await fixture.whenStable();

    vi.useFakeTimers();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      'input[type="search"]',
    );
    expect(input).toBeTruthy();
    input!.value = 'huma';
    input!.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(150);
    TestBed.tick();
    vi.useRealTimers();
    await fixture.whenStable();

    const names = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.entity-picker__name'),
    ).map((el) => el.textContent?.trim());
    expect(names).toEqual(['Human']);
  });

  // Controller ruling (task-6 fix round): `limit` caps how many (search-filtered) cards render,
  // with a hint naming the remainder — task 8's 339-spell picker will pass this. 100 real spell
  // ids stand in for a "synthetic" large option set here (their exact names don't matter, only
  // that there are ≥100 with distinct names).
  it('caps rendered cards at `limit` and shows a hint with the remaining count; narrowing the search below the limit removes it', async () => {
    const spellEntities = corePack.entities
      .filter((e) => e.type === 'spell')
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    const first100 = spellEntities.slice(0, 100);
    expect(first100.length).toBe(100);

    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.ids.set(first100.map((e) => e.id));
    fixture.componentInstance.limit.set(20);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.entity-picker__card').length).toBe(20);
    expect(compiled.querySelector('.entity-picker__more')?.textContent).toContain('80');

    // The longest name among the 100 is the search term least likely to also be a substring of
    // another entry's name — computed from the real data rather than a hardcoded guess, so this
    // holds regardless of exact SRD pack content.
    const longest = [...first100].sort((a, b) => b.name.length - a.name.length)[0];
    const matchCount = first100.filter((e) =>
      e.name.toLowerCase().includes(longest.name.toLowerCase()),
    ).length;
    expect(matchCount).toBeLessThan(20);

    vi.useFakeTimers();
    const input = compiled.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = longest.name;
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(150);
    TestBed.tick();
    vi.useRealTimers();
    await fixture.whenStable();

    expect(compiled.querySelectorAll('.entity-picker__card').length).toBe(matchCount);
    expect(compiled.querySelector('.entity-picker__more')).toBeNull();
  });
});
