import { LiveAnnouncer } from '@angular/cdk/a11y';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { CampaignVisibility } from '@hk/protocol';
import { RollLogService } from '@shared/services/roll-log/roll-log.service';
import charactersEn from '../../../../../../assets/i18n/characters/en.json';
import { press } from '../../../../../ui/testing/harness';
import { overlayRoot } from '../../../../../ui/testing/overlay';
import { buttonNamed, setupLeafSpec } from '../play-spec-support';
import { PlayRollsService, type AdvantageMode } from '../play-rolls.service';
import { RollLogDrawerComponent } from './roll-log-drawer.component';

// The roll-log drawer (board D02) replaces the inline roll-log panel and the dialog that hosted it.
// The sheet's roll buttons read `PlayRollsService`, so the specs give the drawer a stand-in with
// the three signals it binds; the real service's own campaign gating is covered in
// `play-rolls.service.spec.ts`, which drives this drawer next to the real leaves.
const rollsStub = {
  advantageMode: signal<AdvantageMode>('normal'),
  rollVisibility: signal<CampaignVisibility>('everyone'),
  rollVisibilityOptions: signal<readonly CampaignVisibility[] | undefined>(undefined),
};

describe('RollLogDrawerComponent', () => {
  setupLeafSpec([], [{ provide: PlayRollsService, useValue: rollsStub }]);

  beforeEach(() => {
    rollsStub.advantageMode.set('normal');
    rollsStub.rollVisibility.set('everyone');
    rollsStub.rollVisibilityOptions.set(undefined);
  });

  /** Mounted in the document (the drawer's outside-press listener lives on it). */
  async function mount(open = true, opener?: HTMLElement) {
    const host = document.createElement('div');
    host.className = 'spec-host';
    document.body.append(host);
    const fixture: ComponentFixture<RollLogDrawerComponent> =
      TestBed.createComponent(RollLogDrawerComponent);
    host.append(fixture.nativeElement as HTMLElement);
    fixture.componentRef.setInput('open', open);
    if (opener) fixture.componentRef.setInput('opener', opener);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const addEntry = (name: string, total: number, sides = 20, value = total): void => {
    TestBed.inject(RollLogService).add({
      labelKey: 'sheet.roll.entries.check',
      params: { name },
      dice: [{ sides, value, kept: true }],
      modifier: 0,
      total,
    });
  };

  it('renders nothing while closed', async () => {
    const { el } = await mount(false);
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens as a dialog named Roll log, with the empty message and no Clear log', async () => {
    const { el } = await mount();
    const dialog = el.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toContain(
      charactersEn.sheet.roll.logTitle,
    );
    expect(el.textContent).toContain(charactersEn.sheet.roll.empty);
    expect(() => buttonNamed(el, charactersEn.sheet.roll.clear)).toThrow();
  });

  it('renders logged entries newest-first via hk-dice-result', async () => {
    const { fixture, el } = await mount();
    addEntry('Strength', 13, 20, 11);
    addEntry('Dexterity', 5, 20, 4);
    await fixture.whenStable();

    const totals = Array.from(el.querySelectorAll('.hk-dice-result__total')).map((n) =>
      n.textContent?.trim(),
    );
    // Newest first: the Dexterity roll (total 5) was added last.
    expect(totals).toEqual(['= 5', '= 13']);
    expect(el.textContent).not.toContain(charactersEn.sheet.roll.empty);
  });

  describe('advantage for the next roll', () => {
    it('is a radio group that defaults to Normal and is mutually exclusive', async () => {
      const { fixture, el } = await mount();
      const group = el.querySelector('[role="radiogroup"][aria-label]')!;
      expect(group.getAttribute('aria-label')).toBe(charactersEn.sheet.roll.advantageGroup);
      expect(
        buttonNamed(el, charactersEn.sheet.roll.advantage.normal).getAttribute('aria-checked'),
      ).toBe('true');

      buttonNamed(el, charactersEn.sheet.roll.advantage.advantage).click();
      await fixture.whenStable();

      expect(rollsStub.advantageMode()).toBe('adv');
      expect(
        buttonNamed(el, charactersEn.sheet.roll.advantage.advantage).getAttribute('aria-checked'),
      ).toBe('true');
      expect(
        buttonNamed(el, charactersEn.sheet.roll.advantage.normal).getAttribute('aria-checked'),
      ).toBe('false');

      buttonNamed(el, charactersEn.sheet.roll.advantage.disadvantage).click();
      await fixture.whenStable();
      expect(rollsStub.advantageMode()).toBe('dis');
    });

    it('shows the mode the sheet consumed: back to Normal once the service resets it', async () => {
      const { fixture, el } = await mount();
      rollsStub.advantageMode.set('adv');
      await fixture.whenStable();
      expect(
        buttonNamed(el, charactersEn.sheet.roll.advantage.advantage).getAttribute('aria-checked'),
      ).toBe('true');
      rollsStub.advantageMode.set('normal');
      await fixture.whenStable();
      expect(
        buttonNamed(el, charactersEn.sheet.roll.advantage.normal).getAttribute('aria-checked'),
      ).toBe('true');
    });

    it('tags a feed entry rolled with advantage', async () => {
      const { fixture, el } = await mount();
      TestBed.inject(RollLogService).add({
        labelKey: 'sheet.roll.entries.check',
        params: { name: 'Strength' },
        dice: [
          { sides: 20, value: 14, kept: true },
          { sides: 20, value: 9, kept: false },
        ],
        modifier: 2,
        total: 16,
        advantage: 'adv',
      });
      await fixture.whenStable();
      expect(el.querySelector('.roll-log-drawer__entry-tag')?.textContent?.trim()).toBe(
        charactersEn.sheet.roll.advantage.advantage,
      );
    });
  });

  // [plan-10 task-10-brief.md, ruling 5] The picker only renders when the sheet is linked to a
  // campaign with a live session; "solo behavior unchanged" otherwise.
  describe('who sees it (campaign visibility)', () => {
    it('renders no picker at all when the sheet is not linked (solo)', async () => {
      const { el } = await mount();
      expect(el.querySelector('.roll-log-drawer__visibility')).toBeNull();
    });

    it('renders exactly the given options, defaults to the bound value and is mutually exclusive', async () => {
      rollsStub.rollVisibilityOptions.set(['everyone', 'dm', 'private']);
      rollsStub.rollVisibility.set('dm');
      const { fixture, el } = await mount();

      const group = el.querySelector('.roll-log-drawer__visibility')!;
      expect(group.getAttribute('role')).toBe('radiogroup');
      expect(group.querySelectorAll('button')).toHaveLength(3);
      expect(
        buttonNamed(el, charactersEn.sheet.roll.visibility.dm).getAttribute('aria-checked'),
      ).toBe('true');
      expect(
        buttonNamed(el, charactersEn.sheet.roll.visibility.everyone).getAttribute('aria-checked'),
      ).toBe('false');

      buttonNamed(el, charactersEn.sheet.roll.visibility.private).click();
      await fixture.whenStable();

      expect(rollsStub.rollVisibility()).toBe('private');
      expect(
        buttonNamed(el, charactersEn.sheet.roll.visibility.private).getAttribute('aria-checked'),
      ).toBe('true');
      expect(
        buttonNamed(el, charactersEn.sheet.roll.visibility.dm).getAttribute('aria-checked'),
      ).toBe('false');
    });

    it('omits "Private" when allowPrivateRolls is false (only "everyone"/"dm" passed)', async () => {
      rollsStub.rollVisibilityOptions.set(['everyone', 'dm']);
      const { el } = await mount();
      const group = el.querySelector('.roll-log-drawer__visibility')!;
      expect(group.querySelectorAll('button')).toHaveLength(2);
      expect(
        Array.from(group.querySelectorAll('button')).some(
          (b) => b.textContent?.trim() === charactersEn.sheet.roll.visibility.private,
        ),
      ).toBe(false);
    });
  });

  describe('log a roll', () => {
    it('logs a flagged manual roll with the chosen type, clears the total and announces it', async () => {
      const { fixture, el } = await mount();
      const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');

      const total = el.querySelector<HTMLInputElement>(
        '.roll-log-drawer__manual input[type="number"]',
      )!;
      total.value = '17';
      total.dispatchEvent(new Event('input'));
      const kind = el.querySelector<HTMLSelectElement>('.roll-log-drawer__manual select')!;
      kind.value = 'save';
      kind.dispatchEvent(new Event('change'));
      await fixture.whenStable();

      buttonNamed(el, charactersEn.sheet.roll.manual.add).click();
      await fixture.whenStable();

      const entries = TestBed.inject(RollLogService).entries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        labelKey: 'sheet.roll.manual.labels.save',
        dice: [],
        total: 17,
        manual: true,
      });
      expect(announce).toHaveBeenCalledTimes(1);
      expect(
        el.querySelector<HTMLInputElement>('.roll-log-drawer__manual input[type="number"]')!.value,
      ).toBe('');
      expect(el.querySelector('.roll-log-drawer__entry-tag')?.textContent?.trim()).toBe(
        charactersEn.sheet.roll.manualTag,
      );
    });

    it('keeps Log roll unavailable until a total is entered', async () => {
      const { el } = await mount();
      const add = buttonNamed(el, charactersEn.sheet.roll.manual.add);
      expect(add.disabled || add.getAttribute('aria-disabled') === 'true').toBe(true);
    });
  });

  describe('clear log (behind a confirm)', () => {
    async function openClear() {
      const mounted = await mount();
      addEntry('Strength', 13, 20, 11);
      await mounted.fixture.whenStable();
      buttonNamed(mounted.el, charactersEn.sheet.roll.clear).click();
      TestBed.tick();
      return mounted;
    }

    it('asks first, and confirming empties the log and restores the empty message', async () => {
      const { fixture, el } = await openClear();
      const service = TestBed.inject(RollLogService);
      expect(service.entries()).toHaveLength(1);
      expect(overlayRoot().textContent).toContain(charactersEn.sheet.roll.clearConfirm.title);

      buttonNamed(overlayRoot(), charactersEn.sheet.roll.clearConfirm.confirm).click();
      await fixture.whenStable();

      expect(service.entries()).toHaveLength(0);
      expect(el.textContent).toContain(charactersEn.sheet.roll.empty);
    });

    it('cancelling keeps every roll', async () => {
      const { fixture } = await openClear();
      buttonNamed(overlayRoot(), charactersEn.sheet.roll.clearConfirm.cancel).click();
      await fixture.whenStable();
      expect(TestBed.inject(RollLogService).entries()).toHaveLength(1);
    });

    it('Escape closes only the confirm, then a second Escape closes the drawer', async () => {
      const { fixture, el } = await openClear();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await fixture.whenStable();
      expect(overlayRoot().textContent ?? '').not.toContain(
        charactersEn.sheet.roll.clearConfirm.title,
      );
      expect(el.querySelector('[role="dialog"]')).not.toBeNull();
      expect(TestBed.inject(RollLogService).entries()).toHaveLength(1);

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await fixture.whenStable();
      expect(el.querySelector('[role="dialog"]')).toBeNull();
    });

    it('a press on the confirm backdrop dismisses the confirm and leaves the drawer open', async () => {
      const { fixture, el } = await openClear();
      const backdrop = document.querySelector<HTMLElement>('.hk-overlay-backdrop')!;
      press(backdrop);
      await fixture.whenStable();
      expect(overlayRoot().textContent ?? '').not.toContain(
        charactersEn.sheet.roll.clearConfirm.title,
      );
      expect(el.querySelector('[role="dialog"]')).not.toBeNull();
    });
  });

  describe('closing', () => {
    it('Escape closes the drawer and returns focus to its opener', async () => {
      const opener = document.createElement('button');
      opener.className = 'spec-host';
      document.body.append(opener);
      opener.focus();
      const { fixture, el } = await mount(true, opener);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await fixture.whenStable();
      expect(el.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
    });

    it('a press outside closes it, a press inside keeps it', async () => {
      const outside = document.createElement('button');
      outside.className = 'spec-host';
      document.body.append(outside);
      const { fixture, el } = await mount();
      press(el.querySelector('.roll-log-drawer__manual')!);
      await fixture.whenStable();
      expect(el.querySelector('[role="dialog"]')).not.toBeNull();
      press(outside);
      await fixture.whenStable();
      expect(el.querySelector('[role="dialog"]')).toBeNull();
    });
  });
});
