import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Diagnostic } from '@hk/engine';
import {
  makeEntityId,
  type Entity,
  type FeatEntity,
  type ItemEntity,
  type SpeciesEntity,
  type SpellEntity,
} from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ToastService } from '@shared/components/toast/toast.service';
import { diagnosticKey } from '@shared/helpers/diagnostic-toast';
import { HomebrewService, HomebrewValidationError } from '@shared/services/packs/homebrew.service';
import { isHomebrewFormType, type HomebrewFormType } from './entity-form.helpers';
import { FeatFormComponent } from './feat-form.component';
import { ItemFormComponent } from './item-form.component';
import { SpeciesFormComponent } from './species-form.component';
import { SpellFormComponent } from './spell-form.component';

/**
 * `validatePack` codes a homebrew save can realistically produce, each with its own
 * `packs.homebrew.validation.<code>` message; any other code gets `validation.generic`
 * (`diagnosticKey`'s fallback). The forms already rule out most of them up front.
 */
export const HOMEBREW_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  'ref.missing',
  'entity.descriptionTooLong',
  'pack.tooLarge',
]);

/** A refused save: schema `issues` (formatted lines) and/or validator error `diagnostics`. */
interface SaveFailure {
  readonly issues: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * `/packs/homebrew/new/:type` and `/packs/homebrew/edit/:type/:slug` — hosts the matching form
 * (`:type` ∈ item/spell/feat/species), runs `HomebrewService.save` with what it submits, and either
 * returns to the list with a toast (plus a second one when some characters were left with an
 * update to review) or keeps the form and lists why the pack refused the entry: schema issues as
 * data lines, validator diagnostics through the `diagnosticKey` mapping.
 */
@Component({
  selector: 'app-homebrew-editor',
  imports: [
    TranslocoDirective,
    RouterLink,
    ItemFormComponent,
    SpellFormComponent,
    FeatFormComponent,
    SpeciesFormComponent,
  ],
  providers: [provideTranslocoScope('packs')],
  templateUrl: './homebrew-editor.component.html',
  styleUrl: './homebrew-form.scss',
})
export class HomebrewEditorComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly homebrewService = inject(HomebrewService);
  private readonly toastService = inject(ToastService);

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });

  protected readonly type = computed<HomebrewFormType | undefined>(() => {
    const type = this.params().get('type') ?? '';
    return isHomebrewFormType(type) ? type : undefined;
  });
  private readonly slug = computed(() => this.params().get('slug'));
  protected readonly entity = computed<Entity | undefined>(() => {
    const type = this.type();
    const slug = this.slug();
    const packId = this.homebrewService.packId();
    if (!type || slug === null || packId === null) return undefined;
    const id = makeEntityId(packId, type, slug);
    return this.homebrewService.pack()?.entities.find((e) => e.id === id);
  });
  protected readonly editing = computed(() => this.slug() !== null);
  protected readonly notFound = computed(
    () => this.type() === undefined || (this.editing() && this.entity() === undefined),
  );

  protected readonly busy = signal(false);
  protected readonly failure = signal<SaveFailure | null>(null);

  protected asItem(entity: Entity | undefined): ItemEntity | undefined {
    return entity?.type === 'item' ? entity : undefined;
  }

  protected asSpell(entity: Entity | undefined): SpellEntity | undefined {
    return entity?.type === 'spell' ? entity : undefined;
  }

  protected asFeat(entity: Entity | undefined): FeatEntity | undefined {
    return entity?.type === 'feat' ? entity : undefined;
  }

  protected asSpecies(entity: Entity | undefined): SpeciesEntity | undefined {
    return entity?.type === 'species' ? entity : undefined;
  }

  /** Scope-relative message key for a validator diagnostic. */
  protected diagnosticLabel(diagnostic: Diagnostic): string {
    return `homebrew.${diagnosticKey(diagnostic.code, HOMEBREW_DIAGNOSTIC_CODES)}`;
  }

  protected async onSubmitted(entity: Entity): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      const result = await this.homebrewService.save(entity);
      this.toastService.show('packs.homebrew.saved', { updated: result.fastForwarded.length });
      if (result.pending.length > 0) {
        this.toastService.show('packs.homebrew.pending', { count: result.pending.length });
      }
      await this.router.navigate(['/packs/homebrew']);
    } catch (error) {
      if (error instanceof HomebrewValidationError) {
        this.failure.set({ issues: error.issues, diagnostics: error.diagnostics });
        this.toastService.show(error.code);
      } else {
        this.toastService.show('packs.homebrew.save-failed-unknown');
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async onCancelled(): Promise<void> {
    await this.router.navigate(['/packs/homebrew']);
  }
}
