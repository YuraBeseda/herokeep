import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { seedFighter, seedWizard } from '../testing/character-fixtures';
import { PlayTabComponent } from './play-tab.component';

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling), same fixture-loading
// approach as `character.store.spec.ts`/`create-wizard.component.spec.ts`.
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

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    return of({});
  }
}

function configureReal(): void {
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
      provideTranslocoMessageformat(),
      {
        provide: PackStore,
        useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
      },
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
    ],
  });
}

function statValues(compiled: HTMLElement, containerSelector: string): string[] {
  return Array.from(
    compiled.querySelectorAll(`${containerSelector} hk-stat-tile .hk-stat-tile__value`),
  ).map((el) => el.textContent?.trim() ?? '');
}

describe('PlayTabComponent', () => {
  beforeEach(async () => {
    configureReal();
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
    ]);
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    TestBed.inject(HkDb).close();
  });

  it("renders fighter-1's hp max / AC / proficiency bonus straight off the store's sheet (12 / 19 / +2)", async () => {
    await seedFighter('Ivan');

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const coreStats = statValues(compiled, '.play-tab__stats');
    expect(coreStats[0]).toBe('19'); // AC
    expect(coreStats[2]).toBe('+2'); // proficiency bonus

    const hpStats = statValues(compiled, '.play-tab__hp-stats');
    // Controller ruling R11: `CreateWizardState.buildTransaction()` tops current HP up to the
    // derived max via an explicit `hp.changed {delta, kind: 'set'}` right after `level.gained` —
    // `facts.hp.current` itself still defaults to the literal `0`, not the `'max'` sentinel
    // (`reduce/facts.ts`'s `initialFacts`), but this fixture (like every real creation) goes
    // through that same wizard path, not a hand-written event list.
    expect(hpStats[0]).toBe('12'); // current
    expect(hpStats[1]).toBe('12'); // max
  });

  it("opens the AC tile's hkDerived popover listing at least 3 contributions (armor, shield, fighting style), localized", async () => {
    await seedFighter('Ivan');

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const acTile = compiled.querySelector<HTMLElement>('.play-tab__stats hk-stat-tile')!;
    acTile.click();
    TestBed.tick();

    const overlay = document.querySelector('.cdk-overlay-container')!;
    const rows = overlay.querySelectorAll('.derived-popover__row');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const text = overlay.textContent ?? '';
    expect(text).toContain('Chain Mail');
    expect(text).toContain('Shield');
    expect(text).toContain('Defense');
  });

  it("renders a wizard stream's level-1 spell slots as dot rows matching spellcasting (2 slots, none used)", async () => {
    await seedWizard('Elowen');

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const slotRow = compiled.querySelector('.play-tab__slot-row')!;
    expect(slotRow).not.toBeNull();
    const dots = slotRow.querySelectorAll('.play-tab__dot');
    expect(dots).toHaveLength(2);
    expect(slotRow.querySelectorAll('.play-tab__dot--filled')).toHaveLength(0);
  });
});
