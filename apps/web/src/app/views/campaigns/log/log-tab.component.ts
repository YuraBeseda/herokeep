import {
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CampaignVisibility } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  DiceResultComponent,
  type DiceResultDie,
} from '@shared/components/dice-result/dice-result.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { AuthService } from '@shared/services/auth/auth.service';
import type { LogEntry } from '@shared/services/campaigns/campaign-projection';
import {
  CampaignStore,
  CampaignStoreNotAuthenticatedError,
  CampaignStoreNotLeaderError,
} from '@shared/stores/campaign.store';

/** doc-02's own wire bound (`ChatMessageV1`'s `.refine`) — this composer's live count/disable gate
 * mirrors it EXACTLY, measured the same way the schema measures it (UTF-8 bytes, not UTF-16 code
 * units), so a Cyrillic/multi-byte message is blocked client-side at the identical point the
 * server would otherwise reject it. */
const CHAT_MAX_BYTES = 2048;

type RollLogEntry = Extract<LogEntry, { kind: 'roll' }>;

/**
 * `/g/:id/log` (plan-10 task-10-brief.md): replaces Task 6's placeholder outright. `campaignGuard`
 * (`app.routes.ts`) has already `CampaignStore.open()`'d the stream — same "no own data-loading,
 * the guard already did it" relationship every other campaign tab has to `CampaignStore` (see
 * `PartyTabComponent`'s own class doc) — so this reads `campaignStore.state()` directly, including
 * its `settings` for the composer's visibility-picker default/gating. This is why the CHAT
 * composer publishes via `CampaignStore.appendTx` (targets whichever stream is currently open —
 * correct here, since the log view only ever renders inside that SAME open campaign), unlike
 * `PlayTabComponent`'s roll publisher, which lives on a DIFFERENT page (the character's own play
 * tab) and must instead use the parameterized `CampaignStore.appendToStream` — see that
 * component's own doc for why.
 *
 * ## Rendering
 *
 * `state().log` (`CampaignState.log`, `campaign-projection.ts`) is already seq-ordered ascending
 * (the projector folds committed-then-pending events in order and `push`es each log entry as it
 * goes — Task 3's own fold, never re-sorted here). Four kinds: `roll` (reuses `hk-dice-result`,
 * the SAME shared component `RollLogPanelComponent`'s local session log already uses — task-10-
 * brief.md: "existing dice-result component"), `chat` (a plain text bubble), and `session-start`/
 * `session-end` (rendered as dividers, each carrying its OWN title — the T3 carry: "the active-
 * session banner (T14's concern) prefers the STARTED title; this task only renders markers as
 * dividers with their own titles").
 *
 * ## The "all rolled dice, no kept/dropped distinction" data-loss (documented, not a bug)
 *
 * `RollLoggedV1.results` carries every rolled die (kept AND dropped — the publishing-side ruling
 * `PlayTabComponent.publishRoll` documents) but the SCHEMA has no per-die `kept` flag at all. This
 * view therefore renders every published die as `kept: true` — `hk-dice-result`'s own dropped-face
 * styling simply never triggers here, unlike the LOCAL (pre-publish) `RollLogPanelComponent` view,
 * which still has the original `kept` flags and renders them correctly. This is an accepted v1
 * limitation of the wire schema, not a rendering bug — flagged in task-10-report.md.
 *
 * ## Filtered-log honesty (ruling 5 / doc-08)
 *
 * The server already filters WHICH `roll.logged`/`chat.message` events even reach this device's
 * socket (doc-08: `'dm'` -> DM + the roller's own connections; `'private'` -> roller only, not even
 * the DM; `'everyone'` -> all) — this component never re-filters what `state().log` already
 * contains, it just renders it. The one thing it adds: a small "hint chip" on the VIEWER's OWN
 * `dm`/`private` entries (never on someone else's — a DM viewing another player's `'dm'`-visibility
 * roll has no reason to be told "only visible to you and the DM", since the whole point is that the
 * roller wants a personal reminder of their own entry's reduced audience).
 *
 * ## Auto-scroll, no virtualization (documented v1 scope, task-10-brief.md)
 *
 * Scrolls the log container to its newest (bottom) entry whenever the entry COUNT grows — standard
 * running-log UX, same "log bounded by stream quota" reasoning the brief gives for why
 * virtualization isn't needed in v1 (a campaign stream's practical entry count is nowhere near
 * virtualization-worthy scale).
 */
@Component({
  selector: 'app-log-tab',
  imports: [TranslocoDirective, FormsModule, ButtonComponent, DiceResultComponent],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './log-tab.component.html',
  styleUrl: './log-tab.component.scss',
})
export class LogTabComponent {
  private readonly campaignStore = inject(CampaignStore);
  private readonly authService = inject(AuthService);
  private readonly toastService = inject(ToastService);

  protected readonly state = this.campaignStore.state;
  protected readonly entries = computed<readonly LogEntry[]>(() => this.state()?.log ?? []);

  private readonly logContainer = viewChild<ElementRef<HTMLElement>>('logContainer');

  // --- Composer ---------------------------------------------------------------------------------

  protected readonly draftText = signal('');
  protected readonly draftVisibility = signal<CampaignVisibility>('everyone');
  protected readonly sending = signal(false);

  /** Ruling 5's own defaults, reused verbatim for chat (doc-02 names no SEPARATE "chat default" —
   * `CampaignSettingsSchema.visibility` has only `rolls`/`allowPrivateRolls`, no `chat` field — so
   * this composer's picker reuses the roll picker's own default/gating exactly, a judgment call
   * documented in task-10-report.md). `undefined` settings (no `campaign.settings_changed` posted
   * yet) fall back to `'everyone'`/`allowPrivateRolls: true`, the SAME fallback
   * `defaultCampaignSettings` (`campaign-settings.component.ts`) establishes. */
  protected readonly visibilityOptions = computed<readonly CampaignVisibility[]>(() => {
    const allowPrivate = this.state()?.settings?.visibility.allowPrivateRolls ?? true;
    return allowPrivate ? (['everyone', 'dm', 'private'] as const) : (['everyone', 'dm'] as const);
  });

  private readonly resetDefaultVisibility = effect(() => {
    const rollsDefault = this.state()?.settings?.visibility.rolls;
    this.draftVisibility.set(rollsDefault ?? 'everyone');
  });

  protected readonly draftBytes = computed(() => new TextEncoder().encode(this.draftText()).length);
  protected readonly overLimit = computed(() => this.draftBytes() > CHAT_MAX_BYTES);
  protected readonly canSend = computed(
    () => this.draftText().trim().length > 0 && !this.overLimit() && !this.sending(),
  );

  // Auto-scrolls to the newest (bottom) entry whenever `entries()` changes (a new log entry
  // arriving, in practice) — `queueMicrotask` defers past this same change-detection pass so the
  // newly rendered log row already has layout (a synchronous `scrollTop` write here would still
  // see the PREVIOUS `scrollHeight`).
  private readonly scrollToNewestOnGrowth = effect(() => {
    this.entries();
    const el = this.logContainer()?.nativeElement;
    if (!el) return;
    queueMicrotask(() => {
      el.scrollTop = el.scrollHeight;
    });
  });

  protected onDraftTextChange(value: string): void {
    this.draftText.set(value);
  }

  protected onDraftVisibilityChange(v: CampaignVisibility): void {
    this.draftVisibility.set(v);
  }

  protected async onSend(): Promise<void> {
    if (!this.canSend()) return;
    const text = this.draftText().trim();
    this.sending.set(true);
    try {
      await this.campaignStore.appendTx([
        { type: 'chat.message', v: 1, payload: { text, visibility: this.draftVisibility() } },
      ]);
      this.draftText.set('');
    } catch (err) {
      const key =
        err instanceof CampaignStoreNotLeaderError ||
        err instanceof CampaignStoreNotAuthenticatedError
          ? err.code
          : 'campaigns.log.composer.errors.generic';
      this.toastService.show(key);
    } finally {
      this.sending.set(false);
    }
  }

  // --- Rendering helpers -------------------------------------------------------------------------

  /** Every rolled die renders `kept: true` — see class doc's "all rolled dice, no kept/dropped
   * distinction" section for why the wire schema can't carry the original flag. */
  protected diceFor(entry: RollLogEntry): readonly DiceResultDie[] {
    return entry.payload.results.map((r) => ({
      sides: Number(r.die.slice(1)),
      value: r.value,
      kept: true,
    }));
  }

  /** `state().members` resolves the display name (Task 3's `MemberEntry`); an id this device has
   * never seen a `member.*` event for (shouldn't normally happen — every log entry's actor is by
   * definition a campaign member) falls back to a truncated raw id, per the brief's own fallback
   * instruction. */
  protected actorName(actorUserId: string): string {
    const displayName = this.state()?.members.get(actorUserId)?.displayName;
    if (displayName) return displayName;
    return actorUserId.length > 8 ? `${actorUserId.slice(0, 8)}…` : actorUserId;
  }

  /** Gates the "visibility hint chip" — only ever true for the SIGNED-IN user's own entries (see
   * class doc's "Filtered-log honesty" section for why this is never shown on someone else's
   * entry). */
  protected isOwn(actorUserId: string): boolean {
    return this.authService.user()?.userId === actorUserId;
  }
}
