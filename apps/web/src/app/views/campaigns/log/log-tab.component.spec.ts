import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { ToastService } from '@shared/components/toast/toast.service';
import { AuthService, type AuthUser } from '@shared/services/auth/auth.service';
import type { CampaignState, LogEntry } from '@shared/services/campaigns/campaign-projection';
import { CampaignStore, CampaignStoreNotLeaderError } from '@shared/stores/campaign.store';
import campaignsEn from '../../../../assets/i18n/campaigns/en.json';
import { LogTabComponent } from './log-tab.component';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return langPath === 'campaigns/en' ? of(campaignsEn) : of({});
  }
}

function mkState(overrides: Partial<CampaignState> = {}): Partial<CampaignState> {
  return {
    name: 'Curse of Strahd',
    system: 'srd-5e-2024',
    settings: null,
    members: new Map(),
    roster: new Map(),
    overviews: new Map(),
    log: [],
    ...overrides,
  };
}

function configure(options: {
  state?: Partial<CampaignState>;
  userId?: string | null;
  appendTx?: ReturnType<typeof vi.fn>;
}): { appendTx: ReturnType<typeof vi.fn> } {
  const appendTx = options.appendTx ?? vi.fn().mockResolvedValue(undefined);
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
      {
        provide: CampaignStore,
        useValue: {
          state: signal(options.state ?? mkState()),
          role: signal('player'),
          campaignId: signal('00000000-0000-4000-8000-000000000001'),
          appendTx,
        },
      },
      {
        provide: AuthService,
        useValue: {
          user: signal<AuthUser | null>(
            options.userId === null
              ? null
              : { userId: options.userId ?? 'u-player', username: 'Bob' },
          ),
        },
      },
    ],
  });
  return { appendTx };
}

function rollEntry(
  overrides: Partial<Extract<LogEntry, { kind: 'roll' }>['payload']> = {},
): Extract<LogEntry, { kind: 'roll' }> {
  return {
    kind: 'roll',
    seq: 1,
    eventId: 'evt-roll-1',
    actorUserId: 'u-player',
    payload: {
      label: 'Strength check',
      formula: '1d20+3',
      results: [{ die: 'd20', value: 14 }],
      total: 17,
      kind: 'check',
      visibility: 'everyone',
      ...overrides,
    },
  };
}

function chatEntry(
  overrides: Partial<Extract<LogEntry, { kind: 'chat' }>['payload']> = {},
): Extract<LogEntry, { kind: 'chat' }> {
  return {
    kind: 'chat',
    seq: 2,
    eventId: 'evt-chat-1',
    actorUserId: 'u-player',
    payload: { text: 'Hello party', visibility: 'everyone', ...overrides },
  };
}

describe('LogTabComponent', () => {
  it('renders the empty message when the log has no entries', async () => {
    configure({ state: mkState({ log: [] }) });
    const fixture = TestBed.createComponent(LogTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.log-tab__empty')?.textContent?.trim()).toBe(
      campaignsEn.log.empty,
    );
  });

  it('is a live region (role="log", aria-live="polite") and its composer textarea is labeled', async () => {
    configure({ state: mkState() });
    const fixture = TestBed.createComponent(LogTabComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    const region = compiled.querySelector('.log-tab__log')!;
    expect(region.getAttribute('role')).toBe('log');
    expect(region.getAttribute('aria-live')).toBe('polite');

    const textarea = compiled.querySelector('textarea')!;
    const label = compiled.querySelector(`label[for="${textarea.id}"]`);
    expect(label).not.toBeNull();
    expect(label?.textContent?.trim()).toBe(campaignsEn.log.composer.label);
  });

  describe('log rendering', () => {
    it('renders a roll entry via hk-dice-result with the resolved actor name, all rolled dice, and the formula', async () => {
      configure({
        state: mkState({
          members: new Map([['u-player', { displayName: 'Ivan', role: 'player', removed: false }]]),
          log: [
            rollEntry({
              formula: '2d20kh1+3',
              results: [
                { die: 'd20', value: 5 },
                { die: 'd20', value: 17 },
              ],
              total: 20,
            }),
          ],
        }),
      });
      const fixture = TestBed.createComponent(LogTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const entryEl = compiled.querySelector('.log-tab__entry--roll')!;
      expect(entryEl.querySelector('.log-tab__entry-actor')?.textContent?.trim()).toBe('Ivan');
      expect(entryEl.querySelector('.log-tab__entry-label')?.textContent?.trim()).toBe(
        'Strength check',
      );
      // BOTH dice rendered (no kept/dropped distinction possible from the wire schema).
      const faces = Array.from(entryEl.querySelectorAll('.hk-dice-result__die')).map((el) =>
        el.textContent?.trim(),
      );
      expect(faces).toEqual(['5', '17']);
      expect(entryEl.querySelectorAll('.hk-dice-result__die--dropped')).toHaveLength(0);
      expect(entryEl.querySelector('.hk-dice-result__total')?.textContent).toContain('20');
      expect(entryEl.querySelector('.log-tab__entry-formula')?.textContent).toContain('2d20kh1+3');
    });

    it('renders a chat entry as a bubble with the resolved actor name and text', async () => {
      configure({
        state: mkState({
          members: new Map([['u-player', { displayName: 'Ivan', role: 'player', removed: false }]]),
          log: [chatEntry({ text: 'Watch out for the trap!' })],
        }),
      });
      const fixture = TestBed.createComponent(LogTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const entryEl = compiled.querySelector('.log-tab__entry--chat')!;
      expect(entryEl.querySelector('.log-tab__entry-actor')?.textContent?.trim()).toBe('Ivan');
      expect(entryEl.querySelector('.log-tab__entry-text')?.textContent?.trim()).toBe(
        'Watch out for the trap!',
      );
    });

    it('renders session-start/session-end markers as dividers, each with its OWN title', async () => {
      configure({
        state: mkState({
          log: [
            { kind: 'session-start', seq: 1, eventId: 'e1', title: 'Session 1: The Beginning' },
            { kind: 'session-end', seq: 5, eventId: 'e2', title: undefined },
          ],
        }),
      });
      const fixture = TestBed.createComponent(LogTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const dividers = Array.from(compiled.querySelectorAll('.log-tab__divider')).map((el) =>
        el.textContent?.trim(),
      );
      expect(dividers[0]).toContain('Session 1: The Beginning');
      expect(dividers[1]).toBe(campaignsEn.log.session.endedNoTitle);
    });

    it('falls back to a truncated raw id when the actor is not (yet) in state.members', async () => {
      const unknownUserId = 'usr_ABCDEFGHIJKLMNOPQRSTUV';
      configure({
        state: mkState({
          members: new Map(), // empty — no member.joined seen for this actor yet
          log: [{ ...rollEntry(), actorUserId: unknownUserId }],
        }),
      });
      const fixture = TestBed.createComponent(LogTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('.log-tab__entry-actor')?.textContent?.trim()).toBe(
        `${unknownUserId.slice(0, 8)}…`,
      );
    });

    describe('visibility hint chip (filtered-log honesty)', () => {
      it("shows a hint chip on the SIGNED-IN user's own dm-visibility roll", async () => {
        configure({
          userId: 'u-player',
          state: mkState({ log: [rollEntry({ visibility: 'dm' })] }),
        });
        const fixture = TestBed.createComponent(LogTabComponent);
        await fixture.whenStable();
        const compiled = fixture.nativeElement as HTMLElement;

        expect(compiled.querySelector('.log-tab__hint-chip')?.textContent?.trim()).toBe(
          campaignsEn.log.visibilityHint.dm,
        );
      });

      it('shows no hint chip on a private roll authored by SOMEONE ELSE', async () => {
        configure({
          userId: 'u-viewer',
          state: mkState({
            log: [rollEntry({ visibility: 'private' })], // actorUserId: 'u-player', not 'u-viewer'
          }),
        });
        const fixture = TestBed.createComponent(LogTabComponent);
        await fixture.whenStable();
        const compiled = fixture.nativeElement as HTMLElement;

        expect(compiled.querySelector('.log-tab__hint-chip')).toBeNull();
      });

      it('shows no hint chip on an "everyone"-visibility entry, even the viewer\'s own', async () => {
        configure({
          userId: 'u-player',
          state: mkState({ log: [rollEntry({ visibility: 'everyone' })] }),
        });
        const fixture = TestBed.createComponent(LogTabComponent);
        await fixture.whenStable();
        const compiled = fixture.nativeElement as HTMLElement;

        expect(compiled.querySelector('.log-tab__hint-chip')).toBeNull();
      });
    });
  });

  describe('composer: byte-limit (schema: text <=2048 chars AND <=2048 UTF-8 bytes)', () => {
    function textareaOf(compiled: HTMLElement): HTMLTextAreaElement {
      return compiled.querySelector('textarea')!;
    }

    function type(fixture: ReturnType<typeof TestBed.createComponent>, value: string): void {
      const textarea = textareaOf(fixture.nativeElement as HTMLElement);
      textarea.value = value;
      textarea.dispatchEvent(new Event('input'));
    }

    function sendButton(compiled: HTMLElement): HTMLButtonElement {
      return compiled.querySelector('.log-tab__composer-send')!;
    }

    it('disables send when the draft is empty', async () => {
      configure({ state: mkState() });
      const fixture = TestBed.createComponent(LogTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(sendButton(compiled).disabled).toBe(true);
    });

    it('shows the BYTE count (not the char count) for Cyrillic text, and disables send once bytes exceed 2048 even though chars stay under it', async () => {
      configure({ state: mkState() });
      const fixture = TestBed.createComponent(LogTabComponent);
      await fixture.whenStable();

      // Cyrillic 'п' is 1 UTF-16 code unit but 2 UTF-8 bytes — 1025 of them is 1025 chars/2050
      // bytes: UNDER the 2048 CHAR cap but OVER the 2048 BYTE cap. This is exactly the case the
      // brief calls out ("the composer's live count must reflect the BYTE limit for multi-byte
      // scripts").
      const cyrillic = 'п'.repeat(1025);
      type(fixture, cyrillic);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('.log-tab__composer-count')?.textContent).toContain('2050');
      expect(
        compiled
          .querySelector('.log-tab__composer-count')
          ?.classList.contains('log-tab__composer-count--over'),
      ).toBe(true);
      expect(sendButton(compiled).disabled).toBe(true);
    });

    it('enables send once the draft is non-empty and within both caps', async () => {
      configure({ state: mkState() });
      const fixture = TestBed.createComponent(LogTabComponent);
      await fixture.whenStable();

      type(fixture, 'Hello party');
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('.log-tab__composer-count')?.textContent).toContain('11');
      expect(sendButton(compiled).disabled).toBe(false);
    });
  });

  describe('composer: visibility picker gating (ruling 5, reused for chat)', () => {
    it('defaults to "everyone" and offers "Private" when no settings document has been posted yet (settings: null)', async () => {
      configure({ state: mkState({ settings: null }) });
      const fixture = TestBed.createComponent(LogTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const group = compiled.querySelector('.log-tab__composer-visibility')!;
      const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('button'));
      expect(buttons).toHaveLength(3);
      const pressed = buttons.find((b) => b.getAttribute('aria-pressed') === 'true');
      expect(pressed?.textContent?.trim()).toBe(campaignsEn.log.composer.visibility.everyone);
    });

    it("defaults to the campaign's own settings.visibility.rolls value", async () => {
      configure({
        state: mkState({
          settings: {
            visibility: { partySheets: 'overview', rolls: 'dm', allowPrivateRolls: true },
          } as unknown as CampaignState['settings'],
        }),
      });
      const fixture = TestBed.createComponent(LogTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const group = compiled.querySelector('.log-tab__composer-visibility')!;
      const pressed = Array.from(group.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.getAttribute('aria-pressed') === 'true',
      );
      expect(pressed?.textContent?.trim()).toBe(campaignsEn.log.composer.visibility.dm);
    });

    it('omits "Private" when allowPrivateRolls is false', async () => {
      configure({
        state: mkState({
          settings: {
            visibility: { partySheets: 'overview', rolls: 'everyone', allowPrivateRolls: false },
          } as unknown as CampaignState['settings'],
        }),
      });
      const fixture = TestBed.createComponent(LogTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const group = compiled.querySelector('.log-tab__composer-visibility')!;
      const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('button'));
      expect(buttons).toHaveLength(2);
      expect(
        buttons.some((b) => b.textContent?.trim() === campaignsEn.log.composer.visibility.private),
      ).toBe(false);
    });

    it('changing the picker changes which visibility is submitted', async () => {
      const { appendTx } = configure({ state: mkState() });
      const fixture = TestBed.createComponent(LogTabComponent);
      await fixture.whenStable();
      let compiled = fixture.nativeElement as HTMLElement;

      const dmButton = Array.from(
        compiled.querySelectorAll<HTMLButtonElement>('.log-tab__composer-visibility button'),
      ).find((b) => b.textContent?.trim() === campaignsEn.log.composer.visibility.dm)!;
      dmButton.click();
      await fixture.whenStable();

      const textarea = compiled.querySelector('textarea')!;
      textarea.value = 'Sneaking past the guard';
      textarea.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      compiled = fixture.nativeElement as HTMLElement;
      compiled.querySelector<HTMLButtonElement>('.log-tab__composer-send')!.click();
      await fixture.whenStable();

      expect(appendTx).toHaveBeenCalledWith([
        {
          type: 'chat.message',
          v: 1,
          payload: { text: 'Sneaking past the guard', visibility: 'dm' },
        },
      ]);
    });
  });

  describe('sending a message', () => {
    it('appends chat.message via CampaignStore.appendTx and clears the draft on success', async () => {
      const { appendTx } = configure({ state: mkState() });
      const fixture = TestBed.createComponent(LogTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;

      const textarea = compiled.querySelector('textarea')!;
      textarea.value = 'Hello party';
      textarea.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      compiled.querySelector<HTMLButtonElement>('.log-tab__composer-send')!.click();
      await fixture.whenStable();

      expect(appendTx).toHaveBeenCalledWith([
        { type: 'chat.message', v: 1, payload: { text: 'Hello party', visibility: 'everyone' } },
      ]);
      expect(compiled.querySelector('textarea')!.value).toBe('');
    });

    it('toasts CampaignStoreNotLeaderError.code on a not-leader rejection', async () => {
      const appendTx = vi.fn().mockRejectedValue(new CampaignStoreNotLeaderError());
      configure({ state: mkState(), appendTx });
      const showSpy = vi.fn();
      TestBed.overrideProvider(ToastService, { useValue: { show: showSpy } });

      const fixture = TestBed.createComponent(LogTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      const textarea = compiled.querySelector('textarea')!;
      textarea.value = 'Hello';
      textarea.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      compiled.querySelector<HTMLButtonElement>('.log-tab__composer-send')!.click();
      await fixture.whenStable();

      expect(showSpy).toHaveBeenCalledWith(new CampaignStoreNotLeaderError().code);
    });

    it('toasts the generic error key on any other rejection', async () => {
      const appendTx = vi.fn().mockRejectedValue(new Error('boom'));
      configure({ state: mkState(), appendTx });
      const showSpy = vi.fn();
      TestBed.overrideProvider(ToastService, { useValue: { show: showSpy } });

      const fixture = TestBed.createComponent(LogTabComponent);
      await fixture.whenStable();
      const compiled = fixture.nativeElement as HTMLElement;
      const textarea = compiled.querySelector('textarea')!;
      textarea.value = 'Hello';
      textarea.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      compiled.querySelector<HTMLButtonElement>('.log-tab__composer-send')!.click();
      await fixture.whenStable();

      expect(showSpy).toHaveBeenCalledWith('campaigns.log.composer.errors.generic');
    });
  });
});
