import {
  Component,
  computed,
  inject,
  input,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { LongTextSchema, ShortTextSchema, type GrammaticalGender } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ToastService } from '@shared/components/toast/toast.service';
import { BlobUrlPipe } from '@shared/pipes/blob-url.pipe';
import {
  ImageInvalidTypeError,
  ImagePipelineService,
  ImageTooLargeError,
} from '@shared/services/images/image-pipeline.service';
import { PlaceholderService, type Monogram } from '@shared/services/images/placeholder.service';
import { CharacterStore } from '@shared/stores/character.store';
import { IconComponent } from '../../../../shared/icons/icon.component';
import { HkButtonComponent } from '../../../../ui/button/button.component';
import { HkLeafComponent } from '../../../../ui/leaf/leaf.component';
import { HkTagChipComponent } from '../../../../ui/tag-chip/tag-chip.component';
import { HkTextFieldComponent } from '../../../../ui/text-field/text-field.component';
import { HkTextareaComponent } from '../../../../ui/textarea/textarea.component';
import { HkTooltipDirective } from '../../../../ui/tooltip/tooltip.directive';

/** doc-07 step 1: `accept="image/*"` WITHOUT a literal `image/heic` entry, so iOS's own picker
 * transcodes HEIC photos to JPEG before this app ever sees the file — a defense-in-depth check
 * still runs inside `ImagePipelineService.processPortrait` (`assertAcceptableFile`) for anything
 * that slips past this attribute (a non-iOS browser, a manually renamed file, or SVG — which DOES
 * match the `image/*` glob and needs the JS-level rejection). */
const PORTRAIT_ACCEPT = 'image/*';

const PORTRAIT_ERROR_KEYS: Record<string, string> = {
  'image.too-large': 'characters.sheet.portrait.error.tooLarge',
  'image.invalid-type': 'characters.sheet.portrait.error.invalidType',
};
// An error this map does not recognize is by definition not one of the two typed pipeline errors,
// so the app-wide generic validation fallback is the only message available.
const GENERIC_PORTRAIT_ERROR_KEY = 'characters.validation.generic';

type AppearanceField = 'age' | 'height' | 'weight' | 'eyes' | 'hair' | 'skin' | 'description';

// Static (not built via string concatenation) so the transloco keys-manager detective
// (`check-i18n-keys.mjs`) can find these.
const GRID_FIELDS: readonly { field: AppearanceField; labelKey: string }[] = [
  { field: 'age', labelKey: 'sheet.build.appearance.age' },
  { field: 'height', labelKey: 'sheet.build.appearance.height' },
  { field: 'weight', labelKey: 'sheet.build.appearance.weight' },
  { field: 'eyes', labelKey: 'sheet.build.appearance.eyes' },
  { field: 'hair', labelKey: 'sheet.build.appearance.hair' },
  { field: 'skin', labelKey: 'sheet.build.appearance.skin' },
];

// The wizard's own gender label keys (relative to the 'characters' scope).
const GENDER_OPTIONS: { value: GrammaticalGender; labelKey: string }[] = [
  { value: 'feminine', labelKey: 'wizard.name.genderFeminine' },
  { value: 'masculine', labelKey: 'wizard.name.genderMasculine' },
  { value: 'neuter', labelKey: 'wizard.name.genderNeuter' },
];

/**
 * Board B01, "Identity": the portrait (upload / change / remove, each its own event), and the name,
 * grammatical gender (as radio chips) and appearance fields behind ONE Save with an "unsaved
 * changes" chip. Edits are plain drafts over the live read model; Save appends the dirty ones as
 * ONE transaction (`character.renamed`, `character.gender_set`, `character.appearance_set` — only
 * the dirty fields of the last), so a Revert on the Timeline undoes the whole save at once.
 */
@Component({
  selector: 'app-build-identity-section',
  imports: [
    TranslocoDirective,
    HkLeafComponent,
    HkButtonComponent,
    HkTagChipComponent,
    HkTextFieldComponent,
    HkTextareaComponent,
    IconComponent,
    HkTooltipDirective,
    BlobUrlPipe,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './build-identity-section.component.html',
  styleUrl: './build-identity-section.component.scss',
})
export class BuildIdentitySectionComponent {
  private readonly store = inject(CharacterStore);
  private readonly imagePipelineService = inject(ImagePipelineService);
  private readonly placeholderService = inject(PlaceholderService);
  private readonly toastService = inject(ToastService);

  // Inputs
  /** The campaign edit lock (`BuildTabComponent.editLocked`): every control is blocked. */
  readonly disabled = input(false);
  readonly disabledReason = input<string | null>(null);

  protected readonly sheet = this.store.sheet;
  protected readonly gridFields = GRID_FIELDS;
  protected readonly genderOptions = GENDER_OPTIONS;

  // --- Drafts ---------------------------------------------------------------------------------

  // `undefined` until the user edits: the displayed value then falls back to the live read model,
  // so after a Save the field keeps tracking whatever was actually committed.
  protected readonly nameDraft = signal<string | undefined>(undefined);
  protected readonly genderDraft = signal<GrammaticalGender | undefined>(undefined);
  // Only the fields edited THIS session; Save sends only what is in here and differs from the live
  // value (doc-02: "only dirty fields").
  protected readonly appearanceDraft = signal<Partial<Record<AppearanceField, string>>>({});

  protected readonly nameValue = computed(() => this.nameDraft() ?? this.sheet()?.name ?? '');
  protected readonly nameValid = computed(
    () => ShortTextSchema.safeParse(this.nameValue().trim()).success,
  );
  protected readonly genderValue = computed(
    () => this.genderDraft() ?? this.sheet()?.grammaticalGender,
  );
  private readonly appearanceBaseline = computed<Partial<Record<AppearanceField, string>>>(
    () => this.store.facts()?.appearance ?? {},
  );

  protected appearanceValue(field: AppearanceField): string {
    const draft = this.appearanceDraft();
    return field in draft ? (draft[field] ?? '') : (this.appearanceBaseline()[field] ?? '');
  }

  /** The appearance fields Save would send: edited, non-empty, changed and schema-valid. */
  private readonly appearancePayload = computed(() => {
    const baseline = this.appearanceBaseline();
    const draft = this.appearanceDraft();
    const payload: Partial<Record<AppearanceField, string>> = {};
    for (const field of [...GRID_FIELDS.map((f) => f.field), 'description' as const]) {
      if (!(field in draft)) continue;
      const raw = (draft[field] ?? '').trim();
      if (raw === '' || raw === (baseline[field] ?? '')) continue;
      const schema = field === 'description' ? LongTextSchema : ShortTextSchema;
      if (!schema.safeParse(raw).success) continue;
      payload[field] = raw;
    }
    return payload;
  });

  private readonly nameDirty = computed(
    () => this.nameDraft() !== undefined && this.nameValue().trim() !== this.sheet()?.name,
  );
  private readonly genderDirty = computed(
    () =>
      this.genderDraft() !== undefined && this.genderDraft() !== this.sheet()?.grammaticalGender,
  );
  protected readonly dirty = computed(
    () =>
      this.nameDirty() || this.genderDirty() || Object.keys(this.appearancePayload()).length > 0,
  );
  protected readonly canSave = computed(
    () => this.dirty() && (!this.nameDirty() || this.nameValid()),
  );

  protected onGenderKey(event: KeyboardEvent, index: number): void {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next =
      this.genderOptions[(index + step + this.genderOptions.length) % this.genderOptions.length];
    this.genderDraft.set(next.value);
    const group = (event.currentTarget as HTMLElement).parentElement;
    queueMicrotask(() =>
      group?.querySelector<HTMLElement>(`[data-gender="${next.value}"]`)?.focus(),
    );
  }

  protected onAppearanceInput(field: AppearanceField, value: string): void {
    this.appearanceDraft.update((prev) => ({ ...prev, [field]: value }));
  }

  /** Whether the form holds edits that are not saved (the route's exit guard asks through this). */
  hasUnsaved(): boolean {
    return this.dirty();
  }

  protected async save(): Promise<void> {
    if (!this.canSave() || this.disabled()) return;
    const drafts = [];
    if (this.nameDirty()) {
      drafts.push({
        type: 'character.renamed' as const,
        v: 1,
        payload: { name: this.nameValue().trim() },
      });
    }
    if (this.genderDirty()) {
      drafts.push({
        type: 'character.gender_set' as const,
        v: 1,
        payload: { grammaticalGender: this.genderDraft()! },
      });
    }
    const appearance = this.appearancePayload();
    if (Object.keys(appearance).length > 0) {
      drafts.push({ type: 'character.appearance_set' as const, v: 1, payload: appearance });
    }
    if (drafts.length === 0) return;
    try {
      await this.store.appendTx(drafts);
    } catch {
      // The drafts stay (nothing was saved); the generic error toast says so, and Save can be
      // pressed again.
      this.toastService.show(GENERIC_PORTRAIT_ERROR_KEY);
      return;
    }
    this.nameDraft.set(undefined);
    this.genderDraft.set(undefined);
    this.appearanceDraft.set({});
  }

  // --- Portrait (plan-6 Task 8) -----------------------------------------------------------------
  // The upload affordance lives HERE; the sheet shell only DISPLAYS the current portrait.

  protected readonly portraitAccept = PORTRAIT_ACCEPT;
  protected readonly portraitInput = viewChild<ElementRef<HTMLInputElement>>('portraitInput');

  /** Guards `onPortraitFileSelected` against a SECOND file pick racing an in-flight one (the async
   * `processPortrait` → `appendTx` chain has no other synchronization): disables the upload control
   * AND short-circuits a concurrent call at the handler level. */
  protected readonly portraitUploading = signal(false);

  protected readonly portraitThumbHash = computed(() => this.store.facts()?.portrait?.thumbHash);

  protected readonly monogram = computed<Monogram>(() =>
    this.placeholderService.monogram(this.sheet()?.name ?? '', this.store.streamId() ?? ''),
  );

  protected onPortraitUploadClick(): void {
    this.portraitInput()?.nativeElement.click();
  }

  protected async onPortraitFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset immediately so re-selecting the SAME file path still fires a fresh `change` event.
    input.value = '';
    if (!file) return;
    if (this.portraitUploading()) return;

    this.portraitUploading.set(true);
    try {
      const result = await this.imagePipelineService.processPortrait(file);
      await this.store.appendTx([
        {
          type: 'portrait.set',
          v: 1,
          // EXACT `PortraitSetV1` shape — deliberately no `tokenHash` (design ruling 4: the token
          // blob is stored by the pipeline but never appears on the event stream).
          payload: {
            hash: result.hash,
            thumbHash: result.thumbHash,
            mime: result.mime,
            w: result.w,
            h: result.h,
          },
        },
      ]);
    } catch (error) {
      const code =
        error instanceof ImageTooLargeError || error instanceof ImageInvalidTypeError
          ? error.code
          : undefined;
      this.toastService.show(
        code
          ? (PORTRAIT_ERROR_KEYS[code] ?? GENERIC_PORTRAIT_ERROR_KEY)
          : GENERIC_PORTRAIT_ERROR_KEY,
      );
    } finally {
      this.portraitUploading.set(false);
    }
  }

  protected onPortraitRemove(): void {
    void this.store.appendTx([{ type: 'portrait.cleared', v: 1, payload: {} }]);
  }
}
