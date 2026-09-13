import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestBed } from '@angular/core/testing';
import { createContentIndex, createLocalizer, type ContentIndex, type Localizer } from '@hk/engine';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Event, type Pack } from '@hk/protocol';
import { provideTransloco, TranslocoService, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { firstValueFrom, of } from 'rxjs';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
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
});
