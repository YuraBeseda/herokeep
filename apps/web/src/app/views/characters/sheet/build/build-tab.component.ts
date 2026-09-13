import { Component, computed, inject, signal } from '@angular/core';
import { validateSelection } from '@hk/engine';
import { LongTextSchema, ShortTextSchema, type GrammaticalGender } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { SheetSectionComponent } from '@shared/components/sheet-section/sheet-section.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CharacterStore } from '@shared/stores/character.store';
import type {
  ChoiceCommitFn,
  ChoiceValidateFn,
} from '../../create-wizard/steps/choice-step-overrides';
import { ChoiceStepComponent } from '../../create-wizard/steps/choice-step.component';

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
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './build-tab.component.html',
  styleUrl: './build-tab.component.scss',
})
export class BuildTabComponent {
  private readonly characterStore = inject(CharacterStore);
  private readonly engineFacade = inject(EngineFacade);

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
}
