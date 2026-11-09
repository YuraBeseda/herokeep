import { TestBed } from '@angular/core/testing';
import { provideTransloco, provideTranslocoScope, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@app/ui/dialog/dialog.service';
import libraryEn from '../../../../../assets/i18n/library/en.json';
import charactersEn from '../../../../../assets/i18n/characters/en.json';
import { overlayRoot } from '../../../../ui/testing/overlay';
import { CastDialogComponent, type CastDialogData } from './cast-dialog.component';

/** The pay-with lanes (board DL01): one radio per available slot, pact slot or free-cast option. */
const lanes = (): HTMLElement[] =>
  Array.from(overlayRoot().querySelectorAll<HTMLElement>('[role="radio"].cast-dialog__lane'));
const laneTitle = (lane: HTMLElement): string =>
  lane.querySelector('.cast-dialog__lane-title')?.textContent?.trim() ?? '';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'library/en') return of(libraryEn);
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
    ],
  });
}

function open(data: CastDialogData) {
  const service = TestBed.inject(DialogService);
  return service.open(CastDialogComponent, { data });
}

const BASE_DATA: CastDialogData = {
  spellName: 'Burning Hands',
  spellLevel: 1,
  spellConcentration: false,
  alreadyConcentrating: false,
  availableSlots: [{ level: 1, max: 2, used: 0 }],
};

describe('CastDialogComponent', () => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('lists each available slot as an option (level + remaining), never a "no slot" option', () => {
    configure();
    open({
      ...BASE_DATA,
      availableSlots: [
        { level: 1, max: 2, used: 1 },
        { level: 2, max: 1, used: 0 },
      ],
    });
    TestBed.tick();

    // Task 12: a lane's identity is the ARRAY INDEX (never the bare level) — two options can share
    // the same `level` (a pact slot and a regular slot both at level 3), so index is what
    // disambiguates the selection; see the component's own class doc.
    const options = lanes();
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.dataset['index'])).toEqual(['0', '1']);
    expect(options[0].textContent).toContain('1');
    expect(options.some((o) => /no slot/i.test(o.textContent ?? ''))).toBe(false);
  });

  it('shows the "no slots available" message and disables confirm when availableSlots is empty', () => {
    configure();
    open({ ...BASE_DATA, availableSlots: [] });
    TestBed.tick();

    expect(lanes()).toHaveLength(0);
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    const confirmButton = buttons.find(
      (b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.castDialog.confirm,
    )!;
    expect(confirmButton.disabled).toBe(true);
  });

  it('shows the "replaces current concentration" note only when the spell concentrates AND the sheet is already concentrating', () => {
    configure();
    open({ ...BASE_DATA, spellConcentration: true, alreadyConcentrating: true });
    TestBed.tick();

    expect(document.body.textContent).toContain(
      charactersEn.sheet.spellcasting.castDialog.replacesConcentration,
    );
  });

  it('hides the replaces-concentration note when the spell has no concentration tag', () => {
    configure();
    open({ ...BASE_DATA, spellConcentration: false, alreadyConcentrating: true });
    TestBed.tick();

    expect(document.body.textContent).not.toContain(
      charactersEn.sheet.spellcasting.castDialog.replacesConcentration,
    );
  });

  it('hides the replaces-concentration note when not currently concentrating, even if the spell concentrates', () => {
    configure();
    open({ ...BASE_DATA, spellConcentration: true, alreadyConcentrating: false });
    TestBed.tick();

    expect(document.body.textContent).not.toContain(
      charactersEn.sheet.spellcasting.castDialog.replacesConcentration,
    );
  });

  it('confirm closes the dialog with a CastDialogResult for the (default, first-option) selected slot', async () => {
    configure();
    const handle = open({
      ...BASE_DATA,
      availableSlots: [
        { level: 1, max: 2, used: 1 },
        { level: 2, max: 1, used: 0 },
      ],
    });
    TestBed.tick();

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    buttons
      .find((b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.castDialog.confirm)!
      .click();
    TestBed.tick();

    expect(await handle.closed).toEqual({ level: 1 });
  });

  it('confirm closes with a CHANGED slot selection when the select is changed before confirming', async () => {
    configure();
    const handle = open({
      ...BASE_DATA,
      availableSlots: [
        { level: 1, max: 2, used: 1 },
        { level: 2, max: 1, used: 0 },
      ],
    });
    TestBed.tick();

    // Index-based (task 12) — the SECOND lane is level 2.
    lanes()[1].click();
    TestBed.tick();

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    buttons
      .find((b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.castDialog.confirm)!
      .click();
    TestBed.tick();

    expect(await handle.closed).toEqual({ level: 2 });
  });

  // --- Pact-lane option (phase 4, plan 11, task 12) -------------------------------------------

  it('renders the pact option with its own distinct label, alongside a regular option at the SAME level', () => {
    configure();
    open({
      ...BASE_DATA,
      availableSlots: [
        { level: 3, max: 1, used: 0 },
        { level: 3, max: 2, used: 1, pact: true },
      ],
    });
    TestBed.tick();

    const options = lanes();
    expect(options).toHaveLength(2);
    expect(laneTitle(options[0])).toBe(
      charactersEn.sheet.spellcasting.castDialog.slotOption
        .replace('{level}', '3')
        .replace('{remaining}', '1'),
    );
    expect(laneTitle(options[1])).toBe(
      charactersEn.sheet.spellcasting.castDialog.slotOptionPact
        .replace('{level}', '3')
        .replace('{remaining}', '1'),
    );
  });

  it('confirm closes with { level, pact: true } when the pact option is selected', async () => {
    configure();
    const handle = open({
      ...BASE_DATA,
      availableSlots: [
        { level: 1, max: 2, used: 0 },
        { level: 3, max: 2, used: 0, pact: true },
      ],
    });
    TestBed.tick();

    lanes()[1].click(); // the pact option, index 1
    TestBed.tick();

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    buttons
      .find((b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.castDialog.confirm)!
      .click();
    TestBed.tick();

    expect(await handle.closed).toEqual({ level: 3, pact: true });
  });

  it('confirm closes with no pact field at all for a regular (non-pact) selection', async () => {
    configure();
    const handle = open({
      ...BASE_DATA,
      availableSlots: [{ level: 1, max: 2, used: 0 }],
    });
    TestBed.tick();

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    buttons
      .find((b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.castDialog.confirm)!
      .click();
    TestBed.tick();

    const result = await handle.closed;
    expect(result).toEqual({ level: 1 });
    expect(result).not.toHaveProperty('pact');
  });

  // --- Free-cast option (plan 13, task 4) ---------------------------------------------------------

  it('renders the free-cast option with its resource name, beside a regular option at the same level', () => {
    configure();
    open({
      ...BASE_DATA,
      availableSlots: [
        { level: 1, max: 2, used: 0 },
        { level: 1, max: 3, used: 1, freeResource: 'favored-enemy', freeLabel: 'Favored Enemy' },
      ],
    });
    TestBed.tick();

    expect(lanes().map(laneTitle)).toEqual([
      charactersEn.sheet.spellcasting.castDialog.slotOption
        .replace('{level}', '1')
        .replace('{remaining}', '2'),
      charactersEn.sheet.spellcasting.castDialog.slotOptionFree
        .replace('{resource}', 'Favored Enemy')
        .replace('{level}', '1')
        .replace('{remaining}', '2'),
    ]);
  });

  it('confirm closes with { level, freeResource } when the free-cast option is selected', async () => {
    configure();
    const handle = open({
      ...BASE_DATA,
      availableSlots: [
        { level: 1, max: 2, used: 0 },
        { level: 1, max: 3, used: 0, freeResource: 'favored-enemy', freeLabel: 'Favored Enemy' },
      ],
    });
    TestBed.tick();

    lanes()[1].click();
    TestBed.tick();
    Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.castDialog.confirm)!
      .click();
    TestBed.tick();

    expect(await handle.closed).toEqual({ level: 1, freeResource: 'favored-enemy' });
  });

  it('cancel closes the dialog with undefined', async () => {
    configure();
    const handle = open(BASE_DATA);
    TestBed.tick();

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    buttons
      .find((b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.castDialog.cancel)!
      .click();
    TestBed.tick();

    expect(await handle.closed).toBeUndefined();
  });

  // --- Lanes (board DL01) -----------------------------------------------------------------------

  describe('pay-with lanes', () => {
    const seals = (lane: HTMLElement) =>
      Array.from(lane.querySelectorAll<HTMLElement>('hk-wax-seal'));
    const arrow = (lane: HTMLElement, key: string) =>
      lane.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const confirmButton = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.castDialog.confirm,
      )!;

    it('are one radio group named "Pay with", the first lane chosen', () => {
      configure();
      open({
        ...BASE_DATA,
        availableSlots: [
          { level: 1, max: 2, used: 0 },
          { level: 2, max: 1, used: 0 },
        ],
      });
      TestBed.tick();

      const group = overlayRoot().querySelector('[role="radiogroup"]')!;
      expect(group.getAttribute('aria-label')).toBe(
        charactersEn.sheet.spellcasting.castDialog.payWith,
      );
      expect(lanes().map((l) => l.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    });

    it('the arrow keys move the choice with a roving tabindex, and the chosen lane pays', async () => {
      configure();
      const handle = open({
        ...BASE_DATA,
        availableSlots: [
          { level: 1, max: 2, used: 0 },
          { level: 2, max: 1, used: 0 },
          { level: 3, max: 1, used: 0 },
        ],
      });
      TestBed.tick();
      expect(lanes().map((l) => l.tabIndex)).toEqual([0, -1, -1]);

      arrow(lanes()[0], 'ArrowDown');
      TestBed.tick();
      expect(lanes().map((l) => l.getAttribute('aria-checked'))).toEqual([
        'false',
        'true',
        'false',
      ]);
      expect(lanes().map((l) => l.tabIndex)).toEqual([-1, 0, -1]);

      // Wraps: up from the second lane to the first, up again to the last.
      arrow(lanes()[1], 'ArrowUp');
      TestBed.tick();
      arrow(lanes()[0], 'ArrowUp');
      TestBed.tick();
      expect(lanes().map((l) => l.getAttribute('aria-checked'))).toEqual([
        'false',
        'false',
        'true',
      ]);

      confirmButton().click();
      expect(await handle.closed).toEqual({ level: 3 });
    });

    it('a slot lane shows one wax seal per slot: the left ones filled, the spent ones cooled', () => {
      configure();
      open({ ...BASE_DATA, availableSlots: [{ level: 1, max: 4, used: 1 }] });
      TestBed.tick();

      const [lane] = lanes();
      expect(lane.dataset['kind']).toBe('slot');
      expect(seals(lane)).toHaveLength(4);
      expect(seals(lane).map((s) => s.classList.contains('hk-wax-seal--spent'))).toEqual([
        false,
        false,
        false,
        true,
      ]);
      expect(lane.querySelector('.cast-dialog__lane-sub')?.textContent).toContain('3 of 4');
    });

    it('the pact slot is its own lane beside a regular slot of the same level, with its own seals', () => {
      configure();
      open({
        ...BASE_DATA,
        availableSlots: [
          { level: 3, max: 1, used: 0 },
          { level: 3, max: 2, used: 1, pact: true },
        ],
      });
      TestBed.tick();

      expect(lanes().map((l) => l.dataset['kind'])).toEqual(['slot', 'pact']);
      expect(seals(lanes()[1]).map((s) => s.classList.contains('hk-wax-seal--spent'))).toEqual([
        false,
        true,
      ]);
      // The two lanes are told apart by name even though both pay at level 3.
      expect(new Set(lanes().map(laneTitle)).size).toBe(2);
    });

    it('the free-cast lane names its resource and shows the resource pips, spending no slot', async () => {
      configure();
      const handle = open({
        ...BASE_DATA,
        availableSlots: [
          { level: 1, max: 3, used: 1, freeResource: 'favored-enemy', freeLabel: 'Favored Enemy' },
        ],
      });
      TestBed.tick();

      const [lane] = lanes();
      expect(lane.dataset['kind']).toBe('free');
      expect(laneTitle(lane)).toContain('Favored Enemy');
      expect(seals(lane)).toHaveLength(3);
      expect(seals(lane).filter((s) => s.classList.contains('hk-wax-seal--spent'))).toHaveLength(1);

      confirmButton().click();
      expect(await handle.closed).toEqual({ level: 1, freeResource: 'favored-enemy' });
    });

    it('a seal carries a name: "<lane>: available" or "<lane>: spent"', () => {
      configure();
      open({ ...BASE_DATA, availableSlots: [{ level: 1, max: 2, used: 1 }] });
      TestBed.tick();
      const names = seals(lanes()[0]).map((s) =>
        s.querySelector('svg')?.getAttribute('aria-label'),
      );
      const lane = laneTitle(lanes()[0]);
      expect(names).toEqual([
        charactersEn.sheet.spellcasting.castDialog.sealAvailable.replace('{lane}', lane),
        charactersEn.sheet.spellcasting.castDialog.sealSpent.replace('{lane}', lane),
      ]);
    });
  });

  describe('concentration warning', () => {
    it('is a note above the lanes naming the consequence, only when the cast would replace concentration', () => {
      configure();
      open({ ...BASE_DATA, spellConcentration: true, alreadyConcentrating: true });
      TestBed.tick();

      const warn = overlayRoot().querySelector('.cast-dialog__warn')!;
      expect(warn.getAttribute('role')).toBe('note');
      expect(warn.textContent).toContain(
        charactersEn.sheet.spellcasting.castDialog.replacesConcentration,
      );
      const group = overlayRoot().querySelector('[role="radiogroup"]')!;
      expect(warn.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('is absent otherwise', () => {
      configure();
      open({ ...BASE_DATA, spellConcentration: true, alreadyConcentrating: false });
      TestBed.tick();
      expect(overlayRoot().querySelector('.cast-dialog__warn')).toBeNull();
    });
  });

  it('is a parchment dialog: the title is the dialog name and the actions sit on the leather strap', async () => {
    configure();
    open(BASE_DATA);
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const dialog = overlayRoot().querySelector('hk-dialog')!;
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!)!;
    expect(title.textContent).toContain('Burning Hands');
    expect(overlayRoot().querySelector('[data-dialog-actions]')).not.toBeNull();
  });

  // --- Board DL01: the spell summary chips and the spent slot levels ------------------------------

  describe('spell summary chips', () => {
    const SUMMARY: CastDialogData['summary'] = {
      school: { kind: 'text', text: 'Abjuration' },
      castingTime: { kind: 'key', key: 'fact.unit.bonus', params: { value: 1 } },
      castingCondition: 'which you take after a hit',
      range: { kind: 'key', key: 'fact.unit.feet', params: { value: 60 } },
      components: { kind: 'text', text: 'V, S, M (a prayer scroll)' },
      duration: { kind: 'key', key: 'fact.unit.minute', params: { value: 10 } },
      ritual: false,
    };
    const chipTexts = () =>
      Array.from(overlayRoot().querySelectorAll('.cast-dialog__chips li')).map((li) =>
        li.textContent?.replace(/\s+/g, ' ').trim(),
      );
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      TestBed.tick();
    };

    it('shows level, school, casting time (with its condition), range, duration and components, units resolved', async () => {
      configure();
      open({ ...BASE_DATA, spellLevel: 1, summary: SUMMARY });
      TestBed.tick();
      await settle();

      const texts = chipTexts();
      expect(texts.some((t) => t?.endsWith('Level 1'))).toBe(true);
      expect(texts).toContain('Abjuration');
      expect(
        texts.some(
          (t) => t?.includes('1 bonus action') && t.includes('which you take after a hit'),
        ),
      ).toBe(true);
      expect(texts).toContain('60 feet');
      expect(texts).toContain('10 minutes');
      expect(texts).toContain('V, S, M (a prayer scroll)');
    });

    it('adds a Concentration chip for a concentration spell and a Ritual chip for a ritual one', async () => {
      configure();
      open({ ...BASE_DATA, spellConcentration: true, summary: { ...SUMMARY, ritual: true } });
      TestBed.tick();
      await settle();
      expect(chipTexts()).toContain(charactersEn.wizard.spells.concentration);
      expect(chipTexts()).toContain(charactersEn.wizard.spells.ritual);
    });

    it('names a cantrip as such, and shows no chips at all without a summary', async () => {
      configure();
      open({ ...BASE_DATA, spellLevel: 0, summary: SUMMARY });
      TestBed.tick();
      await settle();
      expect(chipTexts().some((t) => t?.endsWith('Cantrip'))).toBe(true);
      document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
      open(BASE_DATA);
      TestBed.tick();
      expect(overlayRoot().querySelector('.cast-dialog__chips')).toBeNull();
    });
  });

  describe('spent slot levels', () => {
    it('stay in the list as disabled lanes with every seal spent; the reason is in the tooltip and aria, not inline', () => {
      configure();
      open({
        ...BASE_DATA,
        availableSlots: [
          { level: 1, max: 2, used: 2, spent: true },
          { level: 2, max: 1, used: 0 },
        ],
      });
      TestBed.tick();

      const [spentLane, openLane] = lanes();
      const reason = charactersEn.sheet.spellcasting.castDialog.laneSpent.replace('{level}', '1');
      expect(spentLane.getAttribute('aria-disabled')).toBe('true');
      expect(spentLane.getAttribute('aria-description')).toBe(reason);
      expect(spentLane.textContent).not.toContain(reason);
      expect(
        Array.from(spentLane.querySelectorAll('hk-wax-seal')).every((s) =>
          s.classList.contains('hk-wax-seal--spent'),
        ),
      ).toBe(true);
      expect(openLane.getAttribute('aria-disabled')).toBeNull();
    });

    it('cannot be chosen, by click or arrow key, and the choice starts on the first lane that can pay', async () => {
      configure();
      const handle = open({
        ...BASE_DATA,
        availableSlots: [
          { level: 1, max: 2, used: 2, spent: true },
          { level: 2, max: 1, used: 0 },
          { level: 3, max: 1, used: 1, spent: true },
        ],
      });
      TestBed.tick();
      expect(lanes().map((l) => l.getAttribute('aria-checked'))).toEqual([
        'false',
        'true',
        'false',
      ]);

      lanes()[0].click();
      lanes()[2].click();
      lanes()[1].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      );
      TestBed.tick();
      expect(lanes().map((l) => l.getAttribute('aria-checked'))).toEqual([
        'false',
        'true',
        'false',
      ]);

      Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
        .find((b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.castDialog.confirm)!
        .click();
      expect(await handle.closed).toEqual({ level: 2 });
    });

    it('with only spent lanes, Cast is unavailable and the no-slots note shows', () => {
      configure();
      open({ ...BASE_DATA, availableSlots: [{ level: 1, max: 2, used: 2, spent: true }] });
      TestBed.tick();
      expect(lanes()).toHaveLength(1);
      expect(overlayRoot().textContent).toContain(
        charactersEn.sheet.spellcasting.castDialog.noSlots,
      );
      const cast = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === charactersEn.sheet.spellcasting.castDialog.confirm,
      )!;
      expect(cast.disabled).toBe(true);
    });
  });
});
