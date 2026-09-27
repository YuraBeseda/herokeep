import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { DialogService } from '@shared/components/dialog/dialog.service';
import type { HpSnapshot } from '@shared/services/campaigns/dm-effects';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CampaignStore, type AckOrReject } from '@shared/stores/campaign.store';
import type { DraftEvent } from '@shared/stores/character.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { DmEffectsPanelComponent } from './dm-effects-panel.component';
import type { ConditionDialogResult } from '../../characters/sheet/play/condition-dialog.component';

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
  selector: 'app-dm-effects-panel-host',
  imports: [DmEffectsPanelComponent],
  template: `
    <app-dm-effects-panel
      [characterId]="characterId()"
      [hp]="hp()"
      [activeConditionIds]="activeConditionIds()"
    />
  `,
})
class HostComponent {
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

function expand(compiled: HTMLElement): void {
  compiled.querySelector<HTMLButtonElement>('.dm-effects-panel__toggle')!.click();
}

function setNumberField(compiled: HTMLElement, labelText: string, value: number): void {
  const labels = Array.from(compiled.querySelectorAll('label'));
  const label = labels.find((l) => l.textContent?.includes(labelText))!;
  const input = label.querySelector<HTMLInputElement>('input')!;
  input.value = String(value);
  input.dispatchEvent(new Event('input'));
}

function clickButtonWithText(compiled: HTMLElement, text: string): void {
  const buttons = Array.from(compiled.querySelectorAll<HTMLButtonElement>('button'));
  const button = buttons.find((b) => b.textContent?.trim() === text);
  button!.click();
}

describe('DmEffectsPanelComponent', () => {
  it('starts collapsed; the toggle expands the body', async () => {
    configure({});
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.dm-effects-panel__body')).toBeNull();
    expand(compiled);
    fixture.detectChanges();

    expect(compiled.querySelector('.dm-effects-panel__body')).toBeTruthy();
  });

  it('damage sends a gatewayAppend call with a clamped negative hp.changed delta', async () => {
    const { gatewayAppend } = configure({});
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    expand(compiled);
    fixture.detectChanges();

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
    expand(compiled);
    fixture.detectChanges();

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
    expand(compiled);
    fixture.detectChanges();

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
    expand(compiled);
    fixture.detectChanges();

    expect(compiled.textContent).toContain(campaignsEn.dmEffects.hp.noBaseline);
    const damageButton = Array.from(compiled.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === campaignsEn.dmEffects.hp.damage,
    );
    expect(damageButton!.disabled).toBe(true);
  });

  it('inspiration grant/revoke send inspiration.changed{value}', async () => {
    const { gatewayAppend } = configure({});
    const fixture = TestBed.createComponent(HostComponent);
    await whenStable(fixture);
    const compiled = fixture.nativeElement as HTMLElement;
    expand(compiled);
    fixture.detectChanges();

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
    expand(compiled);
    fixture.detectChanges();

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
    expand(compiled);
    fixture.detectChanges();

    compiled.querySelector<HTMLElement>('[hk-chip-remove]')!.click();
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
    expand(compiled);
    fixture.detectChanges();

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
    expand(compiled);
    fixture.detectChanges();

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
    expand(compiled);
    fixture.detectChanges();

    const nameLabel = Array.from(compiled.querySelectorAll('label')).find((l) =>
      l.textContent?.includes(campaignsEn.dmEffects.item.nameLabel),
    )!;
    const nameInput = nameLabel.querySelector<HTMLInputElement>('input')!;
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
    expand(compiled);
    fixture.detectChanges();

    const applyButton = Array.from(compiled.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === campaignsEn.dmEffects.override.apply,
    )!;
    expect(applyButton.disabled).toBe(true);

    const setInput = (labelText: string, value: string): void => {
      const label = Array.from(compiled.querySelectorAll('label')).find((l) =>
        l.textContent?.includes(labelText),
      )!;
      const input = label.querySelector<HTMLInputElement>('input')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    setInput(campaignsEn.dmEffects.override.pathLabel, 'ac');
    fixture.detectChanges();
    expect(applyButton.disabled).toBe(true); // reason still empty

    setInput(campaignsEn.dmEffects.override.valueLabel, '18');
    setInput(campaignsEn.dmEffects.override.reasonLabel, 'story reward');
    fixture.detectChanges();
    expect(applyButton.disabled).toBe(false);

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
    expand(compiled);
    fixture.detectChanges();

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
    expand(compiled);
    fixture.detectChanges();

    clickButtonWithText(compiled, campaignsEn.dmEffects.inspiration.grant);
    await whenStable(fixture);

    expect(compiled.textContent).toContain(campaignsEn.dmEffects.status.applied);
  });
});
