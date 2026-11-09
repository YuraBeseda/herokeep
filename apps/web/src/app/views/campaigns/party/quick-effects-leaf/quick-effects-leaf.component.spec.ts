import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@app/ui/dialog/dialog.service';
import type { HpSnapshot } from '@shared/services/campaigns/dm-effects';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CampaignStore, type AckOrReject } from '@shared/stores/campaign.store';
import type { DraftEvent } from '@shared/stores/character.store';
import campaignsEn from '../../../../../assets/i18n/campaigns/en.json';
import { CampaignSelectionService } from '../../shell/campaign-selection.service';
import { QuickEffectsLeafComponent } from './quick-effects-leaf.component';
import { hintOf } from '../../../../ui/testing/harness';
import type { ConditionDialogResult } from '../../../characters/sheet/play/condition-dialog.component';

const CHARACTER_ID = '00000000-0000-4000-8000-0000000000c1';
const OK_RESULT: AckOrReject = { acked: [{ id: 'x', seq: 1 }], rejected: [] };

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
}

const CONDITION_INDEX = {
  system: () => ({ conditions: ['srd:condition.prone', 'srd:condition.exhaustion'] }),
  get: (id: string) => {
    if (id === 'srd:condition.exhaustion') return { type: 'condition', levels: 6 };
    if (id === 'srd:condition.prone') return { type: 'condition' };
    return undefined;
  },
  has: (id: string) => id === 'srd:condition.exhaustion' || id === 'srd:condition.prone',
};

const LOCALIZER = {
  name: (id: string) =>
    id === 'srd:condition.exhaustion' ? 'Exhaustion' : id === 'srd:condition.prone' ? 'Prone' : id,
};

@Component({
  selector: 'app-quick-effects-leaf-host',
  imports: [QuickEffectsLeafComponent],
  template: `
    <app-quick-effects-leaf
      [characterId]="characterId()"
      [name]="'Ilyana'"
      [hp]="hp()"
      [activeConditionIds]="activeConditionIds()"
      [canOpenSheet]="true"
      [canHandOver]="true"
      [canUnlink]="true"
      (closed)="closedCount = closedCount + 1"
      (openSheet)="openedSheet = openedSheet + 1"
      (handOver)="handedOver = handedOver + 1"
      (unlink)="unlinked = unlinked + 1"
    />
  `,
})
class HostComponent {
  closedCount = 0;
  openedSheet = 0;
  handedOver = 0;
  unlinked = 0;
  readonly characterId = signal(CHARACTER_ID);
  readonly hp = signal<HpSnapshot | undefined>({ current: 10, max: 20, temp: 2 });
  readonly activeConditionIds = signal<readonly string[]>([]);
}

function configure(options: {
  gatewayAppend?: ReturnType<typeof vi.fn>;
  xpMode?: 'xp' | 'milestone';
  dialogOpen?: ReturnType<typeof vi.fn>;
}): { gatewayAppend: ReturnType<typeof vi.fn>; dialogOpen: ReturnType<typeof vi.fn> } {
  const gatewayAppend = options.gatewayAppend ?? vi.fn().mockResolvedValue(OK_RESULT);
  const dialogOpen = options.dialogOpen ?? vi.fn();
  const state = signal({
    name: 'Test',
    system: 'srd-5e-2024',
    settings: {
      system: 'srd-5e-2024',
      packs: [],
      houseRules: {
        strictValidation: true,
        allowOverrides: true,
        editOutsideSession: 'free',
        xpMode: options.xpMode ?? 'xp',
        hpOnLevelUp: 'average',
        encumbrance: 'off',
        attunementMax: 3,
        startingLevel: 1,
      },
      visibility: { partySheets: 'full', rolls: 'everyone', allowPrivateRolls: true },
      join: { open: true, requireApproval: false },
    },
    members: new Map(),
    roster: new Map(),
    packs: new Map(),
    overviews: new Map(),
    session: { active: false },
    log: [],
    dmNotes: new Map(),
    archived: false,
  });

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
      { provide: CampaignStore, useValue: { state, gatewayAppend } },
      {
        provide: EngineFacade,
        useValue: { index: () => CONDITION_INDEX, localizer: () => LOCALIZER },
      },
      { provide: DialogService, useValue: { open: dialogOpen } },
    ],
  });

  return { gatewayAppend, dialogOpen };
}

async function whenStable(fixture: { whenStable(): Promise<unknown> }): Promise<void> {
  await fixture.whenStable();
  await fixture.whenStable();
}

/** Picks an effect tab, the way a click on its chip does. */
function pick(fixture: { detectChanges(): void }, compiled: HTMLElement, id: string): void {
  compiled.querySelector<HTMLButtonElement>(`[data-effect-tab="${id}"]`)!.click();
  fixture.detectChanges();
}

/** The input a label points at (`hk-text-field` / `hk-number-field` label their input by id). */
function inputOf(compiled: HTMLElement, labelText: string): HTMLInputElement {
  const label = Array.from(compiled.querySelectorAll('label')).find((l) =>
    l.textContent?.includes(labelText),
  )!;
  return compiled.querySelector<HTMLInputElement>(`#${label.htmlFor}`)!;
}

function setNumberField(compiled: HTMLElement, labelText: string, value: number): void {
  const input = inputOf(compiled, labelText);
  input.value = String(value);
  input.dispatchEvent(new Event('input'));
}

/** A form button by its label (tabs are not form buttons; a button's hidden reason is not its label). */
function buttonWithText(compiled: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(compiled.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) =>
      b.getAttribute('role') !== 'tab' &&
      (b.querySelector('.hk-button__label')?.textContent ?? b.textContent)?.trim() === text,
  );
}

function clickButtonWithText(compiled: HTMLElement, text: string): void {
  buttonWithText(compiled, text)!.click();
}

describe('QuickEffectsLeafComponent', () => {
  it('shows one effect form at a time: it starts on Damage, and a tab swaps the form', async () => {
    configure({});
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    const tabs = Array.from(compiled.querySelectorAll('[role="tab"]'));
    expect(tabs.map((t) => t.getAttribute('data-effect-tab'))).toEqual([
      'damage',
      'heal',
      'temp',
      'condition',
      'xp',
      'level',
      'item',
      'inspiration',
      'override',
    ]);
    expect(compiled.querySelector('[role="tabpanel"]')?.getAttribute('data-effect')).toBe('damage');
    expect(compiled.textContent).toContain(campaignsEn.dmEffects.hp.damageLabel);
    expect(compiled.textContent).not.toContain(campaignsEn.dmEffects.hp.healLabel);

    pick(fixture, compiled, 'heal');
    expect(compiled.querySelector('[role="tabpanel"]')?.getAttribute('data-effect')).toBe('heal');
    expect(compiled.textContent).toContain(campaignsEn.dmEffects.hp.healLabel);
    expect(compiled.textContent).not.toContain(campaignsEn.dmEffects.hp.damageLabel);
  });

  it('damage sends a gatewayAppend call with a clamped negative hp.changed delta', async () => {
    const { gatewayAppend } = configure({});
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    pick(fixture, compiled, 'damage');

    setNumberField(compiled, campaignsEn.dmEffects.hp.damageLabel, 3);
    fixture.detectChanges();
    clickButtonWithText(compiled, campaignsEn.dmEffects.hp.damage);
    await whenStable(fixture);

    expect(gatewayAppend).toHaveBeenCalledWith(CHARACTER_ID, [
      { type: 'hp.changed', v: 1, payload: { delta: -3, kind: 'damage' } },
    ]);
  });

  it('heal sends a clamped positive delta', async () => {
    const { gatewayAppend } = configure({});
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    pick(fixture, compiled, 'heal');

    setNumberField(compiled, campaignsEn.dmEffects.hp.healLabel, 50);
    fixture.detectChanges();
    clickButtonWithText(compiled, campaignsEn.dmEffects.hp.heal);
    await whenStable(fixture);

    // hp = {current: 10, max: 20, temp: 2} -> headroom 10, clamped
    expect(gatewayAppend).toHaveBeenCalledWith(CHARACTER_ID, [
      { type: 'hp.changed', v: 1, payload: { delta: 10, kind: 'heal' } },
    ]);
  });

  it('add temp HP sends hp.changed{kind:temp}', async () => {
    const { gatewayAppend } = configure({});
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    pick(fixture, compiled, 'temp');

    setNumberField(compiled, campaignsEn.dmEffects.hp.tempLabel, 4);
    fixture.detectChanges();
    clickButtonWithText(compiled, campaignsEn.dmEffects.hp.addTemp);
    await whenStable(fixture);

    expect(gatewayAppend).toHaveBeenCalledWith(CHARACTER_ID, [
      { type: 'hp.changed', v: 1, payload: { delta: 4, kind: 'temp' } },
    ]);
  });

  it('shows a "no baseline" hint and disables HP buttons when hp is undefined', async () => {
    configure({});
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.hp.set(undefined);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    pick(fixture, compiled, 'damage');

    expect(compiled.textContent).toContain(campaignsEn.dmEffects.hp.noBaseline);
    const damageButton = buttonWithText(compiled, campaignsEn.dmEffects.hp.damage);
    expect(damageButton!.getAttribute('aria-disabled')).toBe('true');
  });

  it('inspiration grant/revoke send inspiration.changed{value}', async () => {
    const { gatewayAppend } = configure({});
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    pick(fixture, compiled, 'inspiration');

    clickButtonWithText(compiled, campaignsEn.dmEffects.inspiration.grant);
    await whenStable(fixture);
    expect(gatewayAppend).toHaveBeenCalledWith(CHARACTER_ID, [
      { type: 'inspiration.changed', v: 1, payload: { value: true } },
    ]);

    clickButtonWithText(compiled, campaignsEn.dmEffects.inspiration.revoke);
    await whenStable(fixture);
    expect(gatewayAppend).toHaveBeenCalledWith(CHARACTER_ID, [
      { type: 'inspiration.changed', v: 1, payload: { value: false } },
    ]);
  });

  it('add condition opens the shared ConditionDialogComponent and sends condition.added on a result', async () => {
    const dialogOpen = vi.fn().mockReturnValue({
      closed: Promise.resolve({
        conditionId: 'srd:condition.exhaustion',
        level: 2,
      } satisfies ConditionDialogResult),
    });
    const { gatewayAppend } = configure({ dialogOpen });
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    pick(fixture, compiled, 'condition');

    clickButtonWithText(compiled, campaignsEn.dmEffects.conditions.add);
    await whenStable(fixture);

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(gatewayAppend).toHaveBeenCalledWith(CHARACTER_ID, [
      {
        type: 'condition.added',
        v: 1,
        payload: { conditionId: 'srd:condition.exhaustion', level: 2 },
      },
    ]);
  });

  it('remove condition (chip) sends condition.removed', async () => {
    const { gatewayAppend } = configure({});
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.activeConditionIds.set(['srd:condition.prone']);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    pick(fixture, compiled, 'condition');

    compiled.querySelector<HTMLElement>('.qfx__cond-remove')!.click();
    await whenStable(fixture);

    expect(gatewayAppend).toHaveBeenCalledWith(CHARACTER_ID, [
      { type: 'condition.removed', v: 1, payload: { conditionId: 'srd:condition.prone' } },
    ]);
  });

  it('xpMode "xp" shows the XP grant control (not level), and sends xp.awarded', async () => {
    const { gatewayAppend } = configure({ xpMode: 'xp' });
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    pick(fixture, compiled, 'xp');

    expect(compiled.textContent).toContain(campaignsEn.dmEffects.xp.grant);
    expect(compiled.textContent).not.toContain(campaignsEn.dmEffects.level.grant);

    setNumberField(compiled, campaignsEn.dmEffects.xp.amountLabel, 200);
    fixture.detectChanges();
    clickButtonWithText(compiled, campaignsEn.dmEffects.xp.grant);
    await whenStable(fixture);

    expect(gatewayAppend).toHaveBeenCalledWith(CHARACTER_ID, [
      { type: 'xp.awarded', v: 1, payload: { amount: 200 } },
    ]);
  });

  it('xpMode "milestone" shows the level grant control (not XP), and sends level.granted', async () => {
    const { gatewayAppend } = configure({ xpMode: 'milestone' });
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    pick(fixture, compiled, 'level');

    expect(compiled.textContent).toContain(campaignsEn.dmEffects.level.grant);
    expect(compiled.textContent).not.toContain(campaignsEn.dmEffects.xp.grant);

    clickButtonWithText(compiled, campaignsEn.dmEffects.level.grant);
    await whenStable(fixture);

    expect(gatewayAppend).toHaveBeenCalledWith(CHARACTER_ID, [
      { type: 'level.granted', v: 1, payload: { count: 1 } },
    ]);
  });

  it('item grant sends item.added with a generated instanceId, qty, and name', async () => {
    const { gatewayAppend } = configure({});
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    pick(fixture, compiled, 'item');

    const nameInput = inputOf(compiled, campaignsEn.dmEffects.item.nameLabel);
    nameInput.value = 'Potion of Healing';
    nameInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    setNumberField(compiled, campaignsEn.dmEffects.item.qtyLabel, 2);
    fixture.detectChanges();
    clickButtonWithText(compiled, campaignsEn.dmEffects.item.grant);
    await whenStable(fixture);

    expect(gatewayAppend).toHaveBeenCalledTimes(1);
    const drafts = gatewayAppend.mock.calls[0][1] as DraftEvent[];
    expect(drafts).toHaveLength(1);
    expect(drafts[0].type).toBe('item.added');
    const payload = drafts[0].payload as { instanceId: string; qty: number; name?: string };
    expect(typeof payload.instanceId).toBe('string');
    expect(payload.instanceId.length).toBeGreaterThan(0);
    expect(payload.qty).toBe(2);
    expect(payload.name).toBe('Potion of Healing');
  });

  it('override apply is disabled without BOTH a path and a reason, and sends override.applied with a JSON-parsed value', async () => {
    const { gatewayAppend } = configure({});
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    pick(fixture, compiled, 'override');

    const applyButton = buttonWithText(compiled, campaignsEn.dmEffects.override.apply)!;
    expect(applyButton.getAttribute('aria-disabled')).toBe('true');

    const setInput = (labelText: string, value: string): void => {
      const input = inputOf(compiled, labelText);
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    setInput(campaignsEn.dmEffects.override.pathLabel, 'ac');
    fixture.detectChanges();
    expect(applyButton.getAttribute('aria-disabled')).toBe('true'); // reason still empty

    setInput(campaignsEn.dmEffects.override.valueLabel, '18');
    setInput(campaignsEn.dmEffects.override.reasonLabel, 'story reward');
    fixture.detectChanges();
    expect(applyButton.getAttribute('aria-disabled')).toBeNull();

    applyButton.click();
    await whenStable(fixture);

    expect(gatewayAppend).toHaveBeenCalledWith(CHARACTER_ID, [
      {
        type: 'override.applied',
        v: 1,
        payload: { path: 'ac', value: 18, reason: 'story reward' },
      },
    ]);
  });

  it('shows inline failure feedback (in addition to the generic toast channel) on a reject', async () => {
    const gatewayAppend = vi.fn().mockResolvedValue({
      acked: [],
      rejected: [{ id: 'x', code: 'forbidden', message: 'not allowed' }],
    } satisfies AckOrReject);
    configure({ gatewayAppend });
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    pick(fixture, compiled, 'inspiration');

    clickButtonWithText(compiled, campaignsEn.dmEffects.inspiration.grant);
    await whenStable(fixture);

    expect(compiled.textContent).toContain(campaignsEn.dmEffects.status.failed);
    expect(compiled.textContent).toContain('not allowed');
  });

  it('shows inline success feedback on an ack', async () => {
    configure({});
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    pick(fixture, compiled, 'inspiration');

    clickButtonWithText(compiled, campaignsEn.dmEffects.inspiration.grant);
    await whenStable(fixture);

    expect(compiled.textContent).toContain(campaignsEn.dmEffects.status.applied);
  });

  // Fix round 1 (Important): a server ACK does not mean the reducer's effect actually applied —
  // `hp.changed{damage|heal}` silently skips as 'hp-unresolved' while the target's HP is still the
  // long-rest 'max' sentinel, which 'overview' mode (no `currentWasMax` field at all in
  // `PartyOverviewUpdatedV1`) can never detect. The ack feedback must say so instead of the plain
  // "Applied." — full mode (a live Sheet, `currentWasMax` a real boolean) keeps the plain message.
  describe('fix round 1: honest overview-mode damage/heal feedback', () => {
    it('overview mode (hp.currentWasMax undefined) damage ack shows the CAVEATED message, not the plain one', async () => {
      const { gatewayAppend } = configure({});
      const fixture = TestBed.createComponent(HostComponent);
      // HostComponent's default hp has no `currentWasMax` key at all — genuine overview mode.
      await whenStable(fixture);
      const compiled = fixture.nativeElement as HTMLElement;
      pick(fixture, compiled, 'damage');

      setNumberField(compiled, campaignsEn.dmEffects.hp.damageLabel, 1);
      fixture.detectChanges();
      clickButtonWithText(compiled, campaignsEn.dmEffects.hp.damage);
      await whenStable(fixture);

      expect(gatewayAppend).toHaveBeenCalled();
      expect(compiled.textContent).toContain(campaignsEn.dmEffects.status.appliedCaveat);
      expect(compiled.textContent).not.toContain(campaignsEn.dmEffects.status.applied);
    });

    it('overview mode heal ack ALSO shows the caveated message', async () => {
      configure({});
      const fixture = TestBed.createComponent(HostComponent);
      await whenStable(fixture);
      const compiled = fixture.nativeElement as HTMLElement;
      pick(fixture, compiled, 'heal');

      setNumberField(compiled, campaignsEn.dmEffects.hp.healLabel, 1);
      fixture.detectChanges();
      clickButtonWithText(compiled, campaignsEn.dmEffects.hp.heal);
      await whenStable(fixture);

      expect(compiled.textContent).toContain(campaignsEn.dmEffects.status.appliedCaveat);
      expect(compiled.textContent).not.toContain(campaignsEn.dmEffects.status.applied);
    });

    it('full mode (hp.currentWasMax a real boolean, from a live Sheet) damage ack shows the PLAIN message', async () => {
      configure({});
      const fixture = TestBed.createComponent(HostComponent);
      fixture.componentInstance.hp.set({ current: 10, max: 20, temp: 2, currentWasMax: false });
      await whenStable(fixture);
      const compiled = fixture.nativeElement as HTMLElement;
      pick(fixture, compiled, 'damage');

      setNumberField(compiled, campaignsEn.dmEffects.hp.damageLabel, 1);
      fixture.detectChanges();
      clickButtonWithText(compiled, campaignsEn.dmEffects.hp.damage);
      await whenStable(fixture);

      expect(compiled.textContent).toContain(campaignsEn.dmEffects.status.applied);
      expect(compiled.textContent).not.toContain(campaignsEn.dmEffects.status.appliedCaveat);
    });

    it('a REJECTED damage in overview mode still shows the plain "failed" message (the caveat is about a misleading SUCCESS, not failure)', async () => {
      const gatewayAppend = vi.fn().mockResolvedValue({
        acked: [],
        rejected: [{ id: 'x', code: 'forbidden' }],
      } satisfies AckOrReject);
      configure({ gatewayAppend });
      const fixture = TestBed.createComponent(HostComponent);
      await whenStable(fixture);
      const compiled = fixture.nativeElement as HTMLElement;
      pick(fixture, compiled, 'damage');

      setNumberField(compiled, campaignsEn.dmEffects.hp.damageLabel, 1);
      fixture.detectChanges();
      clickButtonWithText(compiled, campaignsEn.dmEffects.hp.damage);
      await whenStable(fixture);

      expect(compiled.textContent).toContain(campaignsEn.dmEffects.status.failed);
      expect(compiled.textContent).not.toContain(campaignsEn.dmEffects.status.appliedCaveat);
    });

    it('a non-HP action (inspiration) always shows the plain message, even with no currentWasMax info at all', async () => {
      configure({});
      const fixture = TestBed.createComponent(HostComponent);
      // Default hp has no currentWasMax — same "unknown sentinel" shape as overview mode — but
      // inspiration has no sentinel concept, so it must never be caveated.
      await whenStable(fixture);
      const compiled = fixture.nativeElement as HTMLElement;
      pick(fixture, compiled, 'inspiration');

      clickButtonWithText(compiled, campaignsEn.dmEffects.inspiration.grant);
      await whenStable(fixture);

      expect(compiled.textContent).toContain(campaignsEn.dmEffects.status.applied);
      expect(compiled.textContent).not.toContain(campaignsEn.dmEffects.status.appliedCaveat);
    });
  });

  describe('strap commands for the selected member', () => {
    const select = (id = CHARACTER_ID) =>
      TestBed.inject(CampaignSelectionService).select({ characterId: id, name: 'Ilyana' });

    it('shows the damage form and focuses its field when the strap asks for damage on this member', async () => {
      configure({});
      const fixture = TestBed.createComponent(HostComponent);
      await whenStable(fixture);
      const compiled = fixture.nativeElement as HTMLElement;
      pick(fixture, compiled, 'temp');
      expect(compiled.querySelector('[role="tabpanel"]')?.getAttribute('data-effect')).toBe('temp');
      select();
      TestBed.inject(CampaignSelectionService).requestEffect('damage');
      await whenStable(fixture);
      fixture.detectChanges();
      await whenStable(fixture);

      expect(compiled.querySelector('[role="tabpanel"]')?.getAttribute('data-effect')).toBe(
        'damage',
      );
      const focused = document.activeElement as HTMLElement;
      expect(compiled.querySelector('[data-effect="damage"]')?.contains(focused)).toBe(true);
    });

    it('opens the condition picker when the strap asks for a condition on this member', async () => {
      const { dialogOpen } = configure({
        dialogOpen: vi.fn().mockReturnValue({ closed: Promise.resolve(undefined) }),
      });
      const fixture = TestBed.createComponent(HostComponent);
      await whenStable(fixture);
      select();
      TestBed.inject(CampaignSelectionService).requestEffect('condition');
      await whenStable(fixture);
      expect(dialogOpen).toHaveBeenCalledOnce();
    });

    it('leaves a command addressed to another member on the board', async () => {
      const { dialogOpen } = configure({});
      const fixture = TestBed.createComponent(HostComponent);
      await whenStable(fixture);
      const compiled = fixture.nativeElement as HTMLElement;
      select('someone-else');
      TestBed.inject(CampaignSelectionService).requestEffect('condition');
      await whenStable(fixture);
      expect(dialogOpen).not.toHaveBeenCalled();
      expect(compiled.querySelector('[role="tabpanel"]')?.getAttribute('data-effect')).toBe(
        'damage',
      );
      // Not this leaf's request: it stays on the board for the leaf it addresses.
      expect(TestBed.inject(CampaignSelectionService).request()).not.toBeNull();
    });

    it('never replays a request that was already handled when another leaf mounts later', async () => {
      const { dialogOpen } = configure({
        dialogOpen: vi.fn().mockReturnValue({ closed: Promise.resolve(undefined) }),
      });
      const first = TestBed.createComponent(HostComponent);
      await whenStable(first);
      select();
      TestBed.inject(CampaignSelectionService).requestEffect('condition');
      await whenStable(first);
      expect(dialogOpen).toHaveBeenCalledOnce();
      first.destroy();
      const second = TestBed.createComponent(HostComponent);
      await whenStable(second);
      expect(dialogOpen).toHaveBeenCalledOnce();
      expect(TestBed.inject(CampaignSelectionService).request()).toBeNull();
    });
  });

  describe('XP and Level follow the campaign xpMode', () => {
    it('in XP mode the Level tab is off with its reason as the hint, and clicking it changes nothing', async () => {
      configure({ xpMode: 'xp' });
      const fixture = TestBed.createComponent(HostComponent);
      await whenStable(fixture);
      const compiled = fixture.nativeElement as HTMLElement;
      const level = compiled.querySelector<HTMLElement>('[data-effect-tab="level"]')!;
      const xp = compiled.querySelector<HTMLElement>('[data-effect-tab="xp"]')!;

      expect(level.getAttribute('aria-disabled')).toBe('true');
      expect(hintOf(level)).toBe(campaignsEn.dmEffects.tabs.levelOff);
      expect(xp.getAttribute('aria-disabled')).toBeNull();
      level.click();
      fixture.detectChanges();
      expect(compiled.querySelector('[role="tabpanel"]')?.getAttribute('data-effect')).toBe(
        'damage',
      );
    });

    it('in milestone mode the XP tab is off with its reason, and the strap XP lands on Level', async () => {
      configure({ xpMode: 'milestone' });
      const fixture = TestBed.createComponent(HostComponent);
      await whenStable(fixture);
      const compiled = fixture.nativeElement as HTMLElement;
      const xp = compiled.querySelector<HTMLElement>('[data-effect-tab="xp"]')!;
      expect(xp.getAttribute('aria-disabled')).toBe('true');
      expect(hintOf(xp)).toBe(campaignsEn.dmEffects.tabs.xpOff);

      const selection = TestBed.inject(CampaignSelectionService);
      selection.select({ characterId: CHARACTER_ID, name: 'Ilyana' });
      selection.requestEffect('xp');
      await whenStable(fixture);
      fixture.detectChanges();
      expect(compiled.querySelector('[role="tabpanel"]')?.getAttribute('data-effect')).toBe(
        'level',
      );
    });
  });

  describe('the leaf chrome', () => {
    it('names the member, closes from its button and from Escape, and offers the footer actions', async () => {
      configure({});
      const fixture = TestBed.createComponent(HostComponent);
      await whenStable(fixture);
      const compiled = fixture.nativeElement as HTMLElement;
      const host = fixture.componentInstance;

      expect(compiled.querySelector('.hk-leaf__title-text')?.textContent?.trim()).toBe('Ilyana');
      expect(compiled.textContent).toContain('Quick effects · 10 / 20 HP');
      compiled.querySelector<HTMLButtonElement>('.qfx__close')!.click();
      expect(host.closedCount).toBe(1);
      compiled
        .querySelector('.qfx')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(host.closedCount).toBe(2);

      compiled.querySelector<HTMLButtonElement>('.qfx__open-sheet')!.click();
      compiled.querySelector<HTMLButtonElement>('.qfx__handover')!.click();
      compiled.querySelector<HTMLButtonElement>('.qfx__unlink')!.click();
      expect([host.openedSheet, host.handedOver, host.unlinked]).toEqual([1, 1, 1]);
    });

    it('moves between the tabs with the arrow keys, Home and End', async () => {
      configure({});
      const fixture = TestBed.createComponent(HostComponent);
      await whenStable(fixture);
      const compiled = fixture.nativeElement as HTMLElement;
      // The key goes to the focused tab, the way the browser delivers it.
      const key = (name: string): void => {
        compiled
          .querySelector('[role="tab"][aria-selected="true"]')!
          .dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
        fixture.detectChanges();
      };
      const current = (): string | null | undefined =>
        compiled.querySelector('[role="tabpanel"]')?.getAttribute('data-effect');

      key('ArrowRight');
      expect(current()).toBe('heal');
      key('End');
      expect(current()).toBe('override');
      key('ArrowRight');
      expect(current()).toBe('damage');
      key('ArrowLeft');
      expect(current()).toBe('override');
    });

    it('skips the off tab when moving along the row', async () => {
      configure({ xpMode: 'xp' });
      const fixture = TestBed.createComponent(HostComponent);
      await whenStable(fixture);
      const compiled = fixture.nativeElement as HTMLElement;
      pick(fixture, compiled, 'xp');
      compiled
        .querySelector('[role="tab"][aria-selected="true"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      fixture.detectChanges();
      expect(compiled.querySelector('[role="tabpanel"]')?.getAttribute('data-effect')).toBe('item');
    });

    it('the strap condition request switches to the Condition tab and opens the picker', async () => {
      const { dialogOpen } = configure({
        dialogOpen: vi.fn().mockReturnValue({ closed: Promise.resolve(undefined) }),
      });
      const fixture = TestBed.createComponent(HostComponent);
      await whenStable(fixture);
      const compiled = fixture.nativeElement as HTMLElement;
      const selection = TestBed.inject(CampaignSelectionService);
      selection.select({ characterId: CHARACTER_ID, name: 'Ilyana' });
      selection.requestEffect('condition');
      await whenStable(fixture);
      fixture.detectChanges();
      expect(dialogOpen).toHaveBeenCalledOnce();
      expect(compiled.querySelector('[role="tabpanel"]')?.getAttribute('data-effect')).toBe(
        'condition',
      );
    });
  });
});
