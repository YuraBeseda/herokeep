import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { createContentIndex, type ContentIndex, type RebasePlan } from '@hk/engine';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import charactersRu from '../../../../assets/i18n/characters/ru.json';
import charactersUk from '../../../../assets/i18n/characters/uk.json';
import sampleJson from '../../../../testing/fixtures/packs/sample-content.json';
import { DIALOG_DATA, DialogRef, DialogService } from '../dialog/dialog.service';
import {
  RebaseReportDialogComponent,
  type RebaseReportDialogData,
} from './rebase-report-dialog.component';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const result = parsePack(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!result.ok) throw new Error(`fixture pack at ${path} failed validation`);
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);
const parsedSample = parsePack(sampleJson);
if (!parsedSample.ok) throw new Error('sample-content.json fixture no longer parses');
const sample = parsedSample.pack;

const SPECIES_CHOICE = 'srd-5e-2024:system/5e-2024@0/species';
const FEAT_CHOICE = 'sample-content:background/gone@0/feat';
const MOONKIN = 'sample-content:species/moonkin';
const LUNAR = 'sample-content:feat/lunar-insight';
const GLIMMER = 'sample-content:spell/glimmer-dart';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return of(langPath === 'characters/en' ? charactersEn : {});
  }
}

const PLAN: RebasePlan = {
  changes: [
    { path: 'attacks[0].toHit.value', before: 5, after: 6 },
    { path: 'attacks[1].name', before: undefined, after: 'Moonblade Sickle' },
    { path: 'pins.sample-content', before: '1.0.0', after: '1.1.0' },
    { path: 'skills.arcana.proficient', before: false, after: true },
    { path: 'speeds.walk.value', before: 30, after: 35 },
    { path: 'traits', before: [], after: undefined },
  ],
  invalid: [
    { choiceId: FEAT_CHOICE, selection: [LUNAR], reason: 'choice-missing' },
    { choiceId: SPECIES_CHOICE, selection: [MOONKIN], reason: 'selection-missing' },
  ],
  migrations: [{ choiceId: SPECIES_CHOICE, from: GLIMMER, to: MOONKIN }],
  events: [
    {
      type: 'pack.pinned',
      v: 1,
      payload: { packId: 'sample-content', version: '1.1.0', previous: '1.0.0' },
    },
    { type: 'decision.cleared', v: 1, payload: { choiceId: SPECIES_CHOICE } },
  ],
};

const EMPTY: RebasePlan = { changes: [], invalid: [], migrations: [], events: [] };

function translocoProviders() {
  return [
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
  ];
}

function configure(data: RebaseReportDialogData | undefined): { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      ...translocoProviders(),
      { provide: DialogRef, useValue: { close } },
      ...(data ? [{ provide: DIALOG_DATA, useValue: data }] : []),
    ],
  });
  return { close };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** A change row's parts (path, before, arrow, after), space-joined. */
const parts = (el: Element | null | undefined) =>
  Array.from(el?.children ?? [])
    .map(text)
    .join(' ');

async function render(data: RebaseReportDialogData) {
  const mocks = configure(data);
  const fixture = TestBed.createComponent(RebaseReportDialogComponent);
  await fixture.whenStable();
  return { ...mocks, fixture, root: fixture.nativeElement as HTMLElement };
}

describe('RebaseReportDialogComponent (plan 15 Tasks 4–5)', () => {
  let next: ContentIndex;

  beforeEach(() => {
    next = createContentIndex([corePack, sample]);
  });

  it('shows the given title', async () => {
    const { root } = await render({ plan: PLAN, title: 'Update Sample content v1.0.0 → v1.1.0?' });
    expect(text(root.querySelector('[data-dialog-title]'))).toBe(
      'Update Sample content v1.0.0 → v1.1.0?',
    );
  });

  it('groups the sheet changes by top-level key, with formatted before/after values', async () => {
    const { root } = await render({ plan: PLAN, title: 'T', nextIndex: next });

    const groups = Array.from(root.querySelectorAll('.rebase-report__group'));
    expect(groups.map((g) => text(g.querySelector('.rebase-report__group-key')))).toEqual([
      'attacks',
      'pins',
      'skills',
      'speeds',
      'traits',
    ]);
    const attacks = Array.from(groups[0].querySelectorAll('.rebase-report__change')).map(parts);
    expect(attacks).toEqual([
      'attacks[0].toHit.value 5 → 6',
      'attacks[1].name (none) → Moonblade Sickle',
    ]);
    expect(parts(groups[2].querySelector('.rebase-report__change'))).toBe(
      'skills.arcana.proficient false → true',
    );
    // An object/array value is compact JSON in <code>; a scalar is inline text.
    const traits = groups[4].querySelector('.rebase-report__change')!;
    expect(text(traits.querySelector('code.rebase-report__value'))).toBe('[]');
    expect(groups[3].querySelector('code.rebase-report__value')).toBeNull();
    expect(text(groups[3].querySelector('.rebase-report__value'))).toBe('30');
  });

  it('lists invalidated decisions with the reason label, the choice prompt and the selection names', async () => {
    const { root } = await render({ plan: PLAN, title: 'T', nextIndex: next });

    const items = Array.from(root.querySelectorAll('.rebase-report__invalid-item'));
    expect(items).toHaveLength(2);
    // A choice the next index does not have: the raw id, the raw selection when unknown.
    expect(text(items[0].querySelector('.rebase-report__prompt'))).toBe(FEAT_CHOICE);
    expect(text(items[0].querySelector('.rebase-report__reason'))).toBe(
      'The choice no longer exists.',
    );
    expect(text(items[0])).toContain('Lunar Insight');
    // A choice the next index has: its localized prompt and the localized selection names.
    expect(text(items[1].querySelector('.rebase-report__prompt'))).toBe('Species');
    expect(text(items[1].querySelector('.rebase-report__reason'))).toBe(
      'The selected option is no longer available.',
    );
    expect(text(items[1].querySelector('.rebase-report__selection'))).toBe('Selected: Moonkin');
  });

  it('without a next index, prompts and selections fall back to the raw ids', async () => {
    const { root } = await render({ plan: PLAN, title: 'T' });
    const item = root.querySelectorAll('.rebase-report__invalid-item')[1];
    expect(text(item.querySelector('.rebase-report__prompt'))).toBe(SPECIES_CHOICE);
    expect(text(item.querySelector('.rebase-report__selection'))).toBe(`Selected: ${MOONKIN}`);
  });

  it('lists migrations as "from → to" with localized names', async () => {
    const { root } = await render({ plan: PLAN, title: 'T', nextIndex: next });
    const migrations = Array.from(root.querySelectorAll('.rebase-report__migration')).map(text);
    expect(migrations).toEqual(['Species: Glimmer Dart → Moonkin']);
  });

  it('says "nothing changes" for an empty plan and shows no sections', async () => {
    const { root } = await render({ plan: EMPTY, title: 'T' });
    expect(text(root.querySelector('.rebase-report__empty'))).toBe('Nothing on the sheet changes.');
    expect(root.querySelector('.rebase-report__section')).toBeNull();
  });

  it('validation-only mode: no Changes section, the "previous version unavailable" note', async () => {
    const { root } = await render({
      plan: PLAN,
      title: 'T',
      nextIndex: next,
      validationOnly: true,
    });
    expect(root.querySelector('.rebase-report__group')).toBeNull();
    expect(root.querySelector('.rebase-report__changes')).toBeNull();
    expect(text(root.querySelector('.rebase-report__validation-note'))).toBe(
      charactersEn.rebase['validation-only'],
    );
    // Decisions are still validated against the new version.
    expect(root.querySelectorAll('.rebase-report__invalid-item')).toHaveLength(2);
  });

  it('validation-only with nothing invalid says every choice still holds', async () => {
    const { root } = await render({
      plan: { ...PLAN, invalid: [], migrations: [] },
      title: 'T',
      validationOnly: true,
    });
    expect(text(root.querySelector('.rebase-report__empty'))).toBe(
      charactersEn.rebase['validation-ok'],
    );
  });

  it('Confirm closes with true and emits `confirmed` exactly once (a second click does nothing)', async () => {
    const { close, fixture, root } = await render({ plan: PLAN, title: 'T' });
    const confirmed = vi.fn();
    const cancelled = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    fixture.componentInstance.cancelled.subscribe(cancelled);

    const confirm = root.querySelector<HTMLButtonElement>('.rebase-report__confirm')!;
    confirm.click();
    confirm.click();
    root.querySelector<HTMLButtonElement>('.rebase-report__cancel')!.click();

    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(true);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('Cancel closes with false, emits `cancelled` and nothing else', async () => {
    const { close, fixture, root } = await render({ plan: PLAN, title: 'T' });
    const confirmed = vi.fn();
    const cancelled = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    fixture.componentInstance.cancelled.subscribe(cancelled);

    root.querySelector<HTMLButtonElement>('.rebase-report__cancel')!.click();

    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(confirmed).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(false);
  });

  it('takes the plan/title inputs over DIALOG_DATA (embedded use)', async () => {
    configure(undefined);
    const fixture = TestBed.createComponent(RebaseReportDialogComponent);
    fixture.componentRef.setInput('plan', EMPTY);
    fixture.componentRef.setInput('title', 'Embedded');
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(text(root.querySelector('[data-dialog-title]'))).toBe('Embedded');
    expect(text(root.querySelector('.rebase-report__empty'))).toBe('Nothing on the sheet changes.');
  });

  describe('opened through DialogService (a11y)', () => {
    let trigger: HTMLButtonElement;

    beforeEach(() => {
      TestBed.configureTestingModule({ providers: translocoProviders() });
      trigger = document.createElement('button');
      document.body.appendChild(trigger);
      trigger.focus();
    });

    afterEach(() => {
      document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
      trigger.remove();
    });

    async function settle(): Promise<void> {
      for (let i = 0; i < 5; i++) {
        TestBed.tick();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    it('is labelled by its title and takes focus on open', async () => {
      // jsdom reports no geometry, which the CDK focus trap needs (see dialog.service.spec.ts).
      const rects = vi
        .spyOn(HTMLElement.prototype, 'getClientRects')
        .mockReturnValue([{}] as unknown as DOMRectList);
      try {
        const handle = TestBed.inject(DialogService).open(RebaseReportDialogComponent, {
          data: { plan: PLAN, title: 'Update Sample content?' },
        });
        await settle();

        const panel = document.querySelector('hk-dialog')!;
        const labelledBy = panel.getAttribute('aria-labelledby');
        expect(labelledBy).toBeTruthy();
        expect(text(document.getElementById(labelledBy!))).toBe('Update Sample content?');
        expect(panel.contains(document.activeElement)).toBe(true);
        handle.close();
      } finally {
        rects.mockRestore();
      }
    });

    it('Escape cancels: the dialog closes with a non-true result', async () => {
      const handle = TestBed.inject(DialogService).open(RebaseReportDialogComponent, {
        data: { plan: PLAN, title: 'T' },
      });
      await settle();
      document.querySelector<HTMLButtonElement>('.rebase-report__cancel')!.focus();

      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }),
      );
      await settle();

      expect(await handle.closed).not.toBe(true);
      expect(document.querySelector('hk-dialog')).toBeNull();
    });
  });

  it('every rebase string exists in en, ru and uk', () => {
    const keysOf = (o: object): string[] =>
      Object.entries(o)
        .flatMap(([k, v]) =>
          typeof v === 'object' && v !== null ? keysOf(v as object).map((s) => `${k}.${s}`) : [k],
        )
        .sort();
    const [en, ru, uk] = [charactersEn, charactersRu, charactersUk].map((locale) =>
      keysOf((locale as { rebase: object }).rebase),
    );
    expect(ru).toEqual(en);
    expect(uk).toEqual(en);
    expect(en).toEqual(
      [
        'arrow',
        'cancel',
        'changes-title',
        'confirm',
        'invalid-title',
        'migration',
        'migrations-title',
        'no-changes',
        'none',
        'reason.choice-missing',
        'reason.prerequisite-failed',
        'reason.selection-deprecated',
        'reason.selection-missing',
        'selection',
        'validation-ok',
        'validation-only',
      ].sort(),
    );
  });
});
