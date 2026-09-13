import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { NumberFieldComponent } from '@shared/components/number-field/number-field.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { TabsComponent, type HkTab } from '@shared/components/tabs/tabs.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { BlobUrlPipe } from '@shared/pipes/blob-url.pipe';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { deliverHeroBundle } from '@shared/services/export/hero-delivery';
import { HeroWriterService } from '@shared/services/export/hero-writer.service';
import { PlaceholderService, type Monogram } from '@shared/services/images/placeholder.service';
import { CharacterStore } from '@shared/stores/character.store';
import { filter, map } from 'rxjs';

const TAB_IDS = ['play', 'build', 'timeline'] as const;
type TabId = (typeof TAB_IDS)[number];

/**
 * `/c/:id` — the character sheet's shell (plan-5 task-10-brief.md): a header (portrait-placeholder
 * circle with initials, name, level/classes line) plus `hk-tabs` routing between `play`/`build`/
 * `timeline` child routes. `characterResolver` (`app.routes.ts`) has already awaited
 * `CharacterStore.load(id)` (or failed to) before this component is ever created — its
 * `characterFound` route data decides whether the header/tabs/`router-outlet` render at all, or an
 * i18n not-found message instead. Doc-09: "phone-first single column; tablet/desktop uses a CSS
 * grid with container queries" — this shell itself stays a plain single column; the grid lives in
 * `play-tab.component.scss`, scoped to that tab's own content.
 */
@Component({
  selector: 'app-sheet-shell',
  imports: [
    TranslocoDirective,
    RouterOutlet,
    RouterLink,
    TabsComponent,
    SkeletonComponent,
    FormsModule,
    NumberFieldComponent,
    ButtonComponent,
    BlobUrlPipe,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './sheet-shell.component.html',
  styleUrl: './sheet-shell.component.scss',
})
export class SheetShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly engineFacade = inject(EngineFacade);
  private readonly placeholderService = inject(PlaceholderService);
  private readonly heroWriterService = inject(HeroWriterService);
  private readonly toastService = inject(ToastService);
  protected readonly characterStore = inject(CharacterStore);

  // `characterResolver` only ever runs again (and this component only ever gets re-created) when
  // `:id` actually changes — Angular's default `RouteReuseStrategy` doesn't reuse a route whose
  // params differ — so reading the resolved flag once, here, is safe; it can't go stale under this
  // component's own lifetime.
  protected readonly found = this.route.snapshot.data['characterFound'] === true;

  protected readonly sheet = this.characterStore.sheet;

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly activeTabId = computed<TabId>(() => {
    const url = this.currentUrl();
    return TAB_IDS.find((id) => url.endsWith(`/${id}`)) ?? 'play';
  });

  // --- Portrait (plan-6 Task 8) ---------------------------------------------------------------

  /** The monogram placeholder shown until (or after) a portrait is set — deterministic per
   * character id (`PlaceholderService`'s own class doc), not per name, so it never flickers to a
   * different hue on a rename. */
  protected readonly monogram: Signal<Monogram> = computed(() =>
    this.placeholderService.monogram(
      this.sheet()?.name ?? '',
      this.characterStore.streamId() ?? '',
    ),
  );

  // Fix-round 1, finding 4: the `hsl(...)` string is now computed ONCE, centrally, by
  // `PlaceholderService.monogram` itself (`Monogram.background`) — this just re-exposes it under
  // the name the template already binds, rather than re-deriving the formula here.
  protected readonly monogramBackground = computed(() => this.monogram().background);

  /** `undefined` until `portrait.set` has been appended (design ruling 4: the reducer only ever
   * stores `{hash, thumbHash}` in `facts.portrait` — no token field lives on the event stream at
   * all). Feeds `BlobUrlPipe` in the template (`(portraitThumbHash() | blobUrl)()`); a `thumb`
   * blob missing from `BlobsRepository` (shouldn't happen — `ImagePipelineService` always writes
   * it before `appendTx`) just resolves to `undefined`, falling back to the monogram again. */
  protected readonly portraitThumbHash = computed(
    () => this.characterStore.facts()?.portrait?.thumbHash,
  );

  // --- XP entry + "level up available" badge (plan-5 task-13-brief.md) -----------------------

  protected readonly xp = computed(() => this.characterStore.facts()?.xp ?? 0);
  protected readonly advancements = this.characterStore.advancements;
  protected readonly levelUpAvailable = computed(() => this.advancements().length > 0);

  // `null` between submits — `hk-number-field`'s own CVA contract (its `writeValue`/`onInput` both
  // traffic in `number | null`, never `undefined`); a plain draft signal, same "no Angular
  // ReactiveFormsModule" convention every other builder/sheet form in this codebase follows.
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
   * is LED by a `level.gained` event — a "tx group" is every event sharing the last event's `txId`
   * (contiguous by construction: `CharacterStore.appendTx` assigns one txId per call and events are
   * always appended in seq order), or, when the last event carries no txId at all (a single-event
   * level-up with no further decisions/spells — e.g. fighter 1→2, which is JUST `level.gained`),
   * that one event by itself. `undefined` (no undo offered) for any other last event/tx. */
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

  protected tabsFor(t: (key: string) => string): HkTab[] {
    return TAB_IDS.map((id) => ({ id, label: t(`sheet.tabs.${id}`) }));
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

  protected onTabSelected(id: string | undefined): void {
    if (!id || id === this.activeTabId()) return;
    void this.router.navigate([id], { relativeTo: this.route });
  }

  // --- `.hero` export (plan-6 Task 9) -----------------------------------------------------------

  /** Guards the Export button against a double-click firing two concurrent exports/deliveries. */
  protected readonly exporting = signal(false);

  /** Builds the bundle (`HeroWriterService.export`, pure) then hands it to the delivery ladder
   * (`deliverHeroBundle`, design ruling 5). A `'cancelled'` outcome — the user backed out of the
   * save picker or share sheet — is a normal no-op, not a failure: no toast either way. Any other
   * outcome (`'saved'`/`'shared'`/`'downloaded'`) toasts success; a thrown error (a storage read
   * failure, an invalid manifest — shouldn't happen, but `HeroWriterService.export` can throw)
   * toasts the generic failure key instead. */
  protected async onExport(): Promise<void> {
    const characterId = this.characterStore.streamId();
    if (!characterId || this.exporting()) return;

    this.exporting.set(true);
    try {
      const { blob, fileName } = await this.heroWriterService.export(characterId);
      const outcome = await deliverHeroBundle(blob, fileName);
      if (outcome !== 'cancelled') {
        this.toastService.show('characters.sheet.export.success');
      }
    } catch {
      this.toastService.show('characters.sheet.export.failure');
    } finally {
      this.exporting.set(false);
    }
  }
}
