import { Component, DestroyRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { Diagnostic } from '@hk/engine';
import {
  makeEntityId,
  type Entity,
  type FeatEntity,
  type ItemEntity,
  type SpeciesEntity,
  type SpellEntity,
} from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { DialogService } from '@app/ui/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { diagnosticKey } from '@shared/helpers/diagnostic-toast';
import { HomebrewService, HomebrewValidationError } from '@shared/services/packs/homebrew.service';
import { IconComponent } from '../../../shared/icons/icon.component';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { askOnce } from '../../../ui/nav/ask-once';
import { isHomebrewFormType, type HomebrewFormType } from './entity-form.helpers';
import { FeatFormComponent } from './feat-form.component';
import { HOMEBREW_FORM } from './homebrew-form.base';
import { buildHomebrewEditorStrap } from './homebrew-editor-strap';
import { HomebrewLeaveConfirmComponent } from './homebrew-leave-confirm.component';
import { MarkdownHelpComponent } from './markdown-help.component';
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

/** Keys of the strap note, held in constants (the key checker reads literals in `translate()` calls
 * against the unscoped file; these live in the `packs` scope, which is loaded by the time they are read). */
const ATTENTION_KEY = 'packs.homebrew.attention';
const UNSAVED_KEY = 'packs.homebrew.unsaved';

/** A refused save: schema `issues` (formatted lines) and/or validator error `diagnostics`. */
interface SaveFailure {
  readonly issues: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * `/packs/homebrew/new/:type` and `/packs/homebrew/edit/:type/:slug` (board PK05) — hosts the
 * matching form (`:type` ∈ item/spell/feat/species), runs `HomebrewService.save` with what it
 * submits, and either returns to the list with a toast (plus a second one when some characters were
 * left with an update to review) or keeps the form and lists why the pack refused the entry: schema
 * issues as data lines, validator diagnostics through the `diagnosticKey` mapping.
 *
 * The strap carries Cancel (zone 1), Save (zone 2, awaiting the save) and Markdown help (zone 3).
 * The form is a dirty form: every exit — the strap's Cancel, Back, a tab, the rail, browser Back —
 * goes through `canLeave()` (the route's `canDeactivate`), which asks once while edits are unsaved
 * and stays silent after a successful save. A failed save keeps the form and its edits.
 */
@Component({
  selector: 'app-homebrew-editor',
  imports: [
    TranslocoDirective,
    HkButtonComponent,
    IconComponent,
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
  private readonly dialogService = inject(DialogService);
  private readonly strap = inject(ActionStrapService);
  private readonly transloco = inject(TranslocoService);

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly lang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
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
  /** Set once a save succeeded, so the navigation that follows is not asked about. */
  private saved = false;

  private readonly form = viewChild(HOMEBREW_FORM);

  constructor() {
    effect(() => {
      const form = this.form();
      const type = this.type();
      this.lang(); // re-translate the status note when the language changes
      const invalid = form?.invalidCount() ?? 0;
      const dirty = form?.dirty() ?? false;
      const note =
        invalid > 0
          ? this.transloco.translate(ATTENTION_KEY, { count: invalid })
          : dirty
            ? this.transloco.translate(UNSAVED_KEY)
            : undefined;
      this.strap.set(
        buildHomebrewEditorStrap({
          type: type ?? 'item',
          cancel: () => void this.leave(),
          save: () => form?.requestSubmit(),
          markdownHelp: () => this.dialogService.open(MarkdownHelpComponent),
          busy: this.busy(),
          canSave: form !== undefined && !this.notFound(),
          note,
        }),
      );
    });
    inject(DestroyRef).onDestroy(() => this.strap.clear());
  }

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

  protected back(): void {
    void this.leave();
  }

  private async leave(): Promise<void> {
    await this.router.navigate(['/packs/homebrew']);
  }

  /**
   * The route's `canDeactivate`: leaving with unsaved edits asks once ("Keep editing" / "Discard
   * changes"); a clean form, a saved one or a not-found screen leaves silently. Escape and the
   * backdrop close the confirm with `undefined`, which stays.
   */
  private readonly askLeave = askOnce(async () => {
    const handle = this.dialogService.open(HomebrewLeaveConfirmComponent);
    return (await handle.closed) === true;
  });

  async canLeave(): Promise<boolean> {
    if (this.saved || this.notFound() || !(this.form()?.dirty() ?? false)) return true;
    return this.askLeave();
  }

  protected async onSubmitted(entity: Entity): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      const result = await this.homebrewService.save(entity);
      this.saved = true;
      this.toastService.show('packs.homebrew.saved', { updated: result.fastForwarded.length });
      if (result.pending.length > 0) {
        this.toastService.show('packs.homebrew.pending', { count: result.pending.length });
      }
      if (result.updateCheckFailed) this.toastService.show('packs.homebrew.update-check-failed');
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
}
