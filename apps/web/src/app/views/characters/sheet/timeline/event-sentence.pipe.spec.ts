import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestBed } from '@angular/core/testing';
import {
  createContentIndex,
  createLocalizer,
  type ContentIndex,
  type Localizer,
  type Sheet,
} from '@hk/engine';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Event, type Pack } from '@hk/protocol';
import { provideTransloco, TranslocoService, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { firstValueFrom, of } from 'rxjs';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import charactersRu from '../../../../../assets/i18n/characters/ru.json';
import charactersUk from '../../../../../assets/i18n/characters/uk.json';
import sampleJson from '../../../../../testing/fixtures/packs/sample-content.json';
import { eventFamily, EventSentencePipe, sentenceOf } from './event-sentence.pipe';

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling) — same fixture-loading
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

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    if (langPath === 'characters/ru') return of(charactersRu);
    if (langPath === 'characters/uk') return of(charactersUk);
    return of({});
  }
}

function makeEvent(type: string, payload: unknown, txId?: string): Event {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    stream: 'char:00000000-0000-4000-8000-000000000002',
    seq: 1,
    ts: '2026-09-12T00:00:00.000Z',
    actor: { userId: 'local', deviceId: 'device-1', role: 'owner' },
    type,
    v: 1,
    ...(txId !== undefined ? { txId } : {}),
    payload,
  };
}

describe('EventSentencePipe', () => {
  let pipe: EventSentencePipe;
  let index: ContentIndex;
  let localizer: Localizer;
  let translocoService: TranslocoService;

  beforeEach(async () => {
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
      ],
    });
    translocoService = TestBed.inject(TranslocoService);
    // No component here provides `provideTranslocoScope('characters')` (the mechanism every
    // real caller uses) to trigger the scope's lazy load — force it directly so
    // `TranslocoService.translate()` below has the real `characters/en.json` in its cache,
    // same lang/scope path `StubLoader` serves.
    await firstValueFrom(translocoService.load('characters/en'));
    pipe = TestBed.runInInjectionContext(() => new EventSentencePipe());
    index = createContentIndex([corePack]);
    localizer = createLocalizer(index, 'en');
  });

  it('renders a "character.created" sentence containing the character name', () => {
    const event = makeEvent('character.created', {
      name: 'Ivan',
      system: 'srd-5e-2024',
      corePack: { id: corePack.id, version: corePack.version },
      engineVersion: '1.0.0',
      grammaticalGender: 'masculine',
    });
    expect(pipe.transform(event, index, localizer)).toContain('Ivan');
  });

  it('renders a "decision.made" sentence with the selection resolved to its localized entity name', () => {
    const event = makeEvent('decision.made', {
      choiceId: 'srd-5e-2024:class/fighter@1/fighting-style',
      selection: ['srd-5e-2024:feat/defense'],
    });
    expect(pipe.transform(event, index, localizer)).toContain('Defense');
  });

  it('renders a "level.gained" sentence with the level number and the localized class name', () => {
    const event = makeEvent('level.gained', {
      classId: 'srd-5e-2024:class/fighter',
      level: 2,
    });
    const sentence = pipe.transform(event, index, localizer);
    expect(sentence).toContain('2');
    expect(sentence).toContain('Fighter');
  });

  it('falls back to the generic "unknown" sentence for a type outside the known registry', () => {
    const event = makeEvent('some.future_type', { anything: 'goes' });
    expect(() => pipe.transform(event, index, localizer)).not.toThrow();
    expect(pipe.transform(event, index, localizer)).toContain('some.future_type');
  });

  // Localization regression coverage: `hp.changed`'s `kind` is a payload ENUM
  // (damage/heal/temp/set), not a name or number — every locale must ICU-`select` it into a real
  // word rather than interpolating the raw English literal (the defect a task-12 review caught in
  // ru/uk's `hp-changed`/`rest-taken`/`death-save-recorded`). Rendered through ru specifically
  // (not just en) so a future edit that reintroduces raw-token interpolation in a NON-en locale
  // fails here too.
  it('renders a "hp.changed" sentence in ru via ICU select, not the raw English "heal" token', async () => {
    await firstValueFrom(translocoService.load('characters/ru'));
    translocoService.setActiveLang('ru');
    const event = makeEvent('hp.changed', { delta: 5, kind: 'heal' });
    const sentence = pipe.transform(event, index, localizer);
    expect(sentence).toContain('5');
    expect(sentence).toContain('Восстановлено');
    expect(sentence).not.toContain('heal');
  });

  it('appends a "(+N more events)" suffix when groupSize > 1, reusing the lead event sentence', () => {
    const event = makeEvent('character.renamed', { name: 'Ivanka' }, 'tx-1');
    const single = pipe.transform(event, index, localizer, 1);
    const grouped = pipe.transform(event, index, localizer, 3);
    expect(grouped).not.toBe(single);
    expect(grouped.startsWith(single)).toBe(true);
    expect(grouped).toContain('2'); // groupSize 3 - the lead event itself = 2 more
  });

  it('sentenceOf (the pure half) returns a plain key/params record, not resolved text', () => {
    const event = makeEvent('character.renamed', { name: 'Ivanka' }, 'tx-1');
    const sentence = sentenceOf(event, index, localizer);
    expect(sentence.key).toBe('characters.timeline.character-renamed');
    expect(sentence.params['name']).toBe('Ivanka');
  });

  it('eventFamily maps representative event types to the documented families', () => {
    expect(eventFamily('character.created')).toBe('identity');
    expect(eventFamily('decision.made')).toBe('decisions');
    expect(eventFamily('level.gained')).toBe('leveling');
    expect(eventFamily('hp.changed')).toBe('combat');
    expect(eventFamily('item.added')).toBe('items');
    expect(eventFamily('note.added')).toBe('other');
    expect(eventFamily('event.reverted')).toBe('other');
  });

  // task-14: ICU gender coverage — `level.gained` has no `grammaticalGender` field of its own
  // (LevelGainedV1's payload is classId/level/hpRoll/subclassId only), so this is the case that
  // exercises the pipe's OWN new 5th `grammaticalGender` argument (threaded from the character's
  // CURRENT facts, not the event payload) rather than a value `buildParams` already copied off the
  // payload. Same event/params, only the gender argument differs — ru's «Достиг»/«Достигла» is the
  // acceptance criterion's literal example.
  it('renders a "level.gained" sentence gendered via the pipe\'s grammaticalGender argument in ru (masculine "Достиг" vs feminine "Достигла")', async () => {
    await firstValueFrom(translocoService.load('characters/ru'));
    translocoService.setActiveLang('ru');
    const event = makeEvent('level.gained', { classId: 'srd-5e-2024:class/fighter', level: 2 });
    const masculine = pipe.transform(event, index, localizer, 1, 'masculine');
    const feminine = pipe.transform(event, index, localizer, 1, 'feminine');
    const neuter = pipe.transform(event, index, localizer, 1, 'neuter');
    expect(masculine).toContain('Достиг 2 уровня');
    expect(masculine).not.toContain('Достигла');
    expect(feminine).toContain('Достигла 2 уровня');
    expect(neuter).toContain('Достигло 2 уровня');
  });

  // Same coverage in uk, and via `sentenceOf` (the pure half) directly — confirms the gender
  // argument lands in `params.grammaticalGender` rather than only working by accident through the
  // pipe's own translate call.
  it('sentenceOf threads an explicit grammaticalGender argument into params without a payload field to source it from', () => {
    const event = makeEvent('level.gained', { classId: 'srd-5e-2024:class/fighter', level: 2 });
    const sentence = sentenceOf(event, index, localizer, 'feminine');
    expect(sentence.params['grammaticalGender']).toBe('feminine');
  });

  // A payload that DOES carry its own `grammaticalGender` (`character.created`) must win over the
  // pipe-level argument — the event's historical value, not whatever the character's CURRENT facts
  // happen to be, is what that sentence should agree with.
  it("sentenceOf keeps the payload's own grammaticalGender over a conflicting pipe-level argument", () => {
    const event = makeEvent('character.created', {
      name: 'Ivanka',
      system: 'srd-5e-2024',
      corePack: { id: corePack.id, version: corePack.version },
      engineVersion: '1.0.0',
      grammaticalGender: 'feminine',
    });
    const sentence = sentenceOf(event, index, localizer, 'masculine');
    expect(sentence.params['grammaticalGender']).toBe('feminine');
  });

  // Plan 14 (phase 4 slice 4) Task 5, ruling 8: `character.options.set` gets its own sentence
  // (`characters.timeline.character-options-set`), ICU-`select`ing the optional `encumbrance` enum
  // — and an empty patch (no `encumbrance` key at all) still renders, via the `other` branch,
  // rather than throwing on a missing ICU param.
  it('renders a "character.options.set" sentence per encumbrance mode, and a generic one for an empty patch', () => {
    const variant = pipe.transform(
      makeEvent('character.options.set', { encumbrance: 'variant' }),
      index,
      localizer,
    );
    expect(variant).toBe('Encumbrance set to variant (encumbered tiers).');
    const off = pipe.transform(
      makeEvent('character.options.set', { encumbrance: 'off' }),
      index,
      localizer,
    );
    expect(off).toBe('Encumbrance turned off.');
    const empty = pipe.transform(makeEvent('character.options.set', {}), index, localizer);
    expect(empty).toBe('Rule options updated.');
    expect(sentenceOf(makeEvent('character.options.set', {}), index, localizer).key).toBe(
      'characters.timeline.character-options-set',
    );
  });

  it('renders a "character.options.set" sentence in ru via ICU select, not the raw "standard" token', async () => {
    await firstValueFrom(translocoService.load('characters/ru'));
    translocoService.setActiveLang('ru');
    const sentence = pipe.transform(
      makeEvent('character.options.set', { encumbrance: 'standard' }),
      index,
      localizer,
    );
    expect(sentence).toContain('стандартное');
    expect(sentence).not.toContain('standard');
  });

  // Plan 14 final fix wave (ICU param safety): the `{encumbrance}` select param is ALWAYS supplied
  // — `'other'` for an empty patch or a future option key — mirroring `resource.restored`'s
  // always-set `restored`, so no locale's formatter ever sees a missing select argument.
  it('always supplies the "encumbrance" param for "character.options.set" (empty / future-key payload → other)', async () => {
    const params = (payload: unknown) =>
      sentenceOf(makeEvent('character.options.set', payload), index, localizer).params;
    expect(params({})['encumbrance']).toBe('other');
    expect(params({ lighting: 'dim' })['encumbrance']).toBe('other');
    expect(params({ encumbrance: 'variant' })['encumbrance']).toBe('variant');
    expect(
      pipe.transform(makeEvent('character.options.set', { lighting: 'dim' }), index, localizer),
    ).toBe('Rule options updated.');
    for (const [lang, generic] of [
      ['ru', 'Опции правил обновлены.'],
      ['uk', 'Опції правил оновлено.'],
    ] as const) {
      await firstValueFrom(translocoService.load(`characters/${lang}`));
      translocoService.setActiveLang(lang);
      expect(pipe.transform(makeEvent('character.options.set', {}), index, localizer)).toBe(
        generic,
      );
    }
  });

  // Plan 14 Task 6: a counted `resource.restored` (rolled item regain, or the play tab's one-pip
  // restore) says how much came back, and an `item:<uuid>` resource id resolves to that inventory
  // instance's item name from the sheet instead of leaking the raw key.
  const WAND_INSTANCE = '55555555-5555-4555-8555-555555555555';
  const wandSheet = {
    resources: [
      {
        id: `item:${WAND_INSTANCE}`,
        name: 'Wand of Magic Missiles',
        max: {
          value: 7,
          contributions: [
            {
              source: 'srd-5e-2024:item/wand-of-magic-missiles',
              kind: 'item.charges',
              formula: '7',
              key: `item:${WAND_INSTANCE}`,
              amount: 7,
            },
          ],
        },
        used: 3,
        reset: 'dawn',
        display: 'number',
        source: 'srd-5e-2024:item/wand-of-magic-missiles',
      },
      {
        id: 'second-wind',
        name: 'Second Wind',
        max: {
          value: 2,
          contributions: [
            {
              source: 'srd-5e-2024:class/fighter',
              feature: 'srd-5e-2024:feature/fighter-second-wind',
              kind: 'resource.define',
              formula: '2',
              key: 'second-wind',
              amount: 2,
            },
          ],
        },
        used: 1,
        reset: 'shortRest',
        display: 'pips',
        source: 'srd-5e-2024:feature/fighter-second-wind',
      },
    ],
    inventory: [
      {
        instanceId: WAND_INSTANCE,
        itemId: 'srd-5e-2024:item/wand-of-magic-missiles',
        qty: 1,
        equipped: true,
        attuned: false,
        resolved: true,
      },
    ],
  } as unknown as Sheet;

  it('renders a counted "resource.restored" with the item instance name from the sheet', () => {
    const resourceId = `item:${WAND_INSTANCE}`;
    const two = pipe.transform(
      makeEvent('resource.restored', { resourceId, count: 2 }),
      index,
      localizer,
      1,
      undefined,
      wandSheet,
    );
    expect(two).toBe('Restored 2 charges of Wand of Magic Missiles.');
    const one = pipe.transform(
      makeEvent('resource.restored', { resourceId, count: 1 }),
      index,
      localizer,
      1,
      undefined,
      wandSheet,
    );
    expect(one).toBe('Restored 1 charge of Wand of Magic Missiles.');
  });

  it('a feature resource counts uses, and the uncounted (full-restore) form keeps its sentence', () => {
    const one = pipe.transform(
      makeEvent('resource.restored', { resourceId: 'second-wind', count: 1 }),
      index,
      localizer,
      1,
      undefined,
      wandSheet,
    );
    expect(one).toBe('Restored 1 use of Second Wind.');
    const full = pipe.transform(
      makeEvent('resource.restored', { resourceId: 'second-wind' }),
      index,
      localizer,
      1,
      undefined,
      wandSheet,
    );
    expect(full).toBe('Restored Second Wind.');
  });

  it('an item resource whose instance left the derived resources still names the inventory item', () => {
    const unequipped = {
      ...wandSheet,
      resources: [],
    } as unknown as Sheet;
    const sentence = pipe.transform(
      makeEvent('resource.spent', { resourceId: `item:${WAND_INSTANCE}` }),
      index,
      localizer,
      1,
      undefined,
      unequipped,
    );
    expect(sentence).toBe('Spent Wand of Magic Missiles.');
  });

  // Fix round 1: charges vs uses is decided from the sheet's DATA when the resource is on it — a
  // pool whose max comes from an item's `charges` (`item.charges` contribution) counts charges —
  // never from the id's spelling; the `item:` prefix is only the fallback once it left the sheet.
  it('decides charges vs uses from the sheet resource, not from the id prefix', () => {
    const sheet = {
      resources: [
        {
          id: 'staff-pool',
          name: 'Staff Pool',
          max: {
            value: 4,
            contributions: [
              { source: 'srd-5e-2024:item/staff', kind: 'item.charges', formula: '4', amount: 4 },
            ],
          },
          used: 2,
          reset: 'dawn',
          display: 'number',
          source: 'x:item/staff',
        },
        {
          id: `item:${WAND_INSTANCE}`,
          name: 'Odd Pool',
          max: {
            value: 1,
            contributions: [
              { source: 'x:feature/odd', kind: 'resource.define', formula: '1', amount: 1 },
            ],
          },
          used: 1,
          reset: 'longRest',
          display: 'pips',
          source: 'x:feature/odd',
        },
      ],
      inventory: [],
    } as unknown as Sheet;
    const restore = (resourceId: string) =>
      pipe.transform(
        makeEvent('resource.restored', { resourceId, count: 2 }),
        index,
        localizer,
        1,
        undefined,
        sheet,
      );
    expect(restore('staff-pool')).toBe('Restored 2 charges of Staff Pool.');
    expect(restore(`item:${WAND_INSTANCE}`)).toBe('Restored 2 uses of Odd Pool.');
  });

  it('without a sheet an item resource id falls back to the raw key (no crash)', () => {
    const sentence = pipe.transform(
      makeEvent('resource.restored', { resourceId: `item:${WAND_INSTANCE}`, count: 3 }),
      index,
      localizer,
    );
    expect(sentence).toBe(`Restored 3 charges of item:${WAND_INSTANCE}.`);
  });

  it('renders a counted "resource.restored" with ru CLDR plural forms', async () => {
    await firstValueFrom(translocoService.load('characters/ru'));
    translocoService.setActiveLang('ru');
    const event = (count: number) =>
      makeEvent('resource.restored', { resourceId: `item:${WAND_INSTANCE}`, count });
    const few = pipe.transform(event(2), index, localizer, 1, undefined, wandSheet);
    const many = pipe.transform(event(5), index, localizer, 1, undefined, wandSheet);
    expect(few).toContain('2 заряда');
    expect(many).toContain('5 зарядов');
    expect(few).not.toContain('item:');
  });

  // task-14: ICU plural coverage — `hit_dice.spent` already carries full ru CLDR one/few/many
  // forms («кость»/«кости»/«костей»); this locks that in with a real spec instead of relying on
  // eyeballing the JSON.
  it('renders a "hit_dice.spent" sentence with the full ru CLDR plural forms across one/few/many', async () => {
    await firstValueFrom(translocoService.load('characters/ru'));
    translocoService.setActiveLang('ru');
    const payload = (count: number) => ({ classId: 'srd-5e-2024:class/fighter', count });
    const one = pipe.transform(makeEvent('hit_dice.spent', payload(1)), index, localizer);
    const few = pipe.transform(makeEvent('hit_dice.spent', payload(2)), index, localizer);
    const many = pipe.transform(makeEvent('hit_dice.spent', payload(5)), index, localizer);
    expect(one).toContain('1 кость');
    expect(few).toContain('2 кости');
    expect(many).toContain('5 костей');
  });

  describe('pack pins (plan 15 Task 5)', () => {
    const parsed = parsePack(sampleJson);
    if (!parsed.ok) throw new Error('sample-content.json fixture no longer parses');
    const sample = parsed.pack;
    const pinned = (payload: Record<string, string>) => makeEvent('pack.pinned', payload);
    let withSample: ContentIndex;
    let withSampleLocalizer: Localizer;

    beforeEach(() => {
      withSample = createContentIndex([corePack, sample]);
      withSampleLocalizer = createLocalizer(withSample, 'en');
    });

    it('"pack.pinned" without previous: Pinned <pack name> <version>', () => {
      const event = pinned({ packId: sample.id, version: '1.0.0' });
      expect(pipe.transform(event, withSample, withSampleLocalizer)).toBe(
        'Pinned Sample content v1.0.0.',
      );
      expect(sentenceOf(event, withSample, withSampleLocalizer).params).toMatchObject({
        packName: 'Sample content',
        pinKind: 'pin',
      });
    });

    it('"pack.pinned" with previous: Updated <pack name> <previous> → <version>', () => {
      const event = pinned({ packId: sample.id, version: '1.1.0', previous: '1.0.0' });
      expect(pipe.transform(event, withSample, withSampleLocalizer)).toBe(
        'Updated Sample content v1.0.0 → v1.1.0.',
      );
      expect(sentenceOf(event, withSample, withSampleLocalizer).params['pinKind']).toBe('update');
    });

    it('a pack that is not in the character index is named by its raw id', () => {
      expect(
        pipe.transform(pinned({ packId: sample.id, version: '1.0.0' }), index, localizer),
      ).toBe('Pinned sample-content v1.0.0.');
      expect(
        pipe.transform(makeEvent('pack.unpinned', { packId: sample.id }), index, localizer),
      ).toBe('Unpinned sample-content.');
    });

    it('an unpinned pack that is still installed is named from the installed packs', () => {
      const event = makeEvent('pack.unpinned', { packId: sample.id });
      expect(pipe.transform(event, index, localizer, 1, undefined, undefined, [sample])).toBe(
        'Unpinned Sample content.',
      );
    });

    it('"pack.unpinned": Unpinned <pack name>', () => {
      const event = makeEvent('pack.unpinned', { packId: sample.id });
      expect(sentenceOf(event, withSample, withSampleLocalizer).key).toBe(
        'characters.timeline.pack-unpinned',
      );
      expect(pipe.transform(event, withSample, withSampleLocalizer)).toBe(
        'Unpinned Sample content.',
      );
    });

    it('renders pinned / updated / unpinned in ru and uk', async () => {
      const expected = {
        ru: [
          'Закреплён Sample content v1.0.0.',
          'Обновлён Sample content: v1.0.0 → v1.1.0.',
          'Откреплён Sample content.',
        ],
        uk: [
          'Закріплено Sample content v1.0.0.',
          'Оновлено Sample content: v1.0.0 → v1.1.0.',
          'Відкріплено Sample content.',
        ],
      } as const;
      for (const lang of ['ru', 'uk'] as const) {
        await firstValueFrom(translocoService.load(`characters/${lang}`));
        translocoService.setActiveLang(lang);
        const sentences = [
          pinned({ packId: sample.id, version: '1.0.0' }),
          pinned({ packId: sample.id, version: '1.1.0', previous: '1.0.0' }),
          makeEvent('pack.unpinned', { packId: sample.id }),
        ].map((event) => pipe.transform(event, withSample, withSampleLocalizer));
        expect(sentences).toEqual(expected[lang]);
      }
    });
  });
});
