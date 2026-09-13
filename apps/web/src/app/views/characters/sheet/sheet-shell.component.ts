import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { TabsComponent, type HkTab } from '@shared/components/tabs/tabs.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
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
  imports: [TranslocoDirective, RouterOutlet, TabsComponent, SkeletonComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './sheet-shell.component.html',
  styleUrl: './sheet-shell.component.scss',
})
export class SheetShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly engineFacade = inject(EngineFacade);
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

  protected readonly initials = computed(() => {
    const name = this.sheet()?.name ?? '';
    const letters = name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '');
    return letters.join('');
  });

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
}
