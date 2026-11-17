import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { ContentIndex, Localizer, Sheet } from '@hk/engine';
import { makeEntityId, parseChoiceId, parseEntityId, ShortTextSchema } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { IconComponent } from '@shared/icons/icon.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { provideEngineScope } from '@shared/services/engine/engine-scope.providers';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { CharacterStore, CharacterStoreNotLeaderError } from '@shared/stores/character.store';
import { DialogService } from '../../../ui/dialog/dialog.service';
import { FlowController } from '../../../ui/flow/flow-controller';
import { NavHistoryService } from '../../../ui/nav/nav-history.service';
import { phoneLayout } from '../../../ui/shell/viewport';
import { HkAbilitySealComponent } from '../../../ui/ability-seal/ability-seal.component';
import { HkStepperComponent } from '../../../ui/stepper/stepper.component';
import { HkTooltipDirective } from '../../../ui/tooltip/tooltip.directive';
import {
  compareWizardSteps,
  holdsWhenAnswered,
  isRequiredStep,
  type WizardStep,
} from '../flow/steps';
import { CancelWizardDialogComponent } from './cancel-wizard-dialog.component';
import { WizardFlowChrome } from './create-wizard.flow';
import { CreateWizardState } from './create-wizard.state';
import { PickerToolsService } from './picker-tools.service';
import { ChoiceStepComponent } from './steps/choice-step.component';
import { GENDER_OPTIONS, NameStepComponent } from './steps/name-step.component';
import { EquipmentStepComponent } from './steps/equipment-step.component';
import { SpellsStepComponent } from './steps/spells-step.component';

// The R5 synthetic `<classId>@1/skills` decision (task-9-brief.md, mirrors `choice-step.
// component.ts`'s own local `SKILLS_SUFFIX`) has no backing `Choice` entity, so
// `Localizer.choicePrompt` can't resolve a prompt for it — the review falls back to the step's own
// label key instead. Same fallback shape for 'name' — reachable only when the review is viewed
// before a name has been entered. Both are RELATIVE keys (no 'characters.' prefix) — unlike
// `WizardStep.labelKey` (resolved by `tr()`, see this component's `GENDER_OPTIONS` comment
// above), these are read by THIS component's own SCOPED `t()`
// (`*transloco="let t; read: 'characters'"`), which auto-prepends the scope itself.
const SKILLS_SUFFIX = '@1/skills';
const SKILLS_FALLBACK_LABEL_KEY = 'wizard.steps.classSkills';
const NAME_FALLBACK_LABEL_KEY = 'wizard.steps.name';

const GENERIC_CREATE_FAILURE_KEY = 'characters.wizard.review.toast.createFailed';

/** Where Cancel returns to when the user has no earlier screen in this session. */
const CANCEL_FALLBACK = ['/characters'] as const;

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
 * `CreateWizardState` as a COMPONENT provider (a fresh draft per visit, never shared/root), shows
 * its engine-derived steps in `hk-stepper` and implements the 'name' step and the 'review' step
 * itself.
 *
 * Navigation is the shared `FlowController` (plan 17): Next, Back, Cancel and the review's Edit
 * links go through it, and the controls live in the action strap (Cancel · Back | Next, which reads
 * "Create hero" on the review) rather than in a footer of this screen. The URL carries the step
 * (`?step=<id>`), written with `Location.replaceState` so a step change never becomes a router
 * navigation (it would clear the strap and close an open description).
 */
@Component({
  selector: 'app-create-wizard',
  imports: [
    TranslocoDirective,
    HkAbilitySealComponent,
    HkStepperComponent,
    IconComponent,
    HkTooltipDirective,
    ChoiceStepComponent,
    NameStepComponent,
    SpellsStepComponent,
    EquipmentStepComponent,
  ],
  // Plan 15 Task 4: the wizard state doubles as the `EngineScope` of a component-level
  // `EngineFacade`, so every step resolves against the draft's core + checked content packs.
  providers: [
    CreateWizardState,
    provideEngineScope(CreateWizardState),
    provideTranslocoScope('characters'),
    PickerToolsService,
  ],
  templateUrl: './create-wizard.component.html',
  styleUrl: './create-wizard.component.scss',
})
export class CreateWizardComponent {
  protected readonly state = inject(CreateWizardState);
  private readonly characterStore = inject(CharacterStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toastService = inject(ToastService);

  protected readonly genderOptions = GENDER_OPTIONS;

  private readonly dialog = inject(DialogService);
  private readonly navHistory = inject(NavHistoryService);

  protected readonly phone = phoneLayout();

  protected readonly creating = signal(false);

  protected readonly nameValid = computed(
    () => ShortTextSchema.safeParse(this.state.name().trim()).success,
  );

  /** Anything entered or chosen: Cancel asks before throwing it away. */
  private readonly dirty = computed(
    () =>
      this.state.name().trim().length > 0 ||
      this.state.decisions().size > 0 ||
      this.state.selectedPacks().size > 0 ||
      this.state.extraDrafts().length > 0,
  );

  /** Ids of the choice steps whose decision is missing or not acceptable yet. */
  private readonly unansweredChoiceIds = computed(
    () => new Set(this.state.steps().flatMap((step) => (step.choiceId ? [step.choiceId] : []))),
  );

  /**
   * Walks the steps for Next / Back / Edit. `allSteps` is the whole flow (answered steps keep their
   * place), `steps` what is still to do. A step answered while open moves the flow on, except the
   * ability scores (built over several edits, so the user decides when to leave it).
   */
  protected readonly flow = new FlowController<WizardStep>({
    all: this.state.allSteps,
    remaining: this.state.steps,
    compare: compareWizardSteps,
    isRequired: isRequiredStep,
    holdsWhenAnswered,
    canAdvance: (step) => this.isStepFinished(step),
    dirty: this.dirty,
    confirmLeave: async () => (await this.dialog.open(CancelWizardDialogComponent).closed) === true,
    leave: () => this.navHistory.back(CANCEL_FALLBACK),
  });

  protected readonly currentStep = this.flow.current;

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

  /** The six scores as seals, in the system's own ability order. */
  protected readonly abilitySeals = computed(() => {
    const sheet = this.state.draftSheet();
    if (!sheet) return [];
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    return index.system().abilities.flatMap((ability) => {
      const block = sheet.abilities[ability.id];
      if (!block) return [];
      return [
        {
          id: ability.id,
          name: this.abilityLabel(ability.id, index, localizer),
          score: block.score.value,
          modifier: block.mod,
          save: block.save.value,
          saveProficient: block.saveProficient,
        },
      ];
    });
  });

  protected readonly selectedPackNames = computed(() =>
    this.state
      .installedContent()
      .filter((pack) => this.state.isPackSelected(pack))
      .map((pack) => pack.name)
      .join(', '),
  );

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

  /** The already-answered choice steps' answers as short text, for the stepper ("Human"). */
  private readonly stepSummaries = computed(() => {
    const summaries = new Map<string, string>();
    for (const decision of this.decisionSummaries()) {
      const text = decision.parts
        .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
        .join(', ');
      if (text) summaries.set(decision.choiceId, text);
    }
    return summaries;
  });

  /** The stepper's items, the strap, the top bar and the `?step=` URL (see `WizardFlowChrome`). */
  private readonly chrome = new WizardFlowChrome({
    flow: this.flow,
    summaries: this.stepSummaries,
    complete: this.complete,
    creating: this.creating,
    create: () => void this.onCreate(),
  });

  protected readonly stepItems = this.chrome.stepItems;

  constructor() {
    // The draft lives in memory, so a deep link past the name step (a fresh load of `?step=review`
    // or a picker step) has nothing to show: such a link opens the name step.
    if (this.state.name().trim().length > 0) {
      this.flow.restore(this.route.snapshot.queryParamMap.get('step'));
    }
    this.state.campaignId.set(this.route.snapshot.queryParamMap.get('campaign') ?? undefined);
  }

  /** Next may leave a step once it is answered: a valid name, a choice with an acceptable decision.
   * The free-form steps (spells, equipment) and the review are never blocking. */
  private isStepFinished(step: WizardStep): boolean {
    if (step.kind === 'name') return this.nameValid();
    if (step.kind === 'choice' && step.choiceId !== undefined) {
      return !this.unansweredChoiceIds().has(step.choiceId);
    }
    return true;
  }

  /** Edit on a review group that is not a decision (equipment, spells). */
  protected onEditStep(id: string): void {
    if (this.state.allSteps().some((step) => step.id === id)) {
      this.flow.go(id, { returnTo: 'review' });
    }
  }

  /** The review's Edit link: jump to the step, and Next brings the user back to the review. */
  protected onEdit(choiceId: string | null): void {
    const id = this.editStepId(choiceId);
    if (id) this.flow.go(id, { returnTo: 'review' });
  }

  /** Id of the step that holds a decision (`null`: the name step). */
  protected editStepId(choiceId: string | null): string | undefined {
    if (choiceId === null) return 'name';
    return this.state.allSteps().find((step) => step.choiceId === choiceId)?.id;
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
  // through as-is (a `literal` pick's free-text entry — never an entity id, nothing to resolve;
  // task 8, phase 4 plan 11: weapon-masteries used to be this overlay's one real-pack example but is
  // now a real `query` pick, so its selections resolve as full entity ids like any other).
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
    // Plan-5 ruling R12: set true the instant the transaction itself has landed — a LATER failure
    // (only `router.navigate` remains after this point) means the character is fully valid and
    // committed, not a stub; the catch below must never delete it just because navigation failed.
    let appendTxSucceeded = false;
    try {
      const id = await this.characterStore.create(this.state.name().trim(), this.state.gender());
      createdId = id;
      const [, ...rest] = this.state.buildTransaction();
      if (rest.length > 0) await this.characterStore.appendTx(rest);
      appendTxSucceeded = true;
      await this.navigateAfterCreate(id);
    } catch (error) {
      // Whole-branch review finding 2: if `appendTx` fails after `create()` already succeeded
      // (leadership lost between the two calls, a storage error, …), the stream `create()` wrote
      // would otherwise persist as a name-only stub with no decisions — and a retry mints a SECOND
      // stream on top of it. Best-effort delete it before surfacing the failure so no stub
      // survives; this is itself allowed to fail silently (e.g. leadership already lost) since the
      // toast below is the only outcome the user needs to see either way. Ruling R12: once
      // `appendTxSucceeded` is true, the failure can only be `router.navigate` rejecting — the
      // character itself is fully committed, so it must NOT be deleted; the toast below still
      // fires either way, since the user needs to know navigation didn't happen.
      if (createdId !== undefined && !appendTxSucceeded) {
        await this.characterStore.deleteCharacter(createdId).catch(() => undefined);
      }
      const key =
        error instanceof CharacterStoreNotLeaderError ? error.code : GENERIC_CREATE_FAILURE_KEY;
      this.toastService.show(key);
    } finally {
      this.creating.set(false);
    }
  }

  /**
   * Plan-10 task-7-brief.md: "create-new via the wizard then return (returnUrl-style
   * back-navigation to the join flow — reuse T6's returnUrl pattern)". Mirrors
   * `LoginComponent.onSubmit`'s exact validation (`login.component.ts`, task-6-brief.md): a
   * `?returnUrl=` query param is honored ONLY when it is same-app-relative (`startsWith('/')`,
   * rejecting a protocol-relative `//host/...` value) — defense in depth only, since
   * `Router.navigateByUrl` already can't leave the SPA for an absolute/external URL. Falls back to
   * the wizard's ordinary `/c/<id>/play` destination otherwise, so every pre-existing caller (a
   * plain `/characters/new` visit, no query param at all) is unaffected. */
  private async navigateAfterCreate(id: string): Promise<void> {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//')) {
      await this.router.navigateByUrl(returnUrl);
      return;
    }
    await this.router.navigate(['/c', id, 'play']);
  }
}
