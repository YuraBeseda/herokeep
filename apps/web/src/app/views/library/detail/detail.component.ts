import {
  Component,
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
import { map } from 'rxjs';
import { ButtonComponent } from '@shared/components/button/button.component';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { IconComponent } from '@shared/icons/icon.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { PackStore } from '@shared/stores/pack.store';
import { EntityFactsComponent } from './entity-facts.component';

@Component({
  selector: 'app-library-detail',
  imports: [
    TranslocoDirective,
    IconComponent,
    SkeletonComponent,
    ButtonComponent,
    EntityFactsComponent,
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

  protected readonly entity = computed(() => this.engineFacade.index().get(this.id()));

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
    void this.router.navigate(['/library', entityId]);
  }

  protected back(): void {
    void this.router.navigate(['/library']);
  }
}
