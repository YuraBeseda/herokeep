import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack } from '@hk/protocol';
import { PackStore } from '@shared/stores/pack.store';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@app/ui/dialog/dialog.service';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { ConditionDialogComponent, type ConditionDialogData } from './condition-dialog.component';

import { overlayRoot } from '../../../../ui/testing/overlay';

/** The condition picker (board DL03): one radio chip per condition. */
const chips = (): HTMLElement[] =>
  Array.from(overlayRoot().querySelectorAll<HTMLElement>('[role="radio"].condition-dialog__chip'));
const chipFor = (id: string): HTMLElement => chips().find((c) => c.dataset['id'] === id)!;

// The dialog scopes its own `EngineFacade` (it renders the effect text), so it needs the real pack.
const here = dirname(fileURLToPath(import.meta.url));
const parsed = parsePack(
  JSON.parse(
    readFileSync(
      join(
        here,
        '..',
        '..',
        '..',
        '..',
        '..',
        '..',
        '..',
        '..',
        'packages/content/dist/packs',
        PACK_ID,
        PACK_VERSION,
        'pack.json',
      ),
      'utf8',
    ),
  ),
);
if (!parsed.ok) throw new Error('core pack no longer parses');
const corePack = parsed.pack;

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return langPath === 'characters/en' ? of(charactersEn) : of({});
  }
}

function configure(): void {
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
    ],
  });
}

function open(data: ConditionDialogData) {
  const service = TestBed.inject(DialogService);
  return service.open(ConditionDialogComponent, { data });
}

const BASE_DATA: ConditionDialogData = {
  options: [
    { id: 'srd-5e-2024:condition/blinded', name: 'Blinded', levelBearing: false },
    {
      id: 'srd-5e-2024:condition/exhaustion',
      name: 'Exhaustion',
      levelBearing: true,
      maxLevel: 6,
    },
  ],
};

function buttonNamed(text: string): HTMLButtonElement {
  const button = Array.from(overlayRoot().querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!button) throw new Error(`no button matching "${text}"`);
  return button;
}

describe('ConditionDialogComponent', () => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('lists every option and selects the first by default', () => {
    configure();
    open(BASE_DATA);
    TestBed.tick();

    const options = chips();
    expect(options.map((o) => o.dataset['id'])).toEqual([
      'srd-5e-2024:condition/blinded',
      'srd-5e-2024:condition/exhaustion',
    ]);
    expect(options[0]?.getAttribute('aria-checked')).toBe('true');
    expect(options[1]?.getAttribute('aria-checked')).toBe('false');
  });

  it('hides the level stepper for a non-level-bearing condition (the default selection)', () => {
    configure();
    open(BASE_DATA);
    TestBed.tick();

    expect(overlayRoot().querySelector('input[type="number"]')).toBeNull();
  });

  it("shows a level stepper from 1 to the pack's own level count once a level-bearing condition is selected", () => {
    configure();
    open(BASE_DATA);
    TestBed.tick();

    chipFor('srd-5e-2024:condition/exhaustion').click();
    TestBed.tick();

    const level = overlayRoot().querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(level).not.toBeNull();
    expect(level.min).toBe('1');
    // Board DL03 (plan 17): the stepper is capped by the pack's own `levels` (exhaustion: 6), read
    // off the condition entity by the caller — never a constant in the UI. (Before plan 17 the
    // field gated the stepper's visibility only and left the maximum open.)
    expect(level.max).toBe('6');
  });

  it('confirm closes with {conditionId, level} for a level-bearing selection at the default level 1', async () => {
    configure();
    const handle = open(BASE_DATA);
    TestBed.tick();

    chipFor('srd-5e-2024:condition/exhaustion').click();
    TestBed.tick();

    buttonNamed(charactersEn.sheet.conditions.addDialog.confirm).click();
    TestBed.tick();

    expect(await handle.closed).toEqual({
      conditionId: 'srd-5e-2024:condition/exhaustion',
      level: 1,
    });
  });

  it('confirm closes with an undefined level for a non-level-bearing (default) selection', async () => {
    configure();
    const handle = open(BASE_DATA);
    TestBed.tick();

    buttonNamed(charactersEn.sheet.conditions.addDialog.confirm).click();
    TestBed.tick();

    expect(await handle.closed).toEqual({
      conditionId: 'srd-5e-2024:condition/blinded',
      level: undefined,
    });
  });

  it('a changed level on the stepper is carried through to confirm', async () => {
    configure();
    const handle = open(BASE_DATA);
    TestBed.tick();

    chipFor('srd-5e-2024:condition/exhaustion').click();
    TestBed.tick();

    const level = overlayRoot().querySelector<HTMLInputElement>('input[type="number"]')!;
    level.value = '3';
    level.dispatchEvent(new Event('input'));
    TestBed.tick();

    buttonNamed(charactersEn.sheet.conditions.addDialog.confirm).click();
    TestBed.tick();

    expect(await handle.closed).toEqual({
      conditionId: 'srd-5e-2024:condition/exhaustion',
      level: 3,
    });
  });

  it('cancel closes with undefined', async () => {
    configure();
    const handle = open(BASE_DATA);
    TestBed.tick();

    buttonNamed(charactersEn.sheet.conditions.addDialog.cancel).click();
    TestBed.tick();

    expect(await handle.closed).toBeUndefined();
  });

  // --- Board DL03: the level stepper cap, the picker and the empty duration slot -----------------

  describe('level stepper cap', () => {
    function pickExhaustion(): HTMLInputElement {
      chipFor('srd-5e-2024:condition/exhaustion').click();
      TestBed.tick();
      return overlayRoot().querySelector<HTMLInputElement>('input[type="number"]')!;
    }

    it('has no maximum when the pack gives the condition no level count', () => {
      configure();
      open({
        options: [{ id: 'x:condition/open', name: 'Open', levelBearing: true }],
      });
      TestBed.tick();
      expect(overlayRoot().querySelector<HTMLInputElement>('input[type="number"]')!.max).toBe('');
    });

    it('holds a level typed past the cap at the cap, and confirms at the cap', async () => {
      configure();
      const handle = open(BASE_DATA);
      TestBed.tick();
      const level = pickExhaustion();
      level.value = '9';
      level.dispatchEvent(new Event('input'));
      level.dispatchEvent(new Event('change'));
      TestBed.tick();

      expect(level.value).toBe('6');
      buttonNamed(charactersEn.sheet.conditions.addDialog.confirm).click();
      TestBed.tick();
      expect(await handle.closed).toEqual({
        conditionId: 'srd-5e-2024:condition/exhaustion',
        level: 6,
      });
    });

    it('steps one level at a time with the + button and stops at the cap', async () => {
      configure();
      const handle = open(BASE_DATA);
      TestBed.tick();
      const level = pickExhaustion();
      level.value = '5';
      level.dispatchEvent(new Event('input'));
      TestBed.tick();

      const plus = overlayRoot().querySelector<HTMLButtonElement>(
        '.hk-numfield__step:last-of-type',
      )!;
      plus.click();
      TestBed.tick();
      plus.click();
      TestBed.tick();
      expect(level.value).toBe('6');

      buttonNamed(charactersEn.sheet.conditions.addDialog.confirm).click();
      TestBed.tick();
      expect(await handle.closed).toMatchObject({ level: 6 });
    });

    it('says the range in a hint under the stepper', () => {
      configure();
      open(BASE_DATA);
      TestBed.tick();
      pickExhaustion();
      expect(overlayRoot().textContent).toContain(
        charactersEn.sheet.conditions.addDialog.levelHint.replace('{max}', '6'),
      );
    });

    it('resets the level to 1 when another level-bearing condition is chosen', () => {
      configure();
      open({
        options: [
          { id: 'a', name: 'Alpha', levelBearing: true, maxLevel: 3 },
          { id: 'b', name: 'Beta', levelBearing: true, maxLevel: 10 },
        ],
      });
      TestBed.tick();
      const first = overlayRoot().querySelector<HTMLInputElement>('input[type="number"]')!;
      first.value = '3';
      first.dispatchEvent(new Event('input'));
      TestBed.tick();
      chipFor('b').click();
      TestBed.tick();
      const level = overlayRoot().querySelector<HTMLInputElement>('input[type="number"]')!;
      expect(level.value).toBe('1');
      expect(level.max).toBe('10');
    });
  });

  describe('picker', () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 220));

    it('is one radio group named by the condition label, and the arrow keys move the choice', async () => {
      configure();
      const handle = open(BASE_DATA);
      TestBed.tick();
      const group = overlayRoot().querySelector('[role="radiogroup"]')!;
      expect(group.getAttribute('aria-label')).toBe(
        charactersEn.sheet.conditions.addDialog.conditionLabel,
      );
      expect(chips().map((c) => c.tabIndex)).toEqual([0, -1]);

      chips()[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      );
      TestBed.tick();
      expect(chips().map((c) => c.getAttribute('aria-checked'))).toEqual(['false', 'true']);
      expect(chips().map((c) => c.tabIndex)).toEqual([-1, 0]);

      buttonNamed(charactersEn.sheet.conditions.addDialog.confirm).click();
      TestBed.tick();
      expect(await handle.closed).toMatchObject({
        conditionId: 'srd-5e-2024:condition/exhaustion',
      });
    });

    it('narrows the chips as you type, and says so when nothing matches', async () => {
      configure();
      open(BASE_DATA);
      TestBed.tick();
      const search = overlayRoot().querySelector<HTMLInputElement>('input[type="search"]')!;
      search.value = 'exh';
      search.dispatchEvent(new Event('input'));
      await settle();
      TestBed.tick();
      expect(chips().map((c) => c.dataset['id'])).toEqual(['srd-5e-2024:condition/exhaustion']);

      search.value = 'zzz';
      search.dispatchEvent(new Event('input'));
      await settle();
      TestBed.tick();
      expect(chips()).toHaveLength(0);
      expect(overlayRoot().textContent).toContain(charactersEn.sheet.conditions.addDialog.noMatch);
      expect(buttonNamed(charactersEn.sheet.conditions.addDialog.confirm).disabled).toBe(true);
    });

    it('moves the choice to the first condition still shown when the search hides the chosen one', async () => {
      configure();
      const handle = open(BASE_DATA);
      TestBed.tick();
      const search = overlayRoot().querySelector<HTMLInputElement>('input[type="search"]')!;
      search.value = 'exh';
      search.dispatchEvent(new Event('input'));
      await settle();
      TestBed.tick();
      // Blinded (the default choice) is filtered out, so the choice follows to Exhaustion rather
      // than staying on something the player can no longer see.
      expect(chips()[0].getAttribute('aria-checked')).toBe('true');
      buttonNamed(charactersEn.sheet.conditions.addDialog.confirm).click();
      TestBed.tick();
      expect(await handle.closed).toEqual({
        conditionId: 'srd-5e-2024:condition/exhaustion',
        level: 1,
      });
    });
  });

  it('has no duration fields yet (slice 2 fills that slot) and keeps its actions on the leather strap', async () => {
    configure();
    open(BASE_DATA);
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    chipFor('srd-5e-2024:condition/exhaustion').click();
    TestBed.tick();

    expect(overlayRoot().querySelectorAll('input[type="number"]')).toHaveLength(1); // the level only
    expect(overlayRoot().querySelector('[class*="duration"]')).toBeNull();
    const strap = overlayRoot().querySelector('[data-dialog-actions]')!;
    expect(Array.from(strap.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual([
      charactersEn.sheet.conditions.addDialog.cancel,
      charactersEn.sheet.conditions.addDialog.confirm,
    ]);
  });

  // --- Board DL03: the condition's effect text ----------------------------------------------------

  describe('effect text', () => {
    const settle = async () => {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        TestBed.tick();
      }
    };

    it('shows the chosen condition description, rendered as markdown, and follows the choice', async () => {
      configure();
      open({
        options: [
          { id: 'a', name: 'Alpha', levelBearing: false, description: 'Cannot **see**.' },
          { id: 'b', name: 'Beta', levelBearing: false, description: 'Cannot hear.' },
        ],
      });
      TestBed.tick();
      await settle();
      const body = () => overlayRoot().querySelector('.condition-dialog__effect-body');
      expect(body()?.querySelector('strong')?.textContent).toBe('see');
      expect(body()?.textContent).toContain('Cannot see.');

      chipFor('b').click();
      TestBed.tick();
      await settle();
      expect(body()?.textContent).toContain('Cannot hear.');
      expect(body()?.querySelector('strong')).toBeNull();
    });

    it('sanitizes the text the same way the description drawer does (no script survives)', async () => {
      configure();
      open({
        options: [
          {
            id: 'a',
            name: 'Alpha',
            levelBearing: false,
            description:
              'Safe <script>window.__pwned = 1</script><img src=x onerror="window.__pwned=1">',
          },
        ],
      });
      TestBed.tick();
      await settle();
      const body = overlayRoot().querySelector('.condition-dialog__effect-body')!;
      expect(body.querySelector('script')).toBeNull();
      expect(body.innerHTML).not.toContain('onerror');
      expect(body.textContent).toContain('Safe');
    });

    it('shows no effect block for a condition without a description', async () => {
      configure();
      open({ options: [{ id: 'a', name: 'Alpha', levelBearing: false }] });
      TestBed.tick();
      await settle();
      expect(overlayRoot().querySelector('.condition-dialog__effect')).toBeNull();
    });
  });
});
