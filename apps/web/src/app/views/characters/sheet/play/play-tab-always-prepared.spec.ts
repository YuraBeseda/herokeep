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
import { ToastService } from '@shared/components/toast/toast.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { SyncService, type SyncStateValue } from '@shared/services/sync/sync.service';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { CreateWizardState } from '../../create-wizard/create-wizard.state';
import { PlayTabComponent } from './play-tab.component';

// Plan 13 task 8 (the plan-12 task 9 "F4" item): a granted / always-prepared spell in the play tab's
// Prepared list shows a DISABLED unprepare control with its reason — never no control, never a
// working one. Kept out of the (3700+ line) `play-tab.component.spec.ts`; same real-pack, real
// create-path setup as that file's "always-prepared spells with the real pack (plan 12 task 9)".

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const result = parsePack(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!result.ok) {
    throw new Error(`fixture pack at ${path} failed validation`);
  }
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(langPath === 'characters/en' ? charactersEn : {});
  }
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
      provideTranslocoMessageformat(),
      {
        provide: PackStore,
        useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
      },
      {
        provide: StoragePersistService,
        useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
      },
      // Solo character: the real SyncService eagerly injects Router (see play-tab.component.spec.ts).
      { provide: SyncService, useValue: { syncState: () => signal<SyncStateValue>('offline') } },
    ],
  });
}

const PALADIN = 'srd-5e-2024:class/paladin';
const spellId = (slug: string) => `srd-5e-2024:spell/${slug}`;
const learned = (slug: string) => ({
  type: 'spell.learned',
  v: 1,
  payload: { spellId: spellId(slug), classId: PALADIN, source: 'levelUp' },
});
const prepared = (slug: string) => ({
  type: 'spell.prepared',
  v: 1,
  payload: { spellId: spellId(slug), classId: PALADIN },
});

/** Persists a Paladin 3 / Oath of Devotion through the real create path (no sheet shaping): the
 * oath's `spell.grant { alwaysPrepared }` effects put Divine Smite, Protection from Evil and Good
 * and Shield of Faith in the block's `alwaysPrepared`; Bless is a chosen, prepared spell. */
async function seedDevotionPaladin(): Promise<CharacterStore> {
  const state = TestBed.runInInjectionContext(() => new CreateWizardState());
  state.name.set('Aldis');
  state.gender.set('masculine');
  state.setDecision('srd-5e-2024:system/5e-2024@0/species', ['srd-5e-2024:species/human']);
  state.setDecision('srd-5e-2024:system/5e-2024@0/background', ['srd-5e-2024:background/soldier']);
  state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
  state.setDecision(
    'srd-5e-2024:system/5e-2024@0/ability-scores',
    ['str:15', 'dex:8', 'con:13', 'int:10', 'wis:12', 'cha:14'],
    { method: 'standardArray' },
  );
  state.setDecision('srd-5e-2024:system/5e-2024@0/class', [PALADIN]);
  const store = TestBed.inject(CharacterStore);
  await store.create(state.name().trim(), state.gender());
  const [, ...rest] = state.buildTransaction();
  await store.appendTx(rest);
  await store.appendTx([
    { type: 'level.gained', v: 1, payload: { classId: PALADIN, level: 2, hpRoll: 'average' } },
    {
      type: 'level.gained',
      v: 1,
      payload: {
        classId: PALADIN,
        level: 3,
        hpRoll: 'average',
        subclassId: 'srd-5e-2024:subclass/oath-of-devotion',
      },
    },
    learned('bless'),
    prepared('bless'),
  ]);
  return store;
}

describe('PlayTabComponent — always-prepared unprepare control (plan 13 task 8)', () => {
  beforeEach(async () => {
    localStorage.removeItem('hk.locale');
    configure();
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
    ]);
  });

  afterEach(() => {
    localStorage.removeItem('hk.locale');
    TestBed.inject(HkDb).close();
  });

  // The Prepared list is the second `.play-tab__spell-lists` column (the Known list is the first).
  const preparedRow = (c: HTMLElement, name: string): HTMLElement | undefined =>
    Array.from(
      c.querySelectorAll<HTMLElement>('.play-tab__spell-lists > div:nth-child(2) li'),
    ).find((r) => r.querySelector('.play-tab__spell-name')?.textContent?.trim() === name);
  const unprepareIn = (row: HTMLElement): HTMLButtonElement | undefined =>
    Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.unprepare,
    );

  it('Paladin 3 / Devotion: each granted spell in the Prepared list has a DISABLED unprepare control carrying the always-prepared reason', async () => {
    const store = await seedDevotionPaladin();
    const block = store.sheet()!.spellcasting.find((b) => b.classId === PALADIN)!;
    expect([...(block.alwaysPrepared ?? [])].sort()).toEqual(
      ['divine-smite', 'protection-from-evil-and-good', 'shield-of-faith'].map(spellId).sort(),
    );

    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const reason = charactersEn.sheet.spellcasting.alwaysPreparedReason;

    for (const name of ['Divine Smite', 'Protection from Evil and Good', 'Shield of Faith']) {
      const row = preparedRow(compiled, name);
      expect(row, name).toBeDefined();
      expect(row!.textContent, name).toContain(charactersEn.sheet.spellcasting.alwaysPrepared);
      const control = unprepareIn(row!);
      expect(control, name).toBeDefined();
      expect(control!.disabled, name).toBe(true);
      expect(control!.getAttribute('title'), name).toBe(reason);
      const describedBy = control!.getAttribute('aria-describedby');
      expect(describedBy, name).toBeTruthy();
      expect(compiled.querySelector(`[id="${describedBy}"]`)?.textContent?.trim(), name).toBe(
        reason,
      );
    }

    // A chosen spell's Prepared-list row is unchanged: no marker, no unprepare control there (its
    // working unprepare toggle lives in the Known list).
    const bless = preparedRow(compiled, 'Bless')!;
    expect(bless.textContent).not.toContain(charactersEn.sheet.spellcasting.alwaysPrepared);
    expect(unprepareIn(bless)).toBeUndefined();

    // Reason ids never collide with the Known list's own always-prepared reason ids.
    const ids = Array.from(compiled.querySelectorAll('[id]')).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('clicking the disabled control does nothing, and a forced unprepare is still refused by the engine', async () => {
    const store = await seedDevotionPaladin();
    const fixture = TestBed.createComponent(PlayTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const showSpy = vi.spyOn(TestBed.inject(ToastService), 'show');
    const before = store.events().length;

    unprepareIn(preparedRow(compiled, 'Shield of Faith')!)!.click();
    await fixture.whenStable();
    expect(store.events().length).toBe(before);
    expect(showSpy).not.toHaveBeenCalled();

    // Backstop: the engine's `propose.unprepare` refusal is untouched.
    const live = store.sheet()!.spellcasting.find((b) => b.classId === PALADIN)!;
    (
      fixture.componentInstance as unknown as {
        onTogglePrepared(b: typeof live, id: string): void;
      }
    ).onTogglePrepared(live, spellId('shield-of-faith'));
    await fixture.whenStable();
    expect(store.events().length).toBe(before);
    expect(showSpy).toHaveBeenCalledWith('characters.validation.spell.always-prepared');
  });
});
