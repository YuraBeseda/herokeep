import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import type { ContentIndex, Localizer, Sheet } from '@hk/engine';
import {
  makeEntityId,
  parseChoiceId,
  parseEntityId,
  ShortTextSchema,
  type GrammaticalGender,
} from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StepperComponent, type HkStepperStep } from '@shared/components/stepper/stepper.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import { CreateWizardState, type WizardStep } from './create-wizard.state';
import { ChoiceStepComponent } from './steps/choice-step.component';
import { EquipmentStepComponent } from './steps/equipment-step.component';
import { SpellsStepComponent } from './steps/spells-step.component';

// Relative to the 'characters' scope (this component's own template reads `t()` scoped via
// `*transloco="let t; read: 'characters'"` — unlike `WizardStep.labelKey`, which is read by
// `hk-stepper`'s own UNSCOPED template and therefore needs the full `characters.` prefix).
const GENDER_OPTIONS: { value: GrammaticalGender; labelKey: string }[] = [
  { value: 'masculine', labelKey: 'wizard.name.genderMasculine' },
  { value: 'feminine', labelKey: 'wizard.name.genderFeminine' },
  { value: 'neuter', labelKey: 'wizard.name.genderNeuter' },
];

// The R5 synthetic `<classId>@1/skills` decision (task-9-brief.md, mirrors `choice-step.
// component.ts`'s own local `SKILLS_SUFFIX`) has no backing `Choice` entity, so
// `Localizer.choicePrompt` can't resolve a prompt for it — the review falls back to the step's own
// label key instead. Same fallback shape for 'name' — reachable only when the review is viewed
// before a name has been entered. Both are RELATIVE keys (no 'characters.' prefix) — unlike
// `WizardStep.labelKey` (consumed by `hk-stepper`'s own UNSCOPED template, see this component's
// `GENDER_OPTIONS` comment above), these are read by THIS component's own SCOPED `t()`
// (`*transloco="let t; read: 'characters'"`), which auto-prepends the scope itself.
const SKILLS_SUFFIX = '@1/skills';
const SKILLS_FALLBACK_LABEL_KEY = 'wizard.steps.classSkills';
const NAME_FALLBACK_LABEL_KEY = 'wizard.steps.name';

const GENERIC_CREATE_FAILURE_KEY = 'characters.wizard.review.toast.createFailed';

/** Either an already-localized display string, or (when none was found — the synthetic
 * class-skills choice, or the pre-name 'name' step) a full i18n KEY the template resolves via its
 * own scoped `t()` — never both at once. */
interface PromptLabel {
  promptText: string;
  promptKey?: string;
}

// One rendered piece of a decision's "selection" column (task-9-brief.md review completion):
// a plain already-localized string for anything resolvable straight off the content index or
// passed through as-is (skill/literal values), or a structured ability token — 'abilityDelta' for
// a background/ASI bump (`str:+2`, rendered via the existing `abilitiesImprove.deltaLabel` key,
// same as the abilities-improve step's own chips) and 'abilityScore' for an absolute generated
// score (`str:15`, rendered as a plain number — no sign, no i18n needed, same convention as the
// HP/AC/prof numbers below it).
type SelectionPart =
  | { kind: 'text'; text: string }
  | { kind: 'abilityDelta'; ability: string; delta: number }
  | { kind: 'abilityScore'; ability: string; value: number };

interface DecisionSummary extends PromptLabel {
  choiceId: string;
  parts: SelectionPart[];
}

// Matches a `decision.made` selection value shaped like an ability id + a delta/absolute score
// (`abilities`/`abilityGeneration` picks — see `CreateWizardState`'s `setDecision` callers): group
// 1 the ability abbreviation, group 2 the raw (possibly signed) number.
const ABILITY_VALUE_RE = /^([a-z]+):([+-]?\d+)$/i;

/**
 * `/characters/new` — the creation wizard's shell (plan-5 task-5-brief.md). Hosts
 * `CreateWizardState` as a COMPONENT provider (a fresh draft per visit, never shared/root), wires
 * its engine-derived `steps()` into `hk-stepper`, and implements the 'name' step and the 'review'
 * step's skeleton itself — T6-9 plug in 'choice'/'spells'/'equipment' step bodies (rendered as a
 * placeholder here in the meantime; the step derivation and navigation shell around them is this
 * task's whole job).
 */
@Component({
  selector: 'app-create-wizard',
  imports: [
    TranslocoDirective,
    StepperComponent,
    ButtonComponent,
    ChoiceStepComponent,
    SpellsStepComponent,
    EquipmentStepComponent,
  ],
  providers: [CreateWizardState, provideTranslocoScope('characters')],
  templateUrl: './create-wizard.component.html',
  styleUrl: './create-wizard.component.scss',
})
export class CreateWizardComponent {
  protected readonly state = inject(CreateWizardState);
  private readonly characterStore = inject(CharacterStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly router = inject(Router);
  private readonly toastService = inject(ToastService);

  protected readonly genderOptions = GENDER_OPTIONS;

  // The wizard's own navigation cursor — `hk-stepper` never derives this itself (see its
  // SKILL.md's "Do / Don't"). Defaults to 'name': `state.steps()` always starts with it.
  protected readonly activeStepId = signal('name');
  protected readonly nameTouched = signal(false);
  protected readonly creating = signal(false);

  protected readonly nameValid = computed(
    () => ShortTextSchema.safeParse(this.state.name().trim()).success,
  );
  // Reused straight off the protocol's own schema (task-5-brief.md) rather than a copied literal.
  protected readonly nameMaxLength = ShortTextSchema.maxLength ?? undefined;

  protected readonly currentStep = computed<WizardStep | undefined>(() =>
    this.state.steps().find((s) => s.id === this.activeStepId()),
  );

  private readonly currentIndex = computed(() =>
    this.state.steps().findIndex((s) => s.id === this.activeStepId()),
  );

  protected readonly canGoBack = computed(() => this.currentIndex() > 0);

  protected readonly canGoNext = computed(() => {
    const idx = this.currentIndex();
    const steps = this.state.steps();
    if (idx < 0 || idx >= steps.length - 1) return false; // unknown position, or already last
    return steps[idx]?.kind !== 'name' || this.nameValid();
  });

  // A step is 'current' while active (highest priority — even an invalid decision's step is
  // still just 'current' while you're actively fixing it, not also 'blocked'); otherwise
  // 'blocked' when it's a choice step whose decision is currently invalid
  // (`state.invalidDecisions`) — clickable, so the user can revisit and fix it (see
  // `StepperComponent.isClickable`); otherwise 'done' once the draft actually records it: the
  // name once non-empty, a choice step once its choiceId has a recorded (valid) decision, the
  // free-form 'spells' step once `state.spellsAutoDone()` (>=1 cantrip learned) OR the user
  // explicitly continued past it (`state.doneSteps()`), and 'equipment' likewise but marked-only
  // (task-8-brief.md: no auto-done rule for it); otherwise 'todo'.
  protected readonly stepperSteps = computed<HkStepperStep[]>(() => {
    const active = this.activeStepId();
    const decisions = this.state.decisions();
    const invalidDecisions = this.state.invalidDecisions();
    const nameDone = this.state.name().trim().length > 0;
    const spellsDone = this.state.spellsAutoDone() || this.state.doneSteps().has('spells');
    const equipmentDone = this.state.doneSteps().has('equipment');
    return this.state.steps().map((step): HkStepperStep => {
      if (step.id === active) return { id: step.id, labelKey: step.labelKey, state: 'current' };
      if (
        step.kind === 'choice' &&
        step.choiceId !== undefined &&
        invalidDecisions.has(step.choiceId)
      ) {
        return { id: step.id, labelKey: step.labelKey, state: 'blocked' };
      }
      const done =
        (step.kind === 'name' && nameDone) ||
        (step.kind === 'choice' && step.choiceId !== undefined && decisions.has(step.choiceId)) ||
        (step.kind === 'spells' && spellsDone) ||
        (step.kind === 'equipment' && equipmentDone);
      return { id: step.id, labelKey: step.labelKey, state: done ? 'done' : 'todo' };
    });
  });

  protected readonly complete = computed(
    () =>
      this.state.outstanding().length === 0 &&
      this.state.name().trim().length > 0 &&
      this.state.invalidDecisions().size === 0,
  );

  protected readonly genderLabelKey = computed(() => {
    const option = this.genderOptions.find((o) => o.value === this.state.gender());
    return option?.labelKey ?? this.genderOptions[0].labelKey;
  });

  // Steps are removed the moment their decision is recorded (`CreateWizardState.steps` is
  // re-derived from `outstandingChoices`, not appended-to — see its class doc). A future
  // species/background/etc. step component (T6-9) can legitimately call `setDecision` on the
  // CURRENTLY ACTIVE step without navigating away first, which would otherwise strand
  // `activeStepId` on a vanished id: `currentIndex` becomes -1, and `canGoBack`/`canGoNext` both
  // read false, dead-ending the footer (only a stepper-nav click on a 'done' step could recover).
  // This effect re-homes `activeStepId` whenever it stops appearing in `state.steps()`: it lands
  // on whatever now sits at the vanished step's OWN former ordinal position (i.e. the next
  // undecided step that took its place), clamped to the new (shorter) list, falling back to the
  // last step ('review') if that former position can't be recovered. `steps()` is the only
  // tracked dependency (recomputes only when the derived list itself changes, not on every
  // deliberate `activeStepId` navigation); prior state is read via `untracked` so this effect
  // never re-triggers itself off its own write.
  private previousSteps: WizardStep[] = [];
  private readonly reHomeActiveStep = effect(() => {
    const steps = this.state.steps();
    const activeId = untracked(() => this.activeStepId());
    if (!steps.some((s) => s.id === activeId)) {
      const formerIndex = this.previousSteps.findIndex((s) => s.id === activeId);
      const targetIndex =
        formerIndex === -1 ? steps.length - 1 : Math.min(formerIndex, steps.length - 1);
      const target = steps[targetIndex] ?? steps.at(-1);
      if (target) this.activeStepId.set(target.id);
    }
    this.previousSteps = steps;
  });

  // Ability line + chosen entity names for the review skeleton (task-5-brief.md: "renders the
  // draft summary skeleton"). Full presentation (icons, grouping, spell/equipment lists) is
  // T6-9's job once those steps exist; this is deliberately minimal.
  protected readonly abilityLine = computed(() => {
    const sheet = this.state.draftSheet();
    if (!sheet) return '';
    return Object.entries(sheet.abilities)
      .map(([id, block]) => `${id.toUpperCase()} ${block.score.value}`)
      .join(' · ');
  });

  // Full decision list (task-9-brief.md: "each decision as 'prompt: localized selection'
  // pairs") — every recorded `state.decisions()` entry, in insertion order, with its prompt
  // resolved via `Localizer.choicePrompt` (falling back to a step label key for the synthetic
  // class-skills choice — see `PromptLabel`'s doc) and each selected value formatted per
  // `formatSelectionParts`. Empty before a name/draft exists (mirrors every other draftSheet-gated
  // review section).
  protected readonly decisionSummaries = computed<DecisionSummary[]>(() => {
    if (!this.state.draftSheet()) return [];
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    return [...this.state.decisions().entries()].map(([choiceId, selection]) => ({
      choiceId,
      ...this.promptFor(choiceId, localizer),
      parts: this.formatSelectionParts(choiceId, selection, index, localizer),
    }));
  });

  // Items/spells summaries (task-9-brief.md) — read off `draftSheet` (itself derived FROM
  // `extraDrafts` via `reduce`+`derive`, same as the equipment/spells steps' own inventory/
  // spellcasting reads) rather than re-parsing raw `extraDrafts` payloads by hand.
  protected readonly inventorySummary = computed<Sheet['inventory']>(
    () => this.state.draftSheet()?.inventory ?? [],
  );
  protected readonly knownSpellIds = computed<string[]>(
    () => this.state.draftSheet()?.spellcasting[0]?.known ?? [],
  );

  // Outstanding-empty + invalidDecisions-empty guard (task-9-brief.md: "verify the review surfaces
  // WHY it's blocked"). `CreateWizardState.curatedChoiceSteps` already unions exactly the
  // outstanding-or-invalidly-decided choiceIds into `state.steps()`'s 'choice'-kind entries (see
  // its own class doc — a choiceId is never both outstanding and invalid at once, so this is never
  // a double-count), so filtering `steps()` down to 'choice' entries recovers precisely the set of
  // decisions still blocking `complete()` — no separate outstanding/invalid bookkeeping needed
  // here. A blank name blocks completion too (`complete()`'s own first-line check) but never has
  // its own curated step entry, so it's prepended by hand.
  protected readonly blockedStepLabels = computed<(PromptLabel & { id: string })[]>(() => {
    const localizer = this.engineFacade.localizer();
    const labels: (PromptLabel & { id: string })[] = [];
    if (this.state.name().trim().length === 0) {
      labels.push({ id: 'name', promptText: '', promptKey: NAME_FALLBACK_LABEL_KEY });
    }
    for (const step of this.state.steps()) {
      if (step.kind !== 'choice' || step.choiceId === undefined) continue;
      labels.push({ id: step.id, ...this.promptFor(step.choiceId, localizer) });
    }
    return labels;
  });

  protected onNameInput(value: string): void {
    this.state.name.set(value);
  }

  protected onNameBlur(): void {
    this.nameTouched.set(true);
  }

  protected onGenderChange(value: GrammaticalGender): void {
    this.state.gender.set(value);
  }

  protected onStepSelected(id: string): void {
    this.activeStepId.set(id);
  }

  protected back(): void {
    const idx = this.currentIndex();
    const steps = this.state.steps();
    if (idx > 0) this.activeStepId.set(steps[idx - 1].id);
  }

  protected next(): void {
    const idx = this.currentIndex();
    const steps = this.state.steps();
    if (idx >= 0 && idx < steps.length - 1) this.activeStepId.set(steps[idx + 1].id);
  }

  protected itemName(entry: Sheet['inventory'][number]): string {
    return entry.itemId
      ? this.engineFacade.localizer().name(entry.itemId)
      : (entry.name ?? entry.instanceId);
  }

  protected spellName(id: string): string {
    return this.engineFacade.localizer().name(id);
  }

  // `Localizer.choicePrompt(choiceId)` resolves every REAL (`Choice`-entity-backed) creation/
  // level choice; only the synthetic `<classId>@1/skills` id (no backing `Choice` — see
  // `CreateWizardState`'s own `curatedChoiceSteps` doc) and the 'name' pseudo-step (no choiceId at
  // all) fall through to a translation-key fallback (`PromptLabel`'s doc).
  private promptFor(choiceId: string, localizer: Localizer): PromptLabel {
    const promptText = localizer.choicePrompt(choiceId).text;
    if (promptText) return { promptText };
    if (choiceId.endsWith(SKILLS_SUFFIX))
      return { promptText: '', promptKey: SKILLS_FALLBACK_LABEL_KEY };
    // Last resort — every real creation/level choice in 1b's content scope carries a `prompt`, so
    // this only guards a future pack that doesn't; the raw id is at least never blank.
    return { promptText: choiceId };
  }

  // Formats one decision's selected values for display (task-9-brief.md's "localized selection"
  // half of each review row): the synthetic class-skills choice maps each raw skill slug to its
  // entity id (mirrors `choice-step.component.ts`'s own skill-option resolution) and localizes it;
  // every other choice resolves a full entity id straight off the index, recognizes an ability
  // token (`str:+2` / `str:15` — the `abilities`/`abilityGeneration` picks' own selection shape;
  // see `ABILITY_VALUE_RE`) into a structured `SelectionPart`, and otherwise passes the raw value
  // through as-is (a `literal` pick's free-text entry, e.g. weapon-masteries — never an entity id,
  // nothing to resolve).
  private formatSelectionParts(
    choiceId: string,
    selection: string[],
    index: ContentIndex,
    localizer: Localizer,
  ): SelectionPart[] {
    if (choiceId.endsWith(SKILLS_SUFFIX)) {
      const parsed = parseChoiceId(choiceId);
      const classId = parsed
        ? (index.resolveClassRef(parsed.entityId) ?? parsed.entityId)
        : undefined;
      const packId = classId ? parseEntityId(classId)?.packId : undefined;
      return selection.map((slug): SelectionPart => {
        const skillId = packId ? makeEntityId(packId, 'skill', slug) : undefined;
        const text = skillId && index.has(skillId) ? localizer.name(skillId) : slug;
        return { kind: 'text', text };
      });
    }

    return selection.map((value): SelectionPart => {
      if (index.has(value)) return { kind: 'text', text: localizer.name(value) };
      const match = ABILITY_VALUE_RE.exec(value);
      if (match) {
        const ability = this.abilityLabel(match[1], index, localizer);
        const raw = match[2];
        return raw.startsWith('+')
          ? { kind: 'abilityDelta', ability, delta: Number(raw) }
          : { kind: 'abilityScore', ability, value: Number(raw) };
      }
      return { kind: 'text', text: value };
    });
  }

  // Same "resolve by ability abbreviation, fall back to the raw key uppercased" convention as
  // `AbilityScoresStepComponent`/`AbilitiesImproveStepComponent`'s own private `abilityName`.
  private abilityLabel(key: string, index: ContentIndex, localizer: Localizer): string {
    const entity = index
      .byType('ability')
      .find((e) => e.type === 'ability' && e.abbreviation === key);
    return entity ? localizer.name(entity.id) : key.toUpperCase();
  }

  protected async onCreate(): Promise<void> {
    if (!this.complete() || this.creating()) return;
    this.creating.set(true);
    // Tracks whether `create()` itself succeeded, so the catch block below knows whether a
    // name-only stub character stream actually exists to clean up.
    let createdId: string | undefined;
    try {
      const id = await this.characterStore.create(this.state.name().trim(), this.state.gender());
      createdId = id;
      const [, ...rest] = this.state.buildTransaction();
      if (rest.length > 0) await this.characterStore.appendTx(rest);
      await this.router.navigate(['/c', id, 'play']);
    } catch (error) {
      // Whole-branch review finding 2: if `appendTx` fails after `create()` already succeeded
      // (leadership lost between the two calls, a storage error, …), the stream `create()` wrote
      // would otherwise persist as a name-only stub with no decisions — and a retry mints a SECOND
      // stream on top of it. Best-effort delete it before surfacing the failure so no stub
      // survives; this is itself allowed to fail silently (e.g. leadership already lost) since the
      // toast below is the only outcome the user needs to see either way.
      if (createdId !== undefined) {
        await this.characterStore.deleteCharacter(createdId).catch(() => undefined);
      }
      const key =
        error instanceof CharacterStoreNotLeaderError ? error.code : GENERIC_CREATE_FAILURE_KEY;
      this.toastService.show(key);
    } finally {
      this.creating.set(false);
    }
  }
}
