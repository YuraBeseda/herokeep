import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  Renderer2,
  resource,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { parseEntityId } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { Sheet } from '@hk/engine';
import { map } from 'rxjs';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { IconComponent } from '@shared/icons/icon.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
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
interface HeroAdd {
  readonly kind: 'item' | 'spell';
  /** The block that prepares the spell; absent for an item or when nothing can be done. */
  readonly block?: SpellcastingBlock;
  /** Shell key of why the button is unavailable; `null` when it works. */
  readonly reason: string | null;
}

@Component({
  selector: 'app-library-detail',
  imports: [
    TranslocoDirective,
    RouterLink,
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
  private readonly charactersRepository = inject(CharactersRepository);
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

  // The hero the library was opened for, once the sheet has it. A reload, a deep link or a second
  // tab opens the library with `?for=` but no loaded hero, so it is loaded here the way the level-up
  // guard does (`CharactersRepository.get`, then `CharacterStore.load`, which waits for the packs).
  // A hero that is gone leaves the entry without a hero context.
  private hydrateToken = 0;
  private async hydrateHero(heroId: string | null): Promise<void> {
    const token = ++this.hydrateToken;
    if (!heroId || this.characterStore.streamId() === heroId) return;
    try {
      if (!(await this.charactersRepository.get(heroId))) return;
      if (token !== this.hydrateToken) return;
      await this.characterStore.load(heroId);
    } catch {
      // A missing or unreadable hero: no hero context.
    }
  }

  // Add to hero (spec 4.5) is in the strap for every entry type the sheet can add: an item goes
  // into the bag (`PlayActionsService.addLibraryItem`, the sheet's add-from-library) and a spell is
  // prepared (`togglePrepared`, the sheet's Prepare button; the sheet has no learn-a-spell path
  // outside creation and level-up). It is enabled with a hero context and drawn disabled, with the
  // reason as its hint, without one or when the spell cannot be prepared for that hero. Every other
  // entry type has no sheet path and gets no button.
  protected readonly heroAdd = computed<HeroAdd | null>(() => {
    const entity = this.entity();
    if (!entity || (entity.type !== 'item' && entity.type !== 'spell')) return null;
    const kind = entity.type;
    const forId = this.forCharacter();
    const sheet = this.characterStore.sheet();
    if (!forId || forId !== this.characterStore.streamId() || !sheet) {
      return { kind, reason: 'shell.strap.library-no-hero' };
    }
    if (entity.type === 'item') return { kind, reason: null };
    if (entity.level === 0) return { kind, reason: 'shell.strap.library-cantrip' };
    const blocks = sheet.spellcasting;
    const block = blocks.find(
      (candidate) =>
        candidate.preparedMax !== undefined &&
        candidate.known.includes(entity.id) &&
        !candidate.prepared.includes(entity.id),
    );
    if (block) return { kind, block, reason: null };
    if (blocks.some((candidate) => candidate.prepared.includes(entity.id))) {
      return { kind, reason: 'shell.strap.library-already-prepared' };
    }
    if (blocks.some((candidate) => candidate.known.includes(entity.id))) {
      return { kind, reason: 'shell.strap.library-no-prepare' };
    }
    return { kind, reason: 'shell.strap.library-not-known' };
  });

  // The pack the entry comes from: its name and version, and the packs screen's key for it.
  protected readonly source = computed(() => {
    const packId = parseEntityId(this.id())?.packId;
    const pack = packId
      ? this.packStore.packs().find((candidate) => candidate.id === packId)
      : undefined;
    return pack
      ? {
          name: pack.name,
          version: pack.version,
          key: `${pack.id}@${pack.version}`,
          license: pack.license ?? null,
          attribution: pack.attribution ?? null,
        }
      : null;
  });

  // Spell lists, concentration and ritual of a spell, read off the entity.
  protected readonly spellExtras = computed(() => {
    const entity = this.entity();
    if (entity?.type !== 'spell') return null;
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    const lists = entity.classes.flatMap((ref) => {
      const classId = index.resolveClassRef(ref) ?? ref;
      return index.has(classId) ? [{ id: classId, name: localizer.name(classId) }] : [];
    });
    return {
      lists,
      concentration: entity.concentration === true,
      ritual: entity.ritual === true,
    };
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

    // Hydrate the hero named by `?for=` when the sheet does not have it loaded.
    effect(() => {
      const heroId = this.forCharacter();
      untracked(() => void this.hydrateHero(heroId));
    });

    // The strap: Back in zone 1, Add to hero in zone 2, Copy link and Open the pack in zone 3.
    effect(() => {
      const add = this.heroAdd();
      const source = this.source();
      this.strap.set(
        buildLibraryDetailStrap({
          back: () => this.back(),
          add: add ? { kind: add.kind, reason: add.reason, run: () => this.addToHero() } : null,
          locked: this.playActions.editLocked(),
          copy: {
            run: () => void this.copyLink(),
            unavailable: this.clipboardAvailable() ? null : 'shell.strap.library-no-clipboard',
          },
          openPack: source ? () => void this.router.navigate(['/packs', source.key]) : null,
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

  private clipboardAvailable(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
  }

  // The link to the entry itself: no hero context in it, it is a link to share.
  protected async copyLink(): Promise<void> {
    if (!this.clipboardAvailable()) return;
    const path = this.router.serializeUrl(this.router.createUrlTree(['/library', this.id()]));
    try {
      await navigator.clipboard.writeText(`${location.origin}${path}`);
      this.toastService.show('library.detail.linkCopied');
    } catch {
      this.toastService.show('library.detail.linkFailed');
    }
  }

  protected addToHero(): void {
    const add = this.heroAdd();
    const entity = this.entity();
    if (add?.reason !== null || !entity) return;
    const name = this.name();
    if (add.kind === 'item' || !add.block) {
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
