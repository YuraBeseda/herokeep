import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { levelUpToTwo, seedFighter } from '../testing/character-fixtures';
import { RestDialogComponent, type RestDialogData } from './rest-dialog.component';

// Real built SRD pack (same "prefer the real pack" convention every play-tab spec uses) — needed
// here (unlike `condition-dialog.component.spec.ts`/`note-dialog.component.spec.ts`) because this
// dialog reads/writes a REAL `Sheet` (`data.sheet.hp.hitDice`/`abilities['con']`) and itself calls
// `propose.spendHitDie` against it — task-6-brief.md's "seed real streams via existing helpers".
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

const FIGHTER = 'srd-5e-2024:class/fighter';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return langPath === 'characters/en' ? of(charactersEn) : of({});
  }
}

function configureReal(): void {
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
      provideTranslocoScope('characters'),
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

function open(data: RestDialogData) {
  const service = TestBed.inject(DialogService);
  return service.open(RestDialogComponent, { data });
}

function buttonNamed(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!button) throw new Error(`no button matching "${text}"`);
  return button;
}

function rollButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('.rest-dialog__roll');
  if (!button) throw new Error('no .rest-dialog__roll button');
  return button;
}

function remainingText(): string {
  return document.querySelector('.rest-dialog__remaining')?.textContent?.trim() ?? '';
}

function rolledEntries(): string[] {
  return Array.from(document.querySelectorAll('.rest-dialog__die--kept')).map(
    (el) => el.textContent?.trim() ?? '',
  );
}

/** Scripts `crypto.getRandomValues` — the entropy `cryptoRng` (`shared/services/engine/rng.ts`)
 * always draws from — so each successive `roll()` call inside the component under test lands on
 * an EXACT face: `(value - 0.5) / sides` sits at the midpoint of the fractional range that floors
 * to `value` (`Math.floor(rng() * sides) + 1 === value`), safely clear of either face boundary.
 * Consumed in call order. Narrowed to the EXACT `Uint32Array` length-1 shape `cryptoRng` passes —
 * every other shape (notably `uuidv7`'s own `Uint8Array(10)` draw, `shared/helpers/uuid.ts`) falls
 * through to the REAL `crypto.getRandomValues`. An unconditional mock was tried first and broke
 * `uuidv7()`'s own entropy too (it zeroed everything past index 0 of whatever array it was given),
 * producing duplicate event ids — a real `BulkError`/`ConstraintError` from
 * `EventsRepository.append`'s `&id` primary key — the moment more than one id is minted in the
 * same millisecond, which confirming a multi-roll short rest always does. */
function scriptRolls(targets: { value: number; sides: number }[]): void {
  let i = 0;
  const real = crypto.getRandomValues.bind(crypto) as (array: unknown) => unknown;
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(((array: unknown) => {
    if (array instanceof Uint32Array && array.length === 1) {
      const t = targets[i++];
      const frac = t ? (t.value - 0.5) / t.sides : 0;
      array[0] = Math.floor(frac * 2 ** 32);
      return array;
    }
    return real(array);
  }) as typeof crypto.getRandomValues);
}

describe('RestDialogComponent', () => {
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
    vi.restoreAllMocks();
  });

  it('short-rest cancel closes with undefined', async () => {
    await seedFighter('Ivan');
    const sheet = TestBed.inject(CharacterStore).sheet()!;

    const handle = open({ kind: 'short', sheet, hitDiceOptions: [] });
    TestBed.tick();

    buttonNamed(charactersEn.sheet.rest.dialog.cancel).click();
    TestBed.tick();

    expect(await handle.closed).toBeUndefined();
  });

  // task-12 fix round (axe `aria-dialog-name`, serious — see `dialog.service.spec.ts`'s own new
  // suite for the shell's generic behavior): a REAL consumer, opened through the REAL
  // `DialogService`, ends up with an accessible name — not just the shell's synthetic test fixture.
  it('opening through the real DialogService gives the dialog panel an accessible name (its own title)', async () => {
    await seedFighter('Ivan');
    const sheet = TestBed.inject(CharacterStore).sheet()!;

    const handle = open({ kind: 'short', sheet, hitDiceOptions: [] });
    TestBed.tick();
    // The `[data-dialog-title]` `<h2>` sits behind this content's OWN `*transloco` structural
    // directive, which doesn't necessarily stamp within the SAME synchronous tick as the portal's
    // own `(attached)` event — `DialogComponent`'s `MutationObserver` fallback catches it once it
    // does, but that fallback's callback is itself a microtask, and applying the resulting signal
    // write back to the host's `aria-labelledby` attribute needs one more render pass.
    await Promise.resolve();
    TestBed.tick();

    const panel = document.querySelector('[role="dialog"]')!;
    const labelledBy = panel.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent?.trim()).toBe(
      charactersEn.sheet.rest.dialog.shortTitle,
    );

    handle.close();
  });

  it('long-rest shows the confirm body and confirm closes with {kind: "long"}', async () => {
    await seedFighter('Ivan');
    const sheet = TestBed.inject(CharacterStore).sheet()!;

    const handle = open({ kind: 'long', sheet, hitDiceOptions: [] });
    TestBed.tick();

    expect(document.body.textContent).toContain(charactersEn.sheet.rest.dialog.longBody);
    expect(document.querySelector('.rest-dialog__hit-dice')).toBeNull();

    buttonNamed(charactersEn.sheet.rest.dialog.confirmLong).click();
    TestBed.tick();

    expect(await handle.closed).toEqual({ kind: 'long' });
  });

  it('long-rest cancel closes with undefined', async () => {
    await seedFighter('Ivan');
    const sheet = TestBed.inject(CharacterStore).sheet()!;

    const handle = open({ kind: 'long', sheet, hitDiceOptions: [] });
    TestBed.tick();

    buttonNamed(charactersEn.sheet.rest.dialog.cancel).click();
    TestBed.tick();

    expect(await handle.closed).toBeUndefined();
  });

  it('short-rest with no hit-dice options shows the empty message and confirm closes with an empty drafts array', async () => {
    await seedFighter('Ivan');
    const sheet = TestBed.inject(CharacterStore).sheet()!;

    const handle = open({ kind: 'short', sheet, hitDiceOptions: [] });
    TestBed.tick();

    expect(document.body.textContent).toContain(charactersEn.sheet.rest.dialog.noHitDice);

    buttonNamed(charactersEn.sheet.rest.dialog.confirmShort).click();
    TestBed.tick();

    expect(await handle.closed).toEqual({ kind: 'short', drafts: [] });
  });

  it('rolling a hit die decrements the remaining count, disables Roll at 0, and renders a kept-style entry per roll', async () => {
    await seedFighter('Ivan');
    await levelUpToTwo();
    const characterStore = TestBed.inject(CharacterStore);
    const sheet = characterStore.sheet()!;
    expect(sheet.hp.hitDice[FIGHTER]?.remaining).toBe(2);
    const conMod = sheet.abilities['con'].mod;

    scriptRolls([
      { value: 6, sides: 10 },
      { value: 9, sides: 10 },
    ]);

    const handle = open({
      kind: 'short',
      sheet,
      hitDiceOptions: [{ classId: FIGHTER, className: 'Fighter' }],
    });
    TestBed.tick();

    expect(remainingText()).toContain('2');
    expect(rollButton().disabled).toBe(false);

    rollButton().click();
    TestBed.tick();

    expect(remainingText()).toContain('1');
    expect(rollButton().disabled).toBe(false);
    expect(rolledEntries()).toHaveLength(1);
    expect(rolledEntries()[0]).toContain('6');
    expect(rolledEntries()[0]).toContain(String(6 + conMod));

    rollButton().click();
    TestBed.tick();

    expect(remainingText()).toContain('0');
    expect(rollButton().disabled).toBe(true);
    expect(rolledEntries()).toHaveLength(2);
    expect(rolledEntries()[1]).toContain('9');
    expect(rolledEntries()[1]).toContain(String(9 + conMod));

    buttonNamed(charactersEn.sheet.rest.dialog.confirmShort).click();
    TestBed.tick();

    const result = (await handle.closed) as { kind: 'short'; drafts: unknown[] };
    expect(result.kind).toBe('short');
    expect(result.drafts).toEqual([
      { type: 'hit_dice.spent', v: 1, payload: { classId: FIGHTER, count: 1, healed: 6 + conMod } },
      { type: 'hit_dice.spent', v: 1, payload: { classId: FIGHTER, count: 1, healed: 9 + conMod } },
    ]);
  });
});
