import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import type { MembershipRole } from '@hk/protocol';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import type { CampaignState } from '@shared/services/campaigns/campaign-projection';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { HkDb, type CampaignRow } from '@shared/services/storage/dexie.db';
import { LeaderService } from '@shared/services/storage/leader.service';
import { SyncService } from '@shared/services/sync/sync.service';
import { CampaignStore } from '@shared/stores/campaign.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { LobbyComponent } from './lobby.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'campaigns/en') return of(campaignsEn);
    return of({});
  }
}

type FetchHandler = (init?: RequestInit) => Response | Promise<Response>;

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}

function routedFetch(routes: Record<string, FetchHandler>): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = requestUrl(input);
    const key = Object.keys(routes).find((k) => url === k);
    if (!key) throw new Error(`routedFetch: no handler declared for ${url}`);
    return routes[key](init);
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function noBodyResponse(status: number): Response {
  return new Response(null, { status });
}

function mkState(overrides: Partial<CampaignState> = {}): Partial<CampaignState> {
  return {
    name: 'Curse of Strahd',
    system: 'srd-5e-2024',
    joinCode: '7QX4M2HN',
    members: new Map<string, { displayName: string; role: MembershipRole; removed: boolean }>([
      ['u-dm', { displayName: 'Alice', role: 'dm', removed: false }],
      ['u-player', { displayName: 'Bob', role: 'player', removed: false }],
    ]),
    ...overrides,
  };
}

const CAMPAIGN_ID = '00000000-0000-4000-8000-000000000001';

function configure(options: {
  role?: MembershipRole;
  isLeader?: boolean;
  state?: Partial<CampaignState>;
  members?: { userId: string; displayName: string; role: string; online: boolean }[] | null;
}): {
  dialogOpen: ReturnType<typeof vi.fn>;
  toastShow: ReturnType<typeof vi.fn>;
  clipboardWrite: ReturnType<typeof vi.fn>;
} {
  const dialogOpen = vi.fn().mockReturnValue({ closed: Promise.resolve(true) });
  const toastShow = vi.fn();
  const clipboardWrite = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText: clipboardWrite } });

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
      {
        provide: CampaignStore,
        useValue: {
          state: signal(options.state ?? mkState()),
          role: signal(options.role ?? 'dm'),
          campaignId: signal(CAMPAIGN_ID),
        },
      },
      { provide: LeaderService, useValue: { isLeader: signal(options.isLeader ?? true) } },
      {
        provide: SyncService,
        useValue: {
          membersFor: () => signal(options.members === undefined ? null : options.members),
        },
      },
      { provide: DialogService, useValue: { open: dialogOpen } },
      { provide: ToastService, useValue: { show: toastShow } },
    ],
  });

  return { dialogOpen, toastShow, clipboardWrite };
}

describe('LobbyComponent', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    TestBed.inject(HkDb).close();
  });

  it('shows the grouped join code, copy-link and rotate actions for the DM', async () => {
    configure({ role: 'dm' });
    const fixture = TestBed.createComponent(LobbyComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.lobby__code')?.textContent?.trim()).toBe('7QX4-M2HN');
    expect(compiled.querySelector('.lobby__copy-link')).not.toBeNull();
    expect(compiled.querySelector('.lobby__rotate')).not.toBeNull();
  });

  it('hides the join-code section entirely for a player (never shown the DM-only code)', async () => {
    configure({ role: 'player' });
    const fixture = TestBed.createComponent(LobbyComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.lobby__join-code')).toBeNull();
  });

  it('renders the QR as an inline <svg> for the DM (real qrcode-generator import, no mocking)', async () => {
    configure({ role: 'dm' });
    const fixture = TestBed.createComponent(LobbyComponent);
    await fixture.whenStable();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.lobby__qr svg')).not.toBeNull();
  });

  it('merges state.members with the LIVE membersFor() presence — online dot + displayName preference', async () => {
    configure({
      role: 'dm',
      members: [
        { userId: 'u-dm', displayName: 'Alice (live)', role: 'dm', online: true },
        { userId: 'u-player', displayName: 'Bob', role: 'member', online: false },
      ],
    });
    const fixture = TestBed.createComponent(LobbyComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const rows = compiled.querySelectorAll('.lobby__member-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.lobby__member-name')?.textContent?.trim()).toBe('Alice (live)');
    expect(rows[0].querySelector('.lobby__member-dot')?.getAttribute('data-online')).toBe('true');
    expect(rows[1].querySelector('.lobby__member-dot')?.getAttribute('data-online')).toBe('false');
  });

  it('falls back to state.displayName and offline when no live presence frame has arrived', async () => {
    configure({ role: 'dm', members: null });
    const fixture = TestBed.createComponent(LobbyComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const rows = compiled.querySelectorAll('.lobby__member-row');
    expect(rows[0].querySelector('.lobby__member-name')?.textContent?.trim()).toBe('Alice');
    expect(rows[0].querySelector('.lobby__member-dot')?.getAttribute('data-online')).toBe('false');
  });

  it('shows a removed member struck through with a badge, NOT hidden, and no remove button', async () => {
    configure({
      role: 'dm',
      state: mkState({
        members: new Map([
          ['u-dm', { displayName: 'Alice', role: 'dm' as MembershipRole, removed: false }],
          ['u-gone', { displayName: 'Carol', role: 'player' as MembershipRole, removed: true }],
        ]),
      }),
    });
    const fixture = TestBed.createComponent(LobbyComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const goneRow = compiled.querySelector('[data-user-id="u-gone"]')!;
    expect(goneRow.getAttribute('data-removed')).toBe('true');
    expect(goneRow.querySelector('.lobby__member-removed-badge')?.textContent?.trim()).toBe(
      campaignsEn.lobby.members.removedBadge,
    );
    expect(goneRow.querySelector('.lobby__member-remove')).toBeNull();
  });

  it("never shows a remove button for the DM's own row", async () => {
    configure({ role: 'dm' });
    const fixture = TestBed.createComponent(LobbyComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const dmRow = compiled.querySelector('[data-user-id="u-dm"]')!;
    expect(dmRow.querySelector('.lobby__member-remove')).toBeNull();
    const playerRow = compiled.querySelector('[data-user-id="u-player"]')!;
    expect(playerRow.querySelector('.lobby__member-remove')).not.toBeNull();
  });

  it('hides remove buttons entirely on a non-leader tab, even for the DM', async () => {
    configure({ role: 'dm', isLeader: false });
    const fixture = TestBed.createComponent(LobbyComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.lobby__member-remove')).toBeNull();
    expect(compiled.querySelector<HTMLButtonElement>('.lobby__rotate')!.disabled).toBe(true);
  });

  it('rotate posts to /api/campaigns/:id/rotate-code, updates the repository row and the displayed code', async () => {
    const { toastShow } = configure({ role: 'dm' });
    const db = TestBed.inject(HkDb);
    await db.campaigns.put({
      id: CAMPAIGN_ID,
      name: 'Curse of Strahd',
      system: 'srd-5e-2024',
      role: 'dm',
      joinCode: '7QX4M2HN',
      lastSeq: 1,
      updatedAt: 1,
    } satisfies CampaignRow);

    globalThis.fetch = routedFetch({
      [`/api/campaigns/${CAMPAIGN_ID}/rotate-code`]: () =>
        jsonResponse(200, { joinCode: 'NEWC0DE1' }),
    });

    const fixture = TestBed.createComponent(LobbyComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    compiled.querySelector<HTMLButtonElement>('.lobby__rotate')!.click();
    // `rotate()`'s own `apiJson`/`CampaignsRepository` awaits are plain promises, not tracked by
    // Angular's zoneless pending-task registry. A FIXED number of `setTimeout(0)` flushes proved
    // flaky under the full suite (system load pushes real fake-indexeddb scheduling past a fixed
    // number of ticks) — task-4-report.md's fix round 1 documents the identical flake for
    // `gatewayAppend`'s own send-observation timing and fixes it with a `waitFor`-style poll
    // instead of widening a fixed wait; this does the same.
    const deadline = Date.now() + 2000;
    while (
      compiled.querySelector('.lobby__code')?.textContent?.trim() !== 'NEWC-0DE1' &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await fixture.whenStable();
    }

    expect(toastShow).not.toHaveBeenCalledWith('campaigns.lobby.toast.rotateFailed');
    expect(compiled.querySelector('.lobby__code')?.textContent?.trim()).toBe('NEWC-0DE1');
    const row = await TestBed.inject(CampaignsRepository).get(CAMPAIGN_ID);
    expect(row?.joinCode).toBe('NEWC0DE1');
  });

  it('remove member: confirms, DELETEs, and toasts — cancel never calls DELETE', async () => {
    let deleteCalled = false;
    globalThis.fetch = routedFetch({
      [`/api/campaigns/${CAMPAIGN_ID}/members/u-player`]: (init) => {
        deleteCalled = init?.method === 'DELETE';
        return noBodyResponse(204);
      },
    });
    const { dialogOpen, toastShow } = configure({ role: 'dm' });
    dialogOpen.mockReturnValue({ closed: Promise.resolve(false) }); // cancel first

    const fixture = TestBed.createComponent(LobbyComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const removeButton = compiled.querySelector<HTMLButtonElement>(
      '[data-user-id="u-player"] .lobby__member-remove',
    )!;
    removeButton.click();
    await fixture.whenStable();
    expect(deleteCalled).toBe(false);

    dialogOpen.mockReturnValue({ closed: Promise.resolve(true) }); // now confirm
    removeButton.click();
    await fixture.whenStable();

    expect(deleteCalled).toBe(true);
    expect(toastShow).toHaveBeenCalledWith('campaigns.lobby.toast.memberRemoved', { name: 'Bob' });
  });

  it('copyLink writes the /join/<code> URL to the clipboard and toasts', async () => {
    const { clipboardWrite, toastShow } = configure({ role: 'dm' });
    const fixture = TestBed.createComponent(LobbyComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    compiled.querySelector<HTMLButtonElement>('.lobby__copy-link')!.click();
    await fixture.whenStable();

    expect(clipboardWrite).toHaveBeenCalledWith(`${location.origin}/join/7QX4M2HN`);
    expect(toastShow).toHaveBeenCalledWith('campaigns.lobby.toast.linkCopied');
  });
});
