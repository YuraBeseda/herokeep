import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { CampaignChipComponent } from '@shared/components/campaign-chip/campaign-chip.component';
import { CampaignEditLockBannerComponent } from '@shared/components/campaign-edit-lock-banner/campaign-edit-lock-banner.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { BlobUrlPipe } from '@shared/pipes/blob-url.pipe';
import { provideEngineScope } from '@shared/services/engine/engine-scope.providers';
import { WakeLockService } from '@shared/services/pwa/wake-lock.service';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { PlaceholderService, type Monogram } from '@shared/services/images/placeholder.service';
import { CharacterEngineScope } from '@shared/stores/character-engine-scope';
import { CharacterStore } from '@shared/stores/character.store';
import { combineLatest, filter, map, switchMap } from 'rxjs';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { HkBannerComponent } from '../../../ui/banner/banner.component';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { HkIconButtonComponent } from '../../../ui/icon-button/icon-button.component';
import { HkInspirationToggleComponent } from '../../../ui/inspiration-toggle/inspiration-toggle.component';
import { HkTooltipDirective } from '../../../ui/tooltip/tooltip.directive';
import { IconComponent } from '../../../shared/icons/icon.component';
import { HkNumberFieldComponent } from '../../../ui/number-field/number-field.component';
import { HkPortraitFrameComponent } from '../../../ui/portrait-frame/portrait-frame.component';
import { TopBarService } from '../../../ui/shell/top-bar.service';
import { TabBarService, type TabItem } from '../../../ui/tab-bar/tab-bar.service';
import { HkXpBarComponent } from '../../../ui/xp-bar/xp-bar.component';
import { AbilitiesLeafComponent } from './play/abilities-leaf/abilities-leaf.component';
import { NotesDrawerComponent } from './play/notes-drawer/notes-drawer.component';
import { PlayActionsService } from './play/play-actions.service';
import { PlayRollsService } from './play/play-rolls.service';
import { RollLogDrawerComponent } from './play/roll-log-drawer/roll-log-drawer.component';
import { VitalsLeafComponent } from './play/vitals-leaf/vitals-leaf.component';
import { CampaignPacksBannerComponent } from './campaign-packs-banner.component';
import { SheetChromeService } from './sheet-chrome.service';
import { PHONE_TAB_IDS, SheetLayoutService } from './sheet-layout';
import { buildSheetStrap } from './sheet-strap';
import { sheetNames } from './play/play-names';

/** The folio's tabs (desktop/tablet); each is a child route of `/c/:id`. */
/** A strap button by action id: the drawers it opens treat it as their opener (focus goes back to it,
 * and pressing it again is a toggle, not an outside press). */
const strapButton = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-action="${id}"]`);

const TAB_IDS = ['play', 'build', 'timeline'] as const;
type TabId = (typeof TAB_IDS)[number];

type PhoneTabId = (typeof PHONE_TAB_IDS)[number];

/** Icons and (shell-scope) label keys of the phone's tab bar. */
const PHONE_TAB_ITEMS: Record<PhoneTabId, Pick<TabItem, 'icon' | 'label'>> = {
  combat: { icon: 'attacks', label: 'shell.tabs.combat' },
  spells: { icon: 'spells', label: 'shell.tabs.spells' },
  bag: { icon: 'bag', label: 'shell.tabs.bag' },
  hero: { icon: 'heroes', label: 'shell.tabs.hero' },
  more: { icon: 'notes', label: 'shell.tabs.more' },
};

const LEVEL_UP_SEGMENT = 'level-up';

/** The sheet child routes the strap and the layout resolution apply to (not `level-up`). */
const SHEET_CHILDREN: ReadonlySet<string> = new Set([...TAB_IDS, ...PHONE_TAB_IDS]);

/**
 * `/c/:id` — the character sheet's shell (spec §4.2, board `Main`). On tablet/desktop it is the
 * folio column — portrait, name plate, the Play · Build · Timeline tabs with the Level up
 * tab-action and the XP bar, then the vitals (HP strap, AC shield, initiative, speed), the ability
 * * seals with their skills — beside the routed tab. On the phone the folio shrinks to the identity
 * row, the bottom tab bar (`TabBarService`) switches between the Combat · Spells · Bag · Hero ·
 * More child routes, and the same leaves are composed by those tabs instead.
 *
 * The shell is the ONE place that reconciles route and width: below 768 px `/play` lands on
 * `/combat`; from 768 px a phone-tab URL resolves to `/play` (deep links and Back keep working
 * because both are `replaceUrl` redirects). It also sets the action strap — scoped to
 * `['/c', id]` so it survives tab changes — and, on the phone, the tab bar and top bar.
 * `characterResolver` (`app.routes.ts`) has already awaited `CharacterStore.load(id)` before this
 * component is created; its `characterFound` route data decides whether anything renders at all.
 */
@Component({
  selector: 'app-sheet-shell',
  imports: [
    TranslocoDirective,
    RouterOutlet,
    RouterLink,
    SkeletonComponent,
    BlobUrlPipe,
    CampaignChipComponent,
    CampaignEditLockBannerComponent,
    CampaignPacksBannerComponent,
    HkBannerComponent,
    HkButtonComponent,
    HkNumberFieldComponent,
    HkPortraitFrameComponent,
    HkXpBarComponent,
    VitalsLeafComponent,
    AbilitiesLeafComponent,
    HkInspirationToggleComponent,
    HkIconButtonComponent,
    HkTooltipDirective,
    IconComponent,
    NotesDrawerComponent,
    RollLogDrawerComponent,
  ],
  // Plan 15 Task 4: a component-level `EngineFacade` scoped to the loaded character's pins — every
  // tab and level-up (routed children) names and lists against the character's own pack set.
  providers: [
    provideTranslocoScope('characters'),
    CharacterEngineScope,
    provideEngineScope(CharacterEngineScope),
  ],
  templateUrl: './sheet-shell.component.html',
  styleUrl: './sheet-shell.component.scss',
})
export class SheetShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly engineFacade = inject(EngineFacade);
  private readonly placeholderService = inject(PlaceholderService);
  private readonly toastService = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly strap = inject(ActionStrapService);
  private readonly wakeLock = inject(WakeLockService);
  private readonly tabBar = inject(TabBarService);
  private readonly topBar = inject(TopBarService);
  private readonly chrome = inject(SheetChromeService);
  private readonly rolls = inject(PlayRollsService);
  protected readonly actions = inject(PlayActionsService);
  protected readonly characterStore = inject(CharacterStore);

  // `characterResolver` only ever runs again (and this component only ever gets re-created) when
  // `:id` actually changes — Angular's default `RouteReuseStrategy` doesn't reuse a route whose
  // params differ — so reading the resolved flag once, here, is safe.
  protected readonly found = this.route.snapshot.data['characterFound'] === true;
  private readonly routeId = this.route.snapshot.paramMap.get('id') ?? '';

  protected readonly sheet = this.characterStore.sheet;
  /** Plan 15 Task 4 (ruling 8): pins whose exact version is not installed — the banner's list. */
  protected readonly missingPins = this.characterStore.missingPins;

  /** The one breakpoint signal (`ui/shell/viewport`): phone below 768 px. */
  private readonly layout = inject(SheetLayoutService);
  protected readonly phone = this.layout.phone;

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** The last path segment under `/c/:id` — `play`, `combat`, `build`, `level-up`, … */
  private readonly childSegment = computed(() => {
    const path = this.currentUrl().split(/[?#]/)[0];
    return path.split('/').filter(Boolean).pop() ?? 'play';
  });

  /** The level-up flow is open: the folio's tabs are dimmed and the Level up tab-action is the active one. */
  protected readonly levelUpOpen = computed(() => this.childSegment() === LEVEL_UP_SEGMENT);

  /** The folio tab that is current: every play tab (`combat`, `spells`, …) is "Play"; none while the
   * level-up is open. */
  protected readonly activeTabId = computed<TabId | null>(() => {
    const segment = this.childSegment();
    if (segment === LEVEL_UP_SEGMENT) return null;
    if (segment === 'build' || segment === 'timeline') return segment;
    return 'play';
  });

  /** Whether the routed child belongs to this width (`play` on desktop, a phone tab on the phone). */
  protected readonly layoutOk = computed(() => {
    const segment = this.childSegment();
    if (!SHEET_CHILDREN.has(segment)) return true; // level-up and the like
    this.phone();
    return this.layout.resolve(segment) === segment;
  });

  // --- Portrait (plan-6 Task 8) ---------------------------------------------------------------

  /** The monogram placeholder shown until (or after) a portrait is set — deterministic per
   * character id, not per name, so it never flickers to a different hue on a rename. */
  protected readonly monogram = computed<Monogram>(() =>
    this.placeholderService.monogram(
      this.sheet()?.name ?? '',
      this.characterStore.streamId() ?? '',
    ),
  );
  protected readonly monogramBackground = computed(() => this.monogram().background);
  /** The per-character hue, darkened a step so the cream monogram ink keeps AA contrast on every hue. */
  protected readonly monogramWell = computed(
    () => `linear-gradient(rgb(0 0 0 / 28%), rgb(0 0 0 / 28%)), ${this.monogramBackground()}`,
  );

  /** `undefined` until `portrait.set` has been appended; feeds `BlobUrlPipe` in the template. */
  protected readonly portraitThumbHash = computed(
    () => this.characterStore.facts()?.portrait?.thumbHash,
  );

  // --- XP, level up (plan-5 task-13-brief.md) ---------------------------------------------------

  protected readonly xp = computed(() => this.characterStore.facts()?.xp ?? 0);
  protected readonly advancements = this.characterStore.advancements;
  protected readonly levelUpAvailable = computed(() => this.advancements().length > 0);

  /** The pack's own XP table (`system.tables.xp[i]` = XP needed to BE level i+1) around the
   * character's level: the bar's floor and the threshold the Level up tab-action names. */
  protected readonly xpRange = computed(() => {
    const table = this.engineFacade.index().system().tables.xp;
    const level = this.sheet()?.level ?? 1;
    const floor = table[level - 1] ?? 0;
    const next = table[level];
    return { floor, next: next ?? null };
  });

  // `null` between submits — `hk-number-field`'s model traffics in `number | null`.
  protected readonly xpAward = signal<number | null>(null);

  protected onXpAwardChange(value: number | null): void {
    this.xpAward.set(value);
  }

  protected onXpAwardSubmit(): void {
    const amount = this.xpAward();
    if (amount === null || amount === 0) return;
    void this.characterStore.appendTx([{ type: 'xp.awarded', v: 1, payload: { amount } }]);
    this.xpAward.set(null);
  }

  // --- "Undo level-up" (plan-5 task-13-brief.md) ------------------------------------------------

  /** The target `revert()` needs, visible only while the LAST tx group in `characterStore.events()`
   * is LED by a `level.gained` event (every event sharing the last event's `txId`, or the last
   * event alone when it carries none). `undefined` (no undo offered) for any other last event. */
  protected readonly undoableLevelUpTarget = computed<
    { txId?: string; eventId?: string } | undefined
  >(() => {
    const events = this.characterStore.events();
    const last = events.at(-1);
    if (!last) return undefined;
    if (last.txId === undefined) {
      return last.type === 'level.gained' ? { eventId: last.id } : undefined;
    }
    const group = events.filter((e) => e.txId === last.txId);
    return group[0]?.type === 'level.gained' ? { txId: last.txId } : undefined;
  });

  protected onUndoLevelUp(target: { txId?: string; eventId?: string }): void {
    void this.characterStore.revert(target);
  }

  protected classLine(t: (key: string, params?: Record<string, unknown>) => string): string {
    const sheet = this.sheet();
    if (!sheet) return '';
    if (sheet.classes.length === 0) return t('sheet.header.levelOnly', { level: sheet.level });
    const localizer = this.engineFacade.localizer();
    return sheet.classes
      .map((c) =>
        t('sheet.header.classLevel', { class: localizer.name(c.classId), level: c.level }),
      )
      .join(' · ');
  }

  // --- Tabs ---------------------------------------------------------------------------------

  protected readonly tabIds = TAB_IDS;

  protected onTabSelected(id: TabId): void {
    // The tabs are inert while the level-up is open (Cancel leaves it).
    if (this.levelUpOpen() || id === this.activeTabId()) return;
    void this.router.navigate([id], { relativeTo: this.route });
  }

  /** Left/Right/Home/End move between the three folio tabs (the tablist's keyboard contract). */
  protected onTabsKey(event: KeyboardEvent): void {
    if (this.levelUpOpen()) return;
    const index = TAB_IDS.indexOf(this.activeTabId() ?? 'play');
    const last = TAB_IDS.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % TAB_IDS.length
        : event.key === 'ArrowLeft'
          ? (index + last) % TAB_IDS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    this.onTabSelected(TAB_IDS[next]);
    queueMicrotask(() =>
      document.querySelector<HTMLElement>(`#sheet-tab-${TAB_IDS[next]}`)?.focus(),
    );
  }

  // --- Export (plan-6 Task 9) -----------------------------------------------------------------

  protected readonly exporting = this.chrome.exporting;
  protected readonly notesOpen = this.chrome.notesOpen;
  protected readonly rollLogOpen = this.chrome.rollLogOpen;
  protected readonly notesOpener = this.chrome.notesOpener;
  protected readonly rollLogOpener = this.chrome.rollLogOpener;

  protected onExport(t: (key: string, params?: Record<string, unknown>) => string): void {
    void this.chrome.exportHero(t);
  }

  // --- The action strap, tab bar and top bar -------------------------------------------------

  private readonly translationsReady = toSignal(
    this.transloco.langChanges$.pipe(
      switchMap(() =>
        combineLatest([
          this.transloco.selectTranslate('sheet.hp.concentratingOn', {}, 'characters'),
          this.transloco.selectTranslate('sheet.roll.plainName', {}, 'characters'),
        ]),
      ),
    ),
    { initialValue: null },
  );

  private readonly names = sheetNames(this.engineFacade);

  private readonly concentrationName = computed(() => {
    const spellId = this.sheet()?.concentration?.spellId;
    return spellId ? this.names.resolve(spellId) : null;
  });

  /** The concentration note in the strap's status slot (zone 3, far right). */
  private readonly statusText = computed(() => {
    this.translationsReady();
    const name = this.concentrationName();
    return name ? this.tr('characters.sheet.hp.concentratingOn', { name }) : undefined;
  });

  private tr(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(key, params);
  }

  /** A scoped translator in the shape the roll methods take. */
  private readonly scopedT = (key: string, params?: Record<string, unknown>): string =>
    this.tr(`characters.${key}`, params);

  constructor() {
    if (!this.found) return;

    // Set from effects, not eagerly: a predecessor screen's destroy-time clear can run after this
    // constructor, and would wipe a config set eagerly. Re-runs on every navigation inside the
    // sheet so the strap is back when a tab replaced it (e.g. returning from level-up).
    effect(() => this.setStrap());
    effect(() => this.setTabBar());
    effect(() => this.setTopBar());
    effect(() => this.reconcileLayout());

    inject(DestroyRef).onDestroy(() => {
      this.strap.clear();
      this.tabBar.set(null);
      this.topBar.clear();
    });
  }

  private setStrap(): void {
    const sheet = this.sheet();
    const segment = this.childSegment();
    const locked = this.actions.editLocked();
    const conditionsDeniedIn = this.actions.denies('playersManageConditions')
      ? this.actions.campaignName()
      : undefined;
    const exporting = this.chrome.exporting();
    const wakeLock = this.wakeLock.supported ? { active: this.wakeLock.active() } : undefined;
    const status = this.statusText();
    this.translationsReady();
    if (!sheet) return;
    if (!SHEET_CHILDREN.has(segment)) {
      // Level up has its own strap (flow strap); the sheet's must not linger under it.
      untracked(() => {
        if (this.strap.config()?.primary.some((a) => a.id === 'hp')) this.strap.clear();
      });
      return;
    }
    untracked(() => {
      this.strap.set(
        buildSheetStrap(
          { locked, conditionsDeniedIn, exporting, wakeLock, status, scope: ['/c', this.routeId] },
          {
            focusHpAmount: () => this.focusHpAmount(),
            rollPlain: () => this.rollPlain(),
            shortRest: () => void this.actions.shortRest(this.names.hitDiceOptions(this.sheet())),
            longRest: () => void this.actions.longRest(),
            addCondition: () => void this.actions.addCondition(this.names.conditionOptions()),
            toggleNotes: () => this.chrome.toggleNotes(strapButton('notes')),
            toggleRollLog: () => this.chrome.toggleRollLog(strapButton('roll-log')),
            exportHero: () => void this.chrome.exportHero(this.scopedT),
            toggleWakeLock: () =>
              void (this.wakeLock.active() ? this.wakeLock.disable() : this.wakeLock.enable()),
            edit: () => void this.router.navigate(['build'], { relativeTo: this.route }),
          },
        ),
      );
    });
  }

  private setTabBar(): void {
    const segment = this.childSegment();
    const show = this.phone() && (SHEET_CHILDREN.has(segment) || segment === LEVEL_UP_SEGMENT);
    this.tabBar.set(
      show
        ? PHONE_TAB_IDS.map((id) => ({
            id,
            ...PHONE_TAB_ITEMS[id],
            route: ['/c', this.routeId, id],
            ...(id === 'more'
              ? {
                  alsoActive: [
                    ['/c', this.routeId, 'build'],
                    ['/c', this.routeId, 'timeline'],
                    ['/c', this.routeId, LEVEL_UP_SEGMENT],
                  ],
                }
              : {}),
          }))
        : null,
    );
  }

  private setTopBar(): void {
    const sheet = this.sheet();
    if (!this.phone() || !sheet) {
      untracked(() => this.topBar.clear());
      return;
    }
    untracked(() =>
      this.topBar.set({
        title: sheet.name,
        action: {
          id: 'edit',
          label: 'shell.icon.edit',
          icon: 'edit',
          run: () => void this.router.navigate(['build'], { relativeTo: this.route }),
        },
        scope: ['/c', this.routeId],
      }),
    );
  }

  /** A live resize across the breakpoint: the route guard (`sheetLayoutGuard`) resolves the route
   * before activation; this moves an already-open tab (`play` -> the phone tab the player was on,
   * a phone tab -> `play`). */
  private reconcileLayout(): void {
    const segment = this.childSegment();
    this.layout.note(segment);
    if (this.layoutOk()) return;
    const target = this.layout.resolve(segment);
    untracked(
      () => void this.router.navigate([target], { relativeTo: this.route, replaceUrl: true }),
    );
  }

  // The strap's HP action takes the typed amount in the HP gauge: they bring the player to it
  // (the Combat tab on the phone) and focus its field; the gauge's own buttons apply it.
  private focusHpAmount(): void {
    const focus = (): void =>
      document.querySelector<HTMLInputElement>('.hk-hp-gauge__amount')?.focus();
    if (document.querySelector('.hk-hp-gauge__amount')) {
      focus();
      return;
    }
    void this.router.navigate(['combat'], { relativeTo: this.route }).then(() => setTimeout(focus));
  }

  // The strap's Roll: one plain d20 (advantage-aware), logged; the total comes back as a toast.
  private rollPlain(): void {
    const total = this.rolls.rollPlainCheck(
      this.tr('characters.sheet.roll.plainName'),
      this.scopedT,
    );
    this.toastService.show('characters.sheet.roll.plainResult', { total });
  }
}
