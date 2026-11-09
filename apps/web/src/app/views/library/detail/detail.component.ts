import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  Renderer2,
  resource,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { Sheet } from '@hk/engine';
import { map } from 'rxjs';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { IconComponent } from '@shared/icons/icon.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';
import { PlayActionsService } from '../../characters/sheet/play/play-actions.service';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { NavHistoryService } from '../../../ui/nav/nav-history.service';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { HkLeafComponent } from '../../../ui/leaf/leaf.component';
import { HkTagChipComponent } from '../../../ui/tag-chip/tag-chip.component';
import { TopBarService } from '../../../ui/shell/top-bar.service';
import { buildLibraryDetailStrap } from './library-detail-strap';
import { ClassEntryComponent } from './class-entry/class-entry.component';
import { EntityFactsComponent } from './entity-facts.component';

type SpellcastingBlock = Sheet['spellcasting'][number];

/** What "Add to hero" does for the entry on screen: the sheet's own add-to-bag, or its Prepare. */
type HeroAdd =
  { readonly kind: 'item' } | { readonly kind: 'spell'; readonly block: SpellcastingBlock };

@Component({
  selector: 'app-library-detail',
  imports: [
    TranslocoDirective,
    IconComponent,
    SkeletonComponent,
    HkButtonComponent,
    ClassEntryComponent,
    EntityFactsComponent,
    HkLeafComponent,
    HkTagChipComponent,
  ],
  providers: [provideTranslocoScope('library')],
  templateUrl: './detail.component.html',
  styleUrl: './detail.component.scss',
})
export class LibraryDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly engineFacade = inject(EngineFacade);
  private readonly localeService = inject(LocaleService);
  private readonly markdownService = inject(MarkdownService);
  private readonly packStore = inject(PackStore);
  private readonly characterStore = inject(CharacterStore);
  private readonly playActions = inject(PlayActionsService);
  private readonly toastService = inject(ToastService);
  private readonly navHistory = inject(NavHistoryService);
  private readonly strap = inject(ActionStrapService);
  private readonly topBar = inject(TopBarService);
  private readonly renderer = inject(Renderer2);

  // Properties
  protected readonly ready = this.packStore.ready;

  // Reactive id from the route: `paramMap.get('id')` with NO `decodeURIComponent` — Angular's own
  // URL serializer already round-trips ids containing `:` and `/` (verified in
  // browse.component.spec.ts's regression test). `toSignal` (not just `route.snapshot`) matters
  // here because navigating between two `library/:id` routes reuses this component instance —
  // only the param changes, so a snapshot alone would go stale on the next cross-link click.
  protected readonly id = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id') ?? '')),
    {
      initialValue: this.route.snapshot.paramMap.get('id') ?? '',
    },
  );

  // `?for=<characterId>`: the hero whose sheet the person came from. It rides along every
  // cross-link inside the library so "Add to hero" stays available a few entries deep.
  protected readonly forCharacter = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('for'))),
    { initialValue: this.route.snapshot.queryParamMap.get('for') },
  );

  protected readonly entity = computed(() => this.engineFacade.index().get(this.id()));

  protected readonly classEntity = computed(() => {
    const entity = this.entity();
    return entity?.type === 'class' ? entity : undefined;
  });

  protected readonly icon = computed(() => {
    const entity = this.entity();
    return entity ? this.engineFacade.iconFor(entity) : undefined;
  });

  protected readonly name = computed(() => this.engineFacade.localizer().name(this.id()));

  protected readonly nameIsFallback = computed(() => {
    const localized = this.engineFacade.localizer().text(this.id(), 'name');
    return localized.isFallback && this.localeService.locale() !== 'en';
  });

  private readonly descriptionText = computed(
    () => this.engineFacade.localizer().text(this.id(), 'description').text,
  );

  protected readonly descriptionIsFallback = computed(() => {
    const localized = this.engineFacade.localizer().text(this.id(), 'description');
    return localized.isFallback && this.localeService.locale() !== 'en';
  });

  // Async-friendly markdown rendering (controller ruling R2): `MarkdownService` dynamically
  // imports `marked`/`dompurify` on first use, so this stays a `resource()` rather than a plain
  // `computed()` — `resource()` reruns its loader whenever `descriptionText()` changes, cancels a
  // still-in-flight previous render via its own `AbortSignal` handling, and is destroyed
  // automatically with the component (no manual subscription to leak).
  protected readonly descriptionHtml = resource({
    params: () => this.descriptionText(),
    loader: ({ params }) =>
      params ? this.markdownService.render(params) : Promise.resolve(undefined),
  });

  // The rendered description container (present only once `descriptionHtml` has a value — see
  // the template). A `viewChild` signal, not a static `@ViewChild`, because the `@if` that guards
  // it tears the element down and recreates a new one each time the resource re-loads.
  private readonly descriptionContainer =
    viewChild<ElementRef<HTMLElement>>('descriptionContainer');

  // "Add to hero" (spec §4.5): only with a hero context — `?for=` names the character the
  // sheet has loaded — and only where the sheet already has a path for the entry:
  //  - an item goes into the bag (`PlayActionsService.addLibraryItem`, the sheet's add-from-library);
  //  - a spell the hero already knows but has not prepared is prepared (`togglePrepared`, the
  //    sheet's Prepare button). The sheet has no "learn a spell" path outside creation and level-up,
  //    so any other spell gets no button.
  // Every other entry type has no sheet path and gets none.
  protected readonly heroAdd = computed<HeroAdd | null>(() => {
    const forId = this.forCharacter();
    if (!forId || forId !== this.characterStore.streamId()) return null;
    const entity = this.entity();
    const sheet = this.characterStore.sheet();
    if (!entity || !sheet) return null;
    if (entity.type === 'item') return { kind: 'item' };
    if (entity.type === 'spell' && entity.level > 0) {
      const block = sheet.spellcasting.find(
        (candidate) =>
          candidate.preparedMax !== undefined &&
          candidate.known.includes(entity.id) &&
          !candidate.prepared.includes(entity.id),
      );
      return block ? { kind: 'spell', block } : null;
    }
    return null;
  });

  constructor() {
    // One delegated `click` listener on the rendered container, attached via `Renderer2` (not a
    // template `(click)` binding) — the container itself is not an interactive element; only the
    // `data-entity-id` anchors inside the sanitized markup are. Re-runs whenever the queried
    // element changes (a fresh container after a reload) and unregisters the previous listener
    // first via the effect's own cleanup — no listener is ever left dangling on a detached node.
    effect((onCleanup) => {
      const containerRef = this.descriptionContainer();
      if (!containerRef) return;
      const unlisten = this.renderer.listen(
        containerRef.nativeElement,
        'click',
        (event: MouseEvent) => this.onDescriptionClick(event),
      );
      onCleanup(unlisten);
    });

    // The strap: Back in zone 1 and, with a hero context, Add to hero in zone 2.
    effect(() => {
      const add = this.heroAdd();
      this.strap.set(
        buildLibraryDetailStrap({
          back: () => this.back(),
          add: add ? { kind: add.kind, run: () => this.addToHero() } : null,
          locked: this.playActions.editLocked(),
        }),
      );
    });

    // The phone top bar names the entry.
    effect(() => {
      const title = this.entity() ? this.name() : undefined;
      if (title) this.topBar.set({ title });
    });

    inject(DestroyRef).onDestroy(() => {
      this.strap.clear();
      this.topBar.clear();
    });
  }

  // Methods

  // Delegated click listener on the rendered description container: a cross-link anchor carries
  // `data-entity-id` and no `href` (see MarkdownService), so navigation is entirely our own.
  private onDescriptionClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[data-entity-id]');
    const entityId = anchor?.getAttribute('data-entity-id');
    if (!entityId) return;
    event.preventDefault();
    const forId = this.forCharacter();
    void (forId
      ? this.router.navigate(['/library', entityId], { queryParams: { for: forId } })
      : this.router.navigate(['/library', entityId]));
  }

  protected back(): void {
    this.navHistory.back(['/library']);
  }

  protected addToHero(): void {
    const add = this.heroAdd();
    const entity = this.entity();
    if (!add || !entity) return;
    const name = this.name();
    if (add.kind === 'item') {
      if (this.playActions.addLibraryItem(entity.id)) {
        this.toastService.show('library.detail.added', { name });
      }
      return;
    }
    if (this.playActions.togglePrepared(add.block, entity.id)) {
      this.toastService.show('library.detail.prepared', { name });
    }
  }
}
