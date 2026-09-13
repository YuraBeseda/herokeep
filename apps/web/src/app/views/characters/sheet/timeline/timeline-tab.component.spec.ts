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
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { seedFighter } from '../testing/character-fixtures';
import { TimelineTabComponent } from './timeline-tab.component';

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling), same fixture-loading
// approach as `build-tab.component.spec.ts`/`play-tab.component.spec.ts`.
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

const FIGHTING_STYLE_CHOICE = 'srd-5e-2024:class/fighter@1/fighting-style';
const FIGHTER_CLASS = 'srd-5e-2024:class/fighter';
const DEFENSE_FEAT = 'srd-5e-2024:feat/defense';

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

/** Polls real macrotask turns until `predicate()` is true, flushing a render after each — same
 * reasoning/shape as `build-tab.component.spec.ts`'s own `pollUntil`: the revert flow below goes
 * through a DOM click → `DialogService`'s promise → `CharacterStore.revert()`'s own fake-indexeddb
 * round-trip, none of which Angular's zoneless stability tracks. */
async function pollUntil(
  fixture: { whenStable(): Promise<unknown> },
  predicate: () => boolean,
  maxIterations = 50,
): Promise<void> {
  for (let i = 0; i < maxIterations && !predicate(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  }
  expect(predicate()).toBe(true);
}

function rowEls(fixture: { nativeElement: unknown }): HTMLElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.timeline-tab__row'),
  );
}

function sentenceOf(row: HTMLElement): string {
  return row.querySelector('.timeline-tab__sentence')?.textContent?.trim() ?? '';
}

/** Drives the "click revert → confirm dialog → confirm" flow (`hk-dialog`'s pattern,
 * `characters-list.component.spec.ts`'s own delete-confirm test): the dialog attaches to
 * `document.body` via CDK Overlay, outside the fixture's own root, so it's queried off `document`
 * directly. */
async function revertRow(
  fixture: { nativeElement: unknown; whenStable(): Promise<unknown> },
  row: HTMLElement,
  predicate: () => boolean,
): Promise<void> {
  row.querySelector<HTMLButtonElement>('.timeline-tab__revert')!.click();
  TestBed.tick();
  const confirmButton = document.querySelector<HTMLButtonElement>(
    '.timeline-revert-confirm__confirm',
  );
  expect(confirmButton).toBeTruthy();
  confirmButton!.click();
  await pollUntil(fixture, predicate);
}

describe('TimelineTabComponent', () => {
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

  it('renders localized sentences for character.created, a decision, and a level.gained event', async () => {
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create('Aria', 'feminine');
    await characterStore.appendTx([
      {
        type: 'decision.made',
        v: 1,
        payload: { choiceId: FIGHTING_STYLE_CHOICE, selection: [DEFENSE_FEAT] },
      },
    ]);
    await characterStore.appendTx([
      { type: 'level.gained', v: 1, payload: { classId: FIGHTER_CLASS, level: 2 } },
    ]);

    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();

    const sentences = rowEls(fixture).map(sentenceOf).join(' | ');
    expect(sentences).toContain('Aria');
    expect(sentences).toContain('Defense');
    expect(sentences).toContain('Fighter');
    expect(sentences).toContain('2');
  });

  it('a decision.made with context.rolls renders 6 dice groups', async () => {
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create('Aria', 'feminine');
    const rolls = Array.from({ length: 6 }, (_, i) => ({
      total: 10 + i,
      dice: [
        { sides: 6, value: 4, kept: true },
        { sides: 6, value: 6, kept: true },
        { sides: 6, value: 2, kept: false },
      ],
    }));
    await characterStore.appendTx([
      {
        type: 'decision.made',
        v: 1,
        payload: {
          choiceId: 'srd-5e-2024:system/5e-2024@0/ability-scores',
          selection: ['str:16'],
          context: { method: 'roll', scores: { str: 16 }, rolls },
        },
      },
    ]);

    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();

    const rollRow = rowEls(fixture)[0]; // newest-first: the decision.made row
    expect(rollRow.querySelectorAll('.timeline-tab__roll-group').length).toBe(6);
  });

  it('reverting a decision strikes it through, hides its revert button, and the sheet loses the effect', async () => {
    await seedFighter('Ivan', { fightingStyle: false });
    const characterStore = TestBed.inject(CharacterStore);
    const acBefore = characterStore.sheet()!.ac.value;

    await characterStore.appendTx([
      {
        type: 'decision.made',
        v: 1,
        payload: { choiceId: FIGHTING_STYLE_CHOICE, selection: [DEFENSE_FEAT] },
      },
    ]);
    expect(characterStore.sheet()!.ac.value).toBe(acBefore + 1); // Defense: +1 AC

    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();

    const decisionRow = rowEls(fixture)[0]; // newest-first: the fighting-style decision
    expect(decisionRow.querySelector('.timeline-tab__revert')).not.toBeNull();

    await revertRow(fixture, decisionRow, () => characterStore.sheet()!.ac.value === acBefore);

    expect(characterStore.sheet()!.ac.value).toBe(acBefore);
    const rowsAfter = rowEls(fixture);
    // Newest is now the `event.reverted` row itself; the reverted decision shifted to index 1.
    const revertedDecisionRow = rowsAfter[1];
    expect(revertedDecisionRow.classList.contains('timeline-tab__row--reverted')).toBe(true);
    expect(revertedDecisionRow.querySelector('.timeline-tab__badge')).not.toBeNull();
    expect(revertedDecisionRow.querySelector('.timeline-tab__revert')).toBeNull();
  });

  it('a 3-event tx renders as one group card, and reverting it reverts all three', async () => {
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create('Aria', 'feminine');
    await characterStore.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'One' } },
      { type: 'character.renamed', v: 1, payload: { name: 'Two' } },
      { type: 'character.renamed', v: 1, payload: { name: 'Three' } },
    ]);
    expect(characterStore.facts()?.name).toBe('Three');

    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();

    // Exactly 2 rows: the 3-event tx group (collapsed to one card) + the character.created row.
    expect(rowEls(fixture).length).toBe(2);
    const groupRow = rowEls(fixture)[0];
    expect(groupRow.querySelector('.timeline-tab__expand')).not.toBeNull();
    // The group's sentence is keyed by its LEADING event ('One', the first of the 3 renames),
    // plus a "+2 more events" suffix — not three separate sentences.
    expect(sentenceOf(groupRow)).toContain('One');
    expect(sentenceOf(groupRow)).toMatch(/2/);

    await revertRow(fixture, groupRow, () => characterStore.facts()?.name === 'Aria');

    expect(characterStore.facts()?.name).toBe('Aria');
  });

  it('an event.reverted row renders its own sentence but offers no revert affordance', async () => {
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create('Aria', 'feminine');
    await characterStore.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Interim' } },
    ]);
    const targetId = characterStore.events().at(-1)!.id;

    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();
    const renameRow = rowEls(fixture)[0];
    await revertRow(fixture, renameRow, () => characterStore.facts()?.name === 'Aria');

    const revertEventRow = rowEls(fixture)[0]; // newest: the event.reverted row itself
    expect(characterStore.events().at(-1)?.type).toBe('event.reverted');
    expect(characterStore.skippedIds().has(targetId)).toBe(true);
    expect(revertEventRow.querySelector('.timeline-tab__revert')).toBeNull();
  });
});
