import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, TranslocoService, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import charactersRu from '../../../../../assets/i18n/characters/ru.json';
import charactersUk from '../../../../../assets/i18n/characters/uk.json';
import { hintOf } from '@app/ui/testing/harness';
import { levelUpToTwo, seedFighter } from '../testing/character-fixtures';
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
    if (langPath === 'characters/ru') return of(charactersRu);
    if (langPath === 'characters/uk') return of(charactersUk);
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

  // Whole-branch review finding 1: the standalone `character.created` row must never offer a
  // revert affordance — reverting it clears `facts.created`, and every other handler's
  // `requireCreated` guard then skips ALL subsequent events on replay ('not-created'), collapsing
  // facts with no UI path back (revert-of-revert is prohibited). A normal decision row is the
  // control: it still offers revert.
  it('the character.created row renders without a revert affordance, while a decision row still offers one', async () => {
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create('Aria', 'feminine');
    await characterStore.appendTx([
      {
        type: 'decision.made',
        v: 1,
        payload: { choiceId: FIGHTING_STYLE_CHOICE, selection: [DEFENSE_FEAT] },
      },
    ]);

    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();

    // Newest-first: the decision row, then the standalone character.created row.
    const rows = rowEls(fixture);
    const decisionRow = rows[0];
    const createdRow = rows[1];
    expect(decisionRow.querySelector('.timeline-tab__revert')).not.toBeNull();
    expect(createdRow.querySelector('.timeline-tab__revert')).toBeNull();
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

  // doc-02 L111: "override.applied ... rendered distinctly" (plan-10 task-11-brief.md's
  // verification instruction) — a badge + a row-level accent class, IN ADDITION to the ordinary
  // sentence (which already interpolates {path}/{reason} via its own ICU template).
  it('override.applied renders a distinct badge (doc-02 L111), unlike an ordinary event row', async () => {
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create('Aria', 'feminine');
    await characterStore.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Interim' } },
    ]);
    await characterStore.appendTx([
      {
        type: 'override.applied',
        v: 1,
        payload: { path: 'ac', value: 18, reason: 'story reward' },
      },
    ]);

    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();

    const rows = rowEls(fixture);
    const overrideRow = rows[0]; // newest-first
    const renamedRow = rows[1];
    expect(sentenceOf(overrideRow)).toContain('ac');
    expect(sentenceOf(overrideRow)).toContain('story reward');
    expect(overrideRow.querySelector('.timeline-tab__badge--override')).not.toBeNull();
    expect(overrideRow.classList.contains('timeline-tab__row--override')).toBe(true);
    // An ordinary (non-override) row gets NEITHER the badge nor the row-level class.
    expect(renamedRow.querySelector('.timeline-tab__badge--override')).toBeNull();
    expect(renamedRow.classList.contains('timeline-tab__row--override')).toBe(false);
  });
});

// --- B10b (plan 17, boards T01 + DL05) -------------------------------------------------------------

function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function chipByLabel(root: HTMLElement, label: string): HTMLButtonElement {
  const chip = Array.from(root.querySelectorAll<HTMLButtonElement>('.hk-filter-chips__chip')).find(
    (b) => textOf(b).startsWith(label),
  );
  if (!chip) throw new Error(`no filter chip "${label}"`);
  return chip;
}

describe('TimelineTabComponent — board T01', () => {
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
    vi.useRealTimers();
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    TestBed.inject(HkDb).close();
  });

  it('filter chips narrow the timeline to the picked families, and clearing shows everything again', async () => {
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create('Aria', 'feminine');
    await characterStore.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Aria II' } },
    ]);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 50 } }]);

    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(rowEls(fixture).length).toBe(3);

    chipByLabel(root, 'Leveling').click();
    await fixture.whenStable();
    expect(rowEls(fixture).map((r) => r.getAttribute('data-family'))).toEqual(['leveling']);

    // A second chip widens the picked set.
    chipByLabel(root, 'Identity').click();
    await fixture.whenStable();
    expect(rowEls(fixture).length).toBe(3);

    // Un-picking both shows everything again (no chip on = no filter).
    chipByLabel(root, 'Leveling').click();
    chipByLabel(root, 'Identity').click();
    await fixture.whenStable();
    expect(rowEls(fixture).length).toBe(3);
  });

  it('groups rows under a header per day, newest day first, each row with its time and a kind icon', async () => {
    const characterStore = TestBed.inject(CharacterStore);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T09:30:00Z'));
    await characterStore.create('Aria', 'feminine');
    vi.setSystemTime(new Date('2026-11-02T20:15:00Z'));
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 50 } }]);
    await characterStore.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Aria II' } },
    ]);
    vi.useRealTimers();

    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    const days = Array.from(root.querySelectorAll<HTMLElement>('.timeline-tab__group'));
    expect(days.length).toBe(2);
    expect(days[0]?.querySelectorAll('.timeline-tab__row').length).toBe(2);
    expect(days[1]?.querySelectorAll('.timeline-tab__row').length).toBe(1);
    const headers = days.map((d) => textOf(d.querySelector('.timeline-tab__day')));
    expect(headers[0]).toContain('2026');
    expect(headers[0]).not.toBe(headers[1]);

    const first = rowEls(fixture)[0];
    expect(first.querySelector('time.timeline-tab__time')?.getAttribute('datetime')).toMatch(
      /^2026-11-02T/,
    );
    const kind = first.querySelector<HTMLElement>('.timeline-tab__kind')!;
    expect(kind.getAttribute('role')).toBe('img');
    // The icon names its family (a hint and an accessible name), not just a glyph.
    expect(kind.getAttribute('aria-label')).toBe(charactersEn.timeline.family.identity);
  });

  it('a tx-group has a labelled expander with the event count, and expanding lists its members', async () => {
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create('Aria', 'feminine');
    await characterStore.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'One' } },
      { type: 'character.renamed', v: 1, payload: { name: 'Two' } },
      { type: 'character.renamed', v: 1, payload: { name: 'Three' } },
    ]);
    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();
    const group = rowEls(fixture)[0];

    const expand = group.querySelector<HTMLButtonElement>('.timeline-tab__expand')!;
    expect(expand.getAttribute('aria-label')).toBe('Show 3 events');
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(textOf(group.querySelector('.timeline-tab__count'))).toBe('3 events');
    expect(group.querySelectorAll('.timeline-tab__member').length).toBe(0);

    expand.click();
    await fixture.whenStable();
    expect(expand.getAttribute('aria-label')).toBe('Hide 3 events');
    expect(expand.getAttribute('aria-expanded')).toBe('true');
    expect(group.querySelectorAll('.timeline-tab__member').length).toBe(3);
  });

  it('the creation row is locked with a hint instead of a Revert button', async () => {
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create('Aria', 'feminine');
    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();
    const created = rowEls(fixture)[0];

    expect(created.querySelector('.timeline-tab__revert')).toBeNull();
    const lock = created.querySelector<HTMLElement>('.timeline-tab__locked')!;
    expect(lock).not.toBeNull();
    expect(hintOf(lock)).toBe(charactersEn.timeline.lockedCreationHint);
  });

  it('"Show reverted" off hides reverted rows and keeps the rest', async () => {
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create('Aria', 'feminine');
    await characterStore.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Interim' } },
    ]);
    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();
    await revertRow(fixture, rowEls(fixture)[0], () => characterStore.facts()?.name === 'Aria');
    const root = fixture.nativeElement as HTMLElement;

    const reverted = () =>
      rowEls(fixture).filter((r) => r.classList.contains('timeline-tab__row--reverted'));
    expect(reverted().length).toBe(1);

    root.querySelector<HTMLButtonElement>('.timeline-tab__show-reverted button')!.click();
    await fixture.whenStable();
    expect(reverted().length).toBe(0);
    expect(rowEls(fixture).length).toBe(2);
  });
});

describe('TimelineTabComponent — the revert dialog (board DL05)', () => {
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

  async function seedRename() {
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create('Aria', 'feminine');
    await characterStore.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'Interim' } },
    ]);
    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();
    return { characterStore, fixture };
  }

  it('Revert opens the confirm naming the change; Keep it appends nothing, Revert appends the existing event.reverted', async () => {
    const { characterStore, fixture } = await seedRename();
    const row = rowEls(fixture)[0];
    const before = characterStore.events().length;

    row.querySelector<HTMLButtonElement>('.timeline-tab__revert')!.click();
    TestBed.tick();
    const overlay = document.querySelector('.cdk-overlay-container')!;
    expect(textOf(overlay.querySelector('.timeline-revert-confirm__title'))).toBe(
      charactersEn.timeline.revertConfirm.title,
    );
    // The body names the sentence being reverted.
    expect(textOf(overlay.querySelector('.timeline-revert-confirm__body'))).toContain('Interim');
    expect(characterStore.events().length).toBe(before);

    // Keep it: nothing is dispatched.
    overlay.querySelector<HTMLButtonElement>('.timeline-revert-confirm__cancel')!.click();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(characterStore.events().length).toBe(before);
    expect(characterStore.facts()?.name).toBe('Interim');

    // Revert: confirm dispatches.
    await revertRow(fixture, rowEls(fixture)[0], () => characterStore.facts()?.name === 'Aria');
    expect(characterStore.events().at(-1)?.type).toBe('event.reverted');
  });

  it.each(['en', 'ru', 'uk'] as const)(
    'the %s row action is exactly its translation and differs from the dialog Cancel',
    async (lang) => {
      const bundle = { en: charactersEn, ru: charactersRu, uk: charactersUk }[lang];
      const label = { en: 'Revert', ru: 'Отменить изменение', uk: 'Відкотити' }[lang];
      expect(bundle.timeline.revert).toBe(label);
      expect(bundle.timeline.revertConfirm.confirm).toBe(label);
      expect(bundle.timeline.revert).not.toBe(bundle.timeline.revertConfirm.cancel);

      const { fixture } = await seedRename();
      const transloco = TestBed.inject(TranslocoService);
      transloco.setActiveLang(lang);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();

      const row = rowEls(fixture)[0];
      const button = row.querySelector<HTMLButtonElement>('.timeline-tab__revert')!;
      expect(textOf(button)).toBe(label);
      button.click();
      TestBed.tick();
      const overlay = document.querySelector('.cdk-overlay-container')!;
      const keep = textOf(overlay.querySelector('.timeline-revert-confirm__cancel'));
      const confirm = textOf(overlay.querySelector('.timeline-revert-confirm__confirm'));
      expect(confirm).toBe(label);
      expect(keep).toBe(bundle.timeline.revertConfirm.cancel);
      expect(keep).not.toBe(confirm);
    },
  );
});

// --- B10b fix round 1: search and the revert preview ---------------------------------------------

describe('TimelineTabComponent — search (board T01)', () => {
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

  async function typeSearch(
    fixture: { whenStable(): Promise<unknown> },
    root: HTMLElement,
    value: string,
  ): Promise<void> {
    const input = root.querySelector<HTMLInputElement>('.timeline-tab__search input')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    // `hk-search-field` commits 150 ms after the last keystroke.
    await new Promise((resolve) => setTimeout(resolve, 220));
    await fixture.whenStable();
  }

  it('narrows the rows to the sentences that contain the text, and combines with the family chips', async () => {
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create('Aria', 'feminine');
    await characterStore.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Bram' } }]);
    await characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount: 50 } }]);
    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(rowEls(fixture).length).toBe(3);

    await typeSearch(fixture, root, 'bram');
    expect(rowEls(fixture).length).toBe(1);
    expect(sentenceOf(rowEls(fixture)[0])).toContain('Bram');

    // A chip that excludes that row empties the list; clearing the chip brings it back.
    chipByLabel(root, 'Leveling').click();
    await fixture.whenStable();
    expect(rowEls(fixture).length).toBe(0);
    expect(root.querySelector('.timeline-tab__empty')).not.toBeNull();
    chipByLabel(root, 'Leveling').click();
    await fixture.whenStable();
    expect(rowEls(fixture).length).toBe(1);

    await typeSearch(fixture, root, '');
    expect(rowEls(fixture).length).toBe(3);
  });

  it('finds text inside a collapsed group', async () => {
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create('Aria', 'feminine');
    await characterStore.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: 'One' } },
      { type: 'character.renamed', v: 1, payload: { name: 'Zed' } },
    ]);
    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();
    await typeSearch(fixture, fixture.nativeElement as HTMLElement, 'zed');
    expect(rowEls(fixture).length).toBe(1);
  });
});

describe('TimelineTabComponent — the revert preview (board DL05)', () => {
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

  it('reverting a level up shows the max hit points drop before confirming', async () => {
    await seedFighter('Ivan');
    await levelUpToTwo();
    const characterStore = TestBed.inject(CharacterStore);
    const before = characterStore.sheet()!.hp.max.value;
    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();

    const levelRow = rowEls(fixture).find(
      (r) => /level/i.test(sentenceOf(r)) && r.getAttribute('data-family') === 'leveling',
    )!;
    levelRow.querySelector<HTMLButtonElement>('.timeline-tab__revert')!.click();
    TestBed.tick();
    const overlay = document.querySelector('.cdk-overlay-container')!;
    const change = overlay.querySelector('.timeline-revert-confirm__change[data-key="hpMax"]');
    expect(change).not.toBeNull();
    expect(textOf(change)).toContain(String(before));
    expect(textOf(change)).toContain('12');
    expect(before).toBeGreaterThan(12);
    expect(overlay.querySelector('.timeline-revert-confirm__none')).toBeNull();
    // The preview changes nothing until Revert is confirmed.
    expect(characterStore.sheet()!.hp.max.value).toBe(before);
  });

  it('reverting a cosmetic change shows that nothing changes on the sheet', async () => {
    const characterStore = TestBed.inject(CharacterStore);
    await characterStore.create('Aria', 'feminine');
    await characterStore.appendTx([{ type: 'character.renamed', v: 1, payload: { name: 'Bram' } }]);
    const fixture = TestBed.createComponent(TimelineTabComponent);
    await fixture.whenStable();

    rowEls(fixture)[0].querySelector<HTMLButtonElement>('.timeline-tab__revert')!.click();
    TestBed.tick();
    const overlay = document.querySelector('.cdk-overlay-container')!;
    expect(overlay.querySelectorAll('.timeline-revert-confirm__change').length).toBe(0);
    expect(textOf(overlay.querySelector('.timeline-revert-confirm__none'))).toBe(
      charactersEn.timeline.revertConfirm.preview.none,
    );
  });
});
