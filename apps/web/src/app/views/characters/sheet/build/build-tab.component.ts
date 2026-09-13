import { Component, computed, inject, signal, viewChild, type ElementRef } from '@angular/core';
import { validateSelection } from '@hk/engine';
import { LongTextSchema, ShortTextSchema, type GrammaticalGender } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { SheetSectionComponent } from '@shared/components/sheet-section/sheet-section.component';
import { BlobUrlPipe } from '@shared/pipes/blob-url.pipe';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import {
  ImageInvalidTypeError,
  ImagePipelineService,
  ImageTooLargeError,
} from '@shared/services/images/image-pipeline.service';
import { PlaceholderService, type Monogram } from '@shared/services/images/placeholder.service';
import { CharacterStore } from '@shared/stores/character.store';
import { ToastService } from '@shared/components/toast/toast.service';
import type {
  ChoiceCommitFn,
  ChoiceValidateFn,
} from '../../create-wizard/steps/choice-step-overrides';
import { ChoiceStepComponent } from '../../create-wizard/steps/choice-step.component';

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
// Reuses the app-wide generic validation fallback key (`diagnostic-toast.ts`'s own
// `validation.generic`) rather than minting a portrait-specific one — an error this map doesn't
// recognize is by definition not one of the two typed pipeline errors, so no more specific
// message is available.
const GENERIC_PORTRAIT_ERROR_KEY = 'characters.validation.generic';

type AppearanceField = 'age' | 'height' | 'weight' | 'eyes' | 'hair' | 'skin' | 'description';

interface AppearanceFieldConfig {
  readonly field: AppearanceField;
  readonly labelKey: string;
  readonly multiline: boolean;
}

// Static (not built via string concatenation) so the transloco keys-manager detective
// (`check-i18n-keys.mjs`) can actually find these — same convention as `create-wizard.component.
// ts`'s own `GENDER_OPTIONS`.
const APPEARANCE_FIELDS: readonly AppearanceFieldConfig[] = [
  { field: 'age', labelKey: 'sheet.build.appearance.age', multiline: false },
  { field: 'height', labelKey: 'sheet.build.appearance.height', multiline: false },
  { field: 'weight', labelKey: 'sheet.build.appearance.weight', multiline: false },
  { field: 'eyes', labelKey: 'sheet.build.appearance.eyes', multiline: false },
  { field: 'hair', labelKey: 'sheet.build.appearance.hair', multiline: false },
  { field: 'skin', labelKey: 'sheet.build.appearance.skin', multiline: false },
  { field: 'description', labelKey: 'sheet.build.appearance.description', multiline: true },
];

// Reuses the wizard's own gender label keys (`wizard.name.gender*`) rather than duplicating them —
// relative to the 'characters' scope, same as `create-wizard.component.ts`'s `GENDER_OPTIONS`.
const GENDER_OPTIONS: { value: GrammaticalGender; labelKey: string }[] = [
  { value: 'masculine', labelKey: 'wizard.name.genderMasculine' },
  { value: 'feminine', labelKey: 'wizard.name.genderFeminine' },
  { value: 'neuter', labelKey: 'wizard.name.genderNeuter' },
];

/**
 * `/c/:id/build` — the sheet's Build tab (plan-5 task-11-brief.md): outstanding-choice re-entry
 * (reusing the wizard's own `hk-choice-step` against the LIVE character via
 * `validateChoice`/`commitChoice` below), rename, appearance, and gender forms. Replaces T10's
 * heading-only stub.
 *
 * Every form here follows the same "plain signal, no Angular `ReactiveFormsModule`" convention the
 * wizard's own name/gender step established (`create-wizard.component.ts`): a draft signal holds
 * only what the user has actually typed, falling back to the live `CharacterStore` value until
 * then, so the displayed value always round-trips back to whatever was actually committed.
 *
 * `decision.made`/`character.renamed`/`character.appearance_set`/`character.gender_set` are each
 * appended as their OWN single-event `appendTx` call the moment a form commits — there is no draft
 * layer on this tab (unlike the wizard's `CreateWizardState`): `CharacterStore.sheet`/`facts` are
 * already the live, authoritative read model, so every field here re-derives from them directly.
 */
@Component({
  selector: 'app-build-tab',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    CardComponent,
    SheetSectionComponent,
    ChoiceStepComponent,
    BlobUrlPipe,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './build-tab.component.html',
  styleUrl: './build-tab.component.scss',
})
export class BuildTabComponent {
  private readonly characterStore = inject(CharacterStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly imagePipelineService = inject(ImagePipelineService);
  private readonly placeholderService = inject(PlaceholderService);
  private readonly toastService = inject(ToastService);

  protected readonly sheet = this.characterStore.sheet;
  protected readonly outstanding = this.characterStore.outstanding;
  protected readonly appearanceFields = APPEARANCE_FIELDS;
  protected readonly genderOptions = GENDER_OPTIONS;

  // `hk-choice-step` override trio (task-11-brief.md; see `choice-step-overrides.ts`'s class doc):
  // drives the SAME generic choice-step UI the wizard uses, but against the live character —
  // `validateSelection` is the engine function `CreateWizardState.validate` itself wraps, called
  // here over `CharacterStore.sheet`/`facts` instead of a draft.
  protected readonly validateChoice: ChoiceValidateFn = (choiceId, selection) => {
    const sheet = this.characterStore.sheet();
    const facts = this.characterStore.facts();
    if (!sheet || !facts) return [];
    return validateSelection(sheet, facts, this.engineFacade.index(), choiceId, selection);
  };

  protected readonly commitChoice: ChoiceCommitFn = (choiceId, selection, context) => {
    void this.characterStore.appendTx([
      {
        type: 'decision.made',
        v: 1,
        payload: { choiceId, selection, ...(context ? { context } : {}) },
      },
    ]);
  };

  // --- Rename -----------------------------------------------------------------------------

  // `undefined` until the user types — `nameValue` falls back to the live sheet name until then,
  // and is reset back to `undefined` right after a successful commit, so the displayed value keeps
  // tracking `sheet().name` afterward rather than getting stuck on the just-submitted draft.
  protected readonly nameDraft = signal<string | undefined>(undefined);
  protected readonly nameValue = computed(() => this.nameDraft() ?? this.sheet()?.name ?? '');
  protected readonly nameValid = computed(
    () => ShortTextSchema.safeParse(this.nameValue().trim()).success,
  );

  protected onNameInput(value: string): void {
    this.nameDraft.set(value);
  }

  protected onRenameSubmit(event: Event): void {
    event.preventDefault();
    const trimmed = this.nameValue().trim();
    if (!ShortTextSchema.safeParse(trimmed).success) return;
    if (trimmed === this.sheet()?.name) {
      this.nameDraft.set(undefined);
      return;
    }
    void this.characterStore.appendTx([
      { type: 'character.renamed', v: 1, payload: { name: trimmed } },
    ]);
    this.nameDraft.set(undefined);
  }

  // --- Appearance ---------------------------------------------------------------------------

  // Only the fields the user has actually edited THIS session — `appearanceValue` falls back to
  // the live baseline for everything else, and `onAppearanceSubmit` only ever sends what's in
  // here (doc-02: "only dirty fields"), never the whole form.
  protected readonly appearanceDraft = signal<Partial<Record<AppearanceField, string>>>({});
  protected readonly appearanceBaseline = computed<Partial<Record<AppearanceField, string>>>(
    () => this.characterStore.facts()?.appearance ?? {},
  );

  protected appearanceValue(field: AppearanceField): string {
    const draft = this.appearanceDraft();
    return field in draft ? (draft[field] ?? '') : (this.appearanceBaseline()[field] ?? '');
  }

  protected onAppearanceInput(field: AppearanceField, value: string): void {
    this.appearanceDraft.update((prev) => ({ ...prev, [field]: value }));
  }

  protected onAppearanceSubmit(event: Event): void {
    event.preventDefault();
    const baseline = this.appearanceBaseline();
    const draft = this.appearanceDraft();
    const payload: Partial<Record<AppearanceField, string>> = {};
    for (const { field, multiline } of APPEARANCE_FIELDS) {
      if (!(field in draft)) continue; // never touched this session — not dirty
      const raw = (draft[field] ?? '').trim();
      if (raw === '' || raw === (baseline[field] ?? '')) continue; // unset, or unchanged
      const schema = multiline ? LongTextSchema : ShortTextSchema;
      if (!schema.safeParse(raw).success) continue;
      payload[field] = raw;
    }
    if (Object.keys(payload).length === 0) return;
    void this.characterStore.appendTx([{ type: 'character.appearance_set', v: 1, payload }]);
    this.appearanceDraft.set({});
  }

  // --- Gender ---------------------------------------------------------------------------------

  protected onGenderChange(value: GrammaticalGender): void {
    if (value === this.sheet()?.grammaticalGender) return;
    void this.characterStore.appendTx([
      { type: 'character.gender_set', v: 1, payload: { grammaticalGender: value } },
    ]);
  }

  // --- Portrait (plan-6 Task 8) -----------------------------------------------------------------
  // The upload affordance lives HERE, on Build/appearance (task-8-brief.md's own "PLACEMENT" note)
  // — the sheet SHELL header only ever DISPLAYS the current thumb/monogram
  // (`sheet-shell.component.ts`), it has no upload control of its own.

  protected readonly portraitAccept = PORTRAIT_ACCEPT;
  protected readonly portraitInput = viewChild<ElementRef<HTMLInputElement>>('portraitInput');

  protected readonly portraitThumbHash = computed(
    () => this.characterStore.facts()?.portrait?.thumbHash,
  );

  protected readonly monogram = computed<Monogram>(() =>
    this.placeholderService.monogram(
      this.sheet()?.name ?? '',
      this.characterStore.streamId() ?? '',
    ),
  );

  protected readonly monogramBackground = computed(() => `hsl(${this.monogram().hue} 45% 40%)`);

  protected onPortraitUploadClick(): void {
    this.portraitInput()?.nativeElement.click();
  }

  protected async onPortraitFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset immediately so re-selecting the SAME file path still fires a fresh `change` event —
    // the browser only fires `change` when the input's value actually differs from before.
    input.value = '';
    if (!file) return;

    try {
      const result = await this.imagePipelineService.processPortrait(file);
      await this.characterStore.appendTx([
        {
          type: 'portrait.set',
          v: 1,
          // EXACT `PortraitSetV1` shape (@hk/protocol/events/character.ts) — deliberately no
          // `tokenHash` (design ruling 4: the token blob is generated/stored by the pipeline but
          // never appears on the event stream; only `hash`/`thumbHash` do).
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
    }
  }

  protected onPortraitRemove(): void {
    void this.characterStore.appendTx([{ type: 'portrait.cleared', v: 1, payload: {} }]);
  }
}
