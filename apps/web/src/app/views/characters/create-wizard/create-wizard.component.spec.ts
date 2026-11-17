import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { createContentIndex, derive, reduce, type SystemRules } from '@hk/engine';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { ToastService } from '@shared/components/toast/toast.service';
import { ActionStrapService } from '../../../ui/action-strap/action-strap.service';
import { DialogService } from '../../../ui/dialog/dialog.service';
import { NavHistoryService } from '../../../ui/nav/nav-history.service';
import { TopBarService } from '../../../ui/shell/top-bar.service';
import { press } from '../../../ui/testing/harness';
import { stubViewport } from '../../../ui/testing/viewport';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { PackStore } from '@shared/stores/pack.store';
import { CharacterStore } from '@shared/stores/character.store';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import charactersRu from '../../../../assets/i18n/characters/ru.json';
import charactersUk from '../../../../assets/i18n/characters/uk.json';
import shellEn from '../../../../assets/i18n/shell/en.json';
import shellRu from '../../../../assets/i18n/shell/ru.json';
import shellUk from '../../../../assets/i18n/shell/uk.json';
import sampleJson from '../../../../testing/fixtures/packs/sample-content.json';
import { CreateWizardComponent } from './create-wizard.component';
import { CreateWizardState } from './create-wizard.state';
import { CAMPAIGN_ID, describedBy, seedCampaign } from '../sheet/testing/character-fixtures';

// Real built SRD pack (task-2-brief.md's "prefer the real pack" ruling) — `pretest`
// (apps/web/package.json) builds it before this file ever runs.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..', '..', '..');

function readPack(path: string): Pack {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = parsePack(raw);
  if (!result.ok) {
    throw new Error(
      `fixture pack at ${path} failed validation: ${result.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return result.pack;
}

const corePack = readPack(
  join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
);

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    if (langPath === 'characters/en') return of(charactersEn);
    if (langPath === 'characters/ru') return of(charactersRu);
    if (langPath === 'characters/uk') return of(charactersUk);
    if (langPath === 'shell/en') return of(shellEn);
    if (langPath === 'shell/ru') return of(shellRu);
    if (langPath === 'shell/uk') return of(shellUk);
    return of({});
  }
}

function configure(packs: Pack[] = [corePack]): {
  create: ReturnType<typeof vi.fn>;
  appendTx: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn().mockResolvedValue('char:00000000-0000-7000-8000-000000000099');
  const appendTx = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideTransloco({
        config: {
          availableLangs: ['en', 'ru', 'uk'],
          defaultLang: 'en',
          fallbackLang: 'en',
          reRenderOnLangChange: true,
          prodMode: true,
        },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
      {
        provide: PackStore,
        useValue: { packs: signal(packs), ready: signal(true), corePack: signal(corePack) },
      },
      { provide: CharacterStore, useValue: { create, appendTx } },
    ],
  });
  return { create, appendTx };
}

/** The stepper's step names, in order (one entry per step, answered ones included). */
function stepLabels(fixture: { nativeElement: unknown }): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('.hk-stepper__step'),
  ).map((el) => (el.querySelector('.hk-stepper__name') ?? el).textContent?.trim() ?? '');
}

/** The name of the step the wizard is on, as the stepper marks it. */
function currentLabel(fixture: { nativeElement: unknown }): string | undefined {
  const current = (fixture.nativeElement as HTMLElement).querySelector(
    '.hk-stepper__step--current',
  );
  return (current?.querySelector('.hk-stepper__name') ?? current)?.textContent?.trim();
}

/** A strap action the wizard has set (the strap itself is rendered by the app shell). */
function strapAction(id: string) {
  const config = TestBed.inject(ActionStrapService).config();
  return [...(config?.exit ?? []), ...(config?.primary ?? []), ...(config?.secondary ?? [])].find(
    (a) => a.id === id,
  );
}

async function pressStrap(fixture: { whenStable(): Promise<unknown> }, id: string): Promise<void> {
  const action = strapAction(id);
  expect(action, `strap action ${id}`).toBeDefined();
  action!.run();
  await fixture.whenStable();
}

/** The Create slot: the strap's `next` action once it reads "Create hero" (the review step). */
function createAction() {
  const action = strapAction('next');
  return action?.label === 'shell.strap.create-hero' ? action : undefined;
}

const norm = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

/** Zips `.create-wizard__decisions`'s flat `dt, dd, dt, dd, …` list into `{ prompt, selection }`
 * pairs (whitespace-normalized — the template's multi-line `@switch` per selection part leaves
 * incidental newlines/indentation in `dd`'s `textContent`, irrelevant to what's actually rendered). */
function decisionPairs(fixture: {
  nativeElement: unknown;
}): { prompt: string; selection: string }[] {
  const root = fixture.nativeElement as HTMLElement;
  const dts = Array.from(root.querySelectorAll('.create-wizard__decisions dt'));
  const dds = Array.from(root.querySelectorAll('.create-wizard__decisions dd'));
  return dts.map((dt, i) => ({
    prompt: norm(dt.textContent),
    selection: norm(dds[i]?.textContent),
  }));
}

/** Public-API-only navigation: runs the strap's Next action until the review step is current (or
 * gives up after a generous bound — a real stall fails loudly instead of hanging). Exercises the
 * exact same `canNext`/`next()` path a real user would, so every step on the way must already be
 * answered (Next is disabled on an unanswered choice). */
async function advanceToReview(fixture: {
  nativeElement: unknown;
  whenStable(): Promise<unknown>;
}): Promise<void> {
  for (let i = 0; i < 20 && currentLabel(fixture) !== 'Review'; i++) {
    const next = strapAction('next');
    if (!next || next.disabled) break;
    next.run();
    await fixture.whenStable();
  }
}

/** Opens the review step directly, for the specs that look at an INCOMPLETE draft there: the
 * strap's Next never gets past an unanswered choice, so no user path leads to a half-answered
 * review. Goes through the wizard's own flow controller (the same one Next and the stepper use). */
async function openReview(fixture: {
  componentInstance: unknown;
  whenStable(): Promise<unknown>;
}): Promise<void> {
  (fixture.componentInstance as { flow: { go(id: string): void } }).flow.go('review');
  await fixture.whenStable();
}

/** Same fixture-1 (human fighter) decision set the "creating navigates to /c/<id>/play" test
 * builds by hand — factored out so the plan-10 task-7 `?returnUrl=` tests (which only care about
 * WHERE `onCreate` navigates, not the decisions themselves) don't have to repeat it. */
function fillValidDecisions(state: CreateWizardState): void {
  state.name.set('Aldric');
  state.gender.set('masculine');
  state.setDecision('srd-5e-2024:system/5e-2024@0/species', ['srd-5e-2024:species/human']);
  state.setDecision('srd-5e-2024:system/5e-2024@0/background', ['srd-5e-2024:background/soldier']);
  state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
  state.setDecision('srd-5e-2024:background/soldier@0/tools', ['srd-5e-2024:item/gaming-set-dice']);
  state.setDecision(
    'srd-5e-2024:system/5e-2024@0/ability-scores',
    ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
    { method: 'standardArray' },
  );
  state.setDecision('srd-5e-2024:system/5e-2024@0/class', ['srd-5e-2024:class/fighter']);
  state.setDecision('srd-5e-2024:class/fighter@1/skills', ['athletics', 'perception']);
  state.setDecision('srd-5e-2024:class/fighter@1/fighting-style', ['srd-5e-2024:feat/defense']);
  // Task 8 (phase 4 plan 11): weapon-masteries' pick is now a real query over item entities
  // (T6 carry closed), not a `literal: 'text'` free-text placeholder. Fix round 1: count is 3.
  state.setDecision('srd-5e-2024:class/fighter@1/weapon-masteries', [
    'srd-5e-2024:item/longsword',
    'srd-5e-2024:item/shortsword',
    'srd-5e-2024:item/dagger',
  ]);
}

describe('CreateWizardComponent', () => {
  let create: ReturnType<typeof vi.fn>;
  let appendTx: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ create, appendTx } = configure());
  });

  it('renders the stepper with the initial derived steps: Name and Review only', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();

    expect(stepLabels(fixture)).toEqual(['Name', 'Review']);
  });

  it('the create button is disabled while the draft is incomplete', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '.name-step__name-input input',
    );
    input!.value = 'Aldric';
    input!.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    await openReview(fixture);

    const create = createAction();
    expect(create).toBeDefined();
    expect(create?.disabled).toBe(true);
  });

  it('typing a name grows the stepper with the system creation-choice steps', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '.name-step__name-input input',
    );
    input!.value = 'Aldric';
    input!.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(stepLabels(fixture)).toEqual([
      'Name',
      'Species',
      'Background',
      'Class',
      'Ability scores',
      'Class choices',
      'Equipment',
      'Review',
    ]);
  });

  it('re-homes the active step when its own decision is set without navigating away first', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const root = () => fixture.nativeElement as HTMLElement;

    const input = root().querySelector<HTMLInputElement>('.name-step__name-input input');
    input!.value = 'Aldric';
    input!.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    // Navigate to 'species' via the strap's Next (name -> species).
    await pressStrap(fixture, 'next');
    expect(currentLabel(fixture)).toBe('Species');

    // A future species-step component (T6) would call `setDecision` here without itself calling
    // `next()` first — species is now decided while it is still the ACTIVE step, so it vanishes
    // from `state.steps()` out from under `activeStepId`.
    const state = fixture.debugElement.injector.get(CreateWizardState);
    state.setDecision('srd-5e-2024:system/5e-2024@0/species', ['srd-5e-2024:species/human']);
    await fixture.whenStable();

    // Re-homed to whatever now sits at species' own former ordinal position — 'background', which
    // shifted left into that slot — not stranded, and the footer works in both directions again.
    expect(currentLabel(fixture)).toBe('Background');
    expect(strapAction('back')?.disabled).toBeFalsy();

    // Back is not inert: it returns to the step the user just answered (it is still reachable even
    // though it left the list of steps to do), and from there to the name.
    await pressStrap(fixture, 'back');
    expect(currentLabel(fixture)).toBe('Species');
    await pressStrap(fixture, 'back');
    expect(currentLabel(fixture)).toBe('Name');
  });

  it('re-homes a count-2 pick answered one toggle at a time onto the next unanswered choice, not past it (rogue Expertise -> Weapon Masteries)', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const root = () => fixture.nativeElement as HTMLElement;
    const title = () => norm(root().querySelector('.choice-step__title')?.textContent);
    const expertise = 'srd-5e-2024:class/rogue@1/expertise';

    const state = fixture.debugElement.injector.get(CreateWizardState);
    state.name.set('Vessa');
    state.setDecision('srd-5e-2024:system/5e-2024@0/species', ['srd-5e-2024:species/human']);
    state.setDecision('srd-5e-2024:system/5e-2024@0/background', [
      'srd-5e-2024:background/soldier',
    ]);
    state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
    state.setDecision('srd-5e-2024:background/soldier@0/tools', [
      'srd-5e-2024:item/gaming-set-dice',
    ]);
    state.setDecision(
      'srd-5e-2024:system/5e-2024@0/ability-scores',
      ['str:8', 'dex:15', 'con:13', 'int:12', 'wis:10', 'cha:14'],
      { method: 'standardArray' },
    );
    state.setDecision('srd-5e-2024:system/5e-2024@0/class', ['srd-5e-2024:class/rogue']);
    state.setDecision('srd-5e-2024:class/rogue@1/skills', [
      'stealth',
      'acrobatics',
      'deception',
      'sleight-of-hand',
    ]);
    await fixture.whenStable();

    // name -> the first remaining choice step: Expertise (sorted before weapon-masteries).
    await pressStrap(fixture, 'next');
    expect(title()).toContain('Expertise');

    // The choice step commits per toggle: first toggle -> decided-but-invalid (count 1 of 2).
    state.setDecision(expertise, ['srd-5e-2024:skill/stealth']);
    await fixture.whenStable();
    expect(title()).toContain('Expertise');

    // Second toggle completes it: the step vanishes and the wizard must land on Weapon Masteries.
    state.setDecision(expertise, [
      'srd-5e-2024:skill/stealth',
      'srd-5e-2024:skill/sleight-of-hand',
    ]);
    await fixture.whenStable();
    expect(root().querySelector('.equipment-step')).toBeNull();
    expect(title()).toBe('Weapon Masteries');
  });

  it('the create button becomes enabled once every outstanding choice is decided, and creating navigates to /c/<id>/play', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    // The wizard-state service is component-provided, not root — reach THIS component's instance
    // through its own injector (T6-9's real species/background/etc. steps will call the same
    // `setDecision` through their own template bindings; this stands in for that UI).
    const state = fixture.debugElement.injector.get(CreateWizardState);
    state.name.set('Aldric');
    state.gender.set('masculine');
    state.setDecision('srd-5e-2024:system/5e-2024@0/species', ['srd-5e-2024:species/human']);
    state.setDecision('srd-5e-2024:system/5e-2024@0/background', [
      'srd-5e-2024:background/soldier',
    ]);
    state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
    state.setDecision('srd-5e-2024:background/soldier@0/tools', [
      'srd-5e-2024:item/gaming-set-dice',
    ]);
    state.setDecision(
      'srd-5e-2024:system/5e-2024@0/ability-scores',
      ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
      { method: 'standardArray' },
    );
    state.setDecision('srd-5e-2024:system/5e-2024@0/class', ['srd-5e-2024:class/fighter']);
    state.setDecision('srd-5e-2024:class/fighter@1/skills', ['athletics', 'perception']);
    state.setDecision('srd-5e-2024:class/fighter@1/fighting-style', ['srd-5e-2024:feat/defense']);
    // Task 8 (phase 4 plan 11): weapon-masteries' pick is now a real query over item entities
    // (T6 carry closed), not a `literal: 'text'` free-text placeholder. Fix round 1: count is 3.
    state.setDecision('srd-5e-2024:class/fighter@1/weapon-masteries', [
      'srd-5e-2024:item/longsword',
      'srd-5e-2024:item/shortsword',
      'srd-5e-2024:item/dagger',
    ]);
    await fixture.whenStable();

    expect(state.outstanding()).toEqual([]);

    await advanceToReview(fixture);
    const button = createAction();
    expect(button).toBeDefined();
    expect(button?.disabled).toBeFalsy();
    // The review skeleton's gender row resolves the SCOPED gender label key correctly (no
    // double-prefixed 'characters.characters....' lookup miss).
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Masculine');

    button!.run();
    await fixture.whenStable();

    expect(create).toHaveBeenCalledWith('Aldric', 'masculine');
    expect(appendTx).toHaveBeenCalledTimes(1);
    const drafts = appendTx.mock.calls[0][0] as { type: string }[];
    expect(drafts[0].type).toBe('decision.made');
    expect(drafts.some((d) => d.type === 'level.gained')).toBe(true);
    expect(navigateSpy).toHaveBeenCalledWith([
      '/c',
      'char:00000000-0000-7000-8000-000000000099',
      'play',
    ]);
  });

  it('honors a same-app-relative ?returnUrl instead of /c/<id>/play (plan-10 task-7: create-new-via-wizard-then-return)', async () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: {
          queryParamMap: convertToParamMap({
            returnUrl: '/g/00000000-0000-4000-8000-000000000001/link-character',
          }),
        },
      },
    });
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const navigateByUrlSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const state = fixture.debugElement.injector.get(CreateWizardState);
    fillValidDecisions(state);
    await fixture.whenStable();

    await advanceToReview(fixture);
    createAction()!.run();
    await fixture.whenStable();

    expect(navigateByUrlSpy).toHaveBeenCalledWith(
      '/g/00000000-0000-4000-8000-000000000001/link-character',
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('ignores a protocol-relative ?returnUrl ("//host/...") and falls back to /c/<id>/play', async () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: {
        snapshot: { queryParamMap: convertToParamMap({ returnUrl: '//evil.example/phish' }) },
      },
    });
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const navigateByUrlSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const state = fixture.debugElement.injector.get(CreateWizardState);
    fillValidDecisions(state);
    await fixture.whenStable();

    await advanceToReview(fixture);
    createAction()!.run();
    await fixture.whenStable();

    expect(navigateSpy).toHaveBeenCalledWith([
      '/c',
      'char:00000000-0000-7000-8000-000000000099',
      'play',
    ]);
    expect(navigateByUrlSpy).not.toHaveBeenCalled();
  });

  it('a decided-but-invalid choice (over-budget point buy) keeps its step visible and blocked, disables the create button, and is fixable by revisiting it', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const root = () => fixture.nativeElement as HTMLElement;

    const state = fixture.debugElement.injector.get(CreateWizardState);
    state.name.set('Aldric');
    state.setDecision('srd-5e-2024:system/5e-2024@0/species', ['srd-5e-2024:species/human']);
    state.setDecision('srd-5e-2024:system/5e-2024@0/background', [
      'srd-5e-2024:background/soldier',
    ]);
    state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
    state.setDecision('srd-5e-2024:background/soldier@0/tools', [
      'srd-5e-2024:item/gaming-set-dice',
    ]);
    // costs: 15 -> 9 (x5) + 8 -> 0 = 45, against a 27-point budget — over budget.
    state.setDecision(
      'srd-5e-2024:system/5e-2024@0/ability-scores',
      ['str:15', 'dex:15', 'con:15', 'int:15', 'wis:15', 'cha:8'],
      { method: 'pointBuy' },
    );
    state.setDecision('srd-5e-2024:system/5e-2024@0/class', ['srd-5e-2024:class/fighter']);
    state.setDecision('srd-5e-2024:class/fighter@1/skills', ['athletics', 'perception']);
    state.setDecision('srd-5e-2024:class/fighter@1/fighting-style', ['srd-5e-2024:feat/defense']);
    // Task 8 (phase 4 plan 11): weapon-masteries' pick is now a real query over item entities
    // (T6 carry closed), not a `literal: 'text'` free-text placeholder. Fix round 1: count is 3.
    state.setDecision('srd-5e-2024:class/fighter@1/weapon-masteries', [
      'srd-5e-2024:item/longsword',
      'srd-5e-2024:item/shortsword',
      'srd-5e-2024:item/dagger',
    ]);
    await fixture.whenStable();

    // The invalid ability-scores decision keeps its step and the stepper marks it invalid — visible
    // and clickable, unlike the steps still to do.
    expect(stepLabels(fixture)).toContain('Ability scores');
    const findStepButton = (label: string): HTMLButtonElement =>
      Array.from(root().querySelectorAll<HTMLButtonElement>('.hk-stepper__step')).find(
        (b) => b.querySelector('.hk-stepper__name')?.textContent?.trim() === label,
      )!;
    const abilityStepButton = findStepButton('Ability scores');
    expect(abilityStepButton.classList.contains('hk-stepper__step--invalid')).toBe(true);
    expect(abilityStepButton.getAttribute('aria-disabled')).toBeNull();

    await openReview(fixture);
    const createButton = createAction();
    expect(createButton).toBeDefined();
    expect(createButton?.disabled).toBe(true);

    // Revisit the blocked step directly from the stepper.
    press(findStepButton('Ability scores'));
    await fixture.whenStable();
    expect(currentLabel(fixture)).toBe('Ability scores');

    // Fix it: a valid standard-array selection.
    state.setDecision(
      'srd-5e-2024:system/5e-2024@0/ability-scores',
      ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
      { method: 'standardArray' },
    );
    await fixture.whenStable();

    // Answered, it is no longer invalid, and it stays where it is until the user moves on.
    expect(findStepButton('Ability scores').classList.contains('hk-stepper__step--invalid')).toBe(
      false,
    );
    expect(currentLabel(fixture)).toBe('Ability scores');
    await advanceToReview(fixture);
    expect(createAction()?.disabled).toBeFalsy();
  });

  it('the review lists every decision as a localized "prompt: selection" pair, plus items/spells summaries and HP/AC/proficiency bonus', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();

    const state = fixture.debugElement.injector.get(CreateWizardState);
    state.name.set('Ivan');
    state.gender.set('masculine');
    state.setDecision('srd-5e-2024:system/5e-2024@0/species', ['srd-5e-2024:species/human']);
    state.setDecision('srd-5e-2024:system/5e-2024@0/background', [
      'srd-5e-2024:background/soldier',
    ]);
    state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
    state.setDecision('srd-5e-2024:background/soldier@0/tools', [
      'srd-5e-2024:item/gaming-set-dice',
    ]);
    state.setDecision(
      'srd-5e-2024:system/5e-2024@0/ability-scores',
      ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
      { method: 'standardArray' },
    );
    state.setDecision('srd-5e-2024:system/5e-2024@0/class', ['srd-5e-2024:class/fighter']);
    state.setDecision('srd-5e-2024:class/fighter@1/skills', ['athletics', 'perception']);
    state.setDecision('srd-5e-2024:class/fighter@1/fighting-style', ['srd-5e-2024:feat/defense']);
    // Task 8 (phase 4 plan 11): weapon-masteries' pick is now a real query over item entities
    // (T6 carry closed), not a `literal: 'text'` free-text placeholder. Fix round 1: count is 3.
    state.setDecision('srd-5e-2024:class/fighter@1/weapon-masteries', [
      'srd-5e-2024:item/longsword',
      'srd-5e-2024:item/shortsword',
      'srd-5e-2024:item/dagger',
    ]);
    const chainMail = state.addItem('srd-5e-2024:item/chain-mail', 1);
    state.equipItem(chainMail);
    state.addItem('srd-5e-2024:item/longsword', 1); // added, deliberately left UNEQUIPPED
    await fixture.whenStable();

    await advanceToReview(fixture);
    const root = fixture.nativeElement as HTMLElement;

    const pairs = decisionPairs(fixture);
    const find = (prompt: string) => pairs.find((p) => p.prompt === prompt);
    expect(find('Species')?.selection).toBe('Human');
    expect(find('Background')?.selection).toBe('Soldier');
    expect(find('Ability score improvement')?.selection).toContain('Strength +2');
    expect(find('Ability score improvement')?.selection).toContain('Constitution +1');
    expect(find('Ability scores')?.selection).toContain('Strength 15');
    expect(find('Ability scores')?.selection).toContain('Charisma 8');
    expect(find('Fighting Style')?.selection).toBe('Defense');
    // Task 8: weapon-masteries is now a real query pick over item entities, so its selection
    // resolves through the index/localizer like any other entity-id decision (was the raw
    // literal-text string 'longsword' before the T6/T8 pick-shape swap). Fix round 1: count is
    // 3, so all three chosen weapons' localized names appear.
    expect(find('Weapon Masteries')?.selection).toContain('Longsword');
    expect(find('Weapon Masteries')?.selection).toContain('Shortsword');
    expect(find('Weapon Masteries')?.selection).toContain('Dagger');
    // The synthetic class-skills choice has no backing `Choice` entity — falls back to its own
    // step's label key ("Skills") rather than an empty `Localizer.choicePrompt`.
    const skillsPair = pairs.find((p) => p.prompt === 'Skills');
    expect(skillsPair?.selection).toContain('Athletics');
    expect(skillsPair?.selection).toContain('Perception');

    // Items: both the equipped chain mail and the unequipped (added-only) longsword are listed;
    // only the former is tagged "Equipped".
    const items = norm(root.querySelector('.create-wizard__items')?.textContent);
    expect(items).toContain('Chain Mail');
    expect(items).toContain('Equipped');
    expect(items).toContain('Longsword');

    const summary = norm(
      root.querySelector('.create-wizard__step.create-wizard__review')?.textContent,
    );
    expect(summary).toContain('12'); // hp
    // No shield in this scenario (deliberately, to also cover the unequipped-item case) — chain
    // mail (16, no dex — heavy armor) + Defense fighting style (+1) = 17, not the golden 19.
    expect(summary).toContain('17'); // ac
    expect(summary).toContain('Proficiency bonus'); // present in the summary at all
  });

  it('surfaces WHY the create button is blocked: lists the outstanding/invalid step prompts', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '.name-step__name-input input',
    );
    input!.value = 'Aldric';
    input!.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    await openReview(fixture);

    const outstanding = norm(
      (fixture.nativeElement as HTMLElement).querySelector('.create-wizard__outstanding')
        ?.textContent,
    );
    expect(outstanding).toContain('Species');
    expect(outstanding).toContain('Background');
    expect(outstanding).toContain('Class');
    expect(outstanding).toContain('Ability scores');
  });
});

// THE BINDING SPEC (task-9-brief.md's acceptance criterion): unlike every test above, this suite
// wires up the REAL `CharacterStore` over a real (fake-indexeddb-backed) `EventsRepository` —
// never the `{create, appendTx}` recorder stub `configure()` uses — so `onCreate()`'s two calls
// actually persist, and the assertions below replay a FRESH `byStream` + `reduce` + `derive` over
// exactly what landed, never the live in-memory `state`/`store` signals. Mirrors
// `character.store.spec.ts`'s own real-store TestBed setup.
describe('CreateWizardComponent — creation transaction (binding spec)', () => {
  const SYSTEM_ID = 'srd-5e-2024:system/5e-2024';

  function configureReal(): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTransloco({
          config: {
            availableLangs: ['en', 'ru', 'uk'],
            defaultLang: 'en',
            fallbackLang: 'en',
            reRenderOnLangChange: true,
            prodMode: true,
          },
          loader: StubLoader,
        }),
        provideTranslocoMessageformat(),
        {
          provide: PackStore,
          useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
        },
        {
          provide: StoragePersistService,
          useValue: { requestPersist: vi.fn().mockResolvedValue(true) },
        },
        { provide: ToastService, useValue: { show: vi.fn() } },
      ],
    });
  }

  beforeEach(async () => {
    configureReal();
    const db = TestBed.inject(HkDb);
    await Promise.all([
      db.events.clear(),
      db.settings.clear(),
      db.snapshots.clear(),
      db.characters.clear(),
    ]);
  });

  afterEach(() => {
    TestBed.inject(HkDb).close();
  });

  it("drives fighter-1's exact creation choices through to a real character.created + one shared-txId transaction, and a fresh replay derives hp 12 / ac 19 / prof 2", async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    // Global Constraints fixture line: soldier background, standard-array abilities, fighter class,
    // athletics/perception skills, Defense fighting style, a literal weapon-mastery pick, and
    // chain mail + longsword + shield all added AND equipped.
    const state = fixture.debugElement.injector.get(CreateWizardState);
    state.name.set('Ivan');
    state.gender.set('masculine');
    state.setDecision(`${SYSTEM_ID}@0/species`, ['srd-5e-2024:species/human']);
    state.setDecision(`${SYSTEM_ID}@0/background`, ['srd-5e-2024:background/soldier']);
    state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
    state.setDecision('srd-5e-2024:background/soldier@0/tools', [
      'srd-5e-2024:item/gaming-set-dice',
    ]);
    state.setDecision(
      `${SYSTEM_ID}@0/ability-scores`,
      ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
      { method: 'standardArray' },
    );
    state.setDecision(`${SYSTEM_ID}@0/class`, ['srd-5e-2024:class/fighter']);
    state.setDecision('srd-5e-2024:class/fighter@1/skills', ['athletics', 'perception']);
    state.setDecision('srd-5e-2024:class/fighter@1/fighting-style', ['srd-5e-2024:feat/defense']);
    // Task 8 (phase 4 plan 11): weapon-masteries' pick is now a real query over item entities
    // (T6 carry closed), not a `literal: 'text'` free-text placeholder. Fix round 1: count is 3.
    state.setDecision('srd-5e-2024:class/fighter@1/weapon-masteries', [
      'srd-5e-2024:item/longsword',
      'srd-5e-2024:item/shortsword',
      'srd-5e-2024:item/dagger',
    ]);

    const chainMail = state.addItem('srd-5e-2024:item/chain-mail', 1);
    state.equipItem(chainMail);
    const longsword = state.addItem('srd-5e-2024:item/longsword', 1);
    state.equipItem(longsword);
    const shield = state.addItem('srd-5e-2024:item/shield', 1);
    state.equipItem(shield);
    await fixture.whenStable();

    expect(state.outstanding()).toEqual([]);
    expect(state.invalidDecisions().size).toBe(0);
    // The draft itself already matches the plan-4 golden numbers before creation ever runs.
    expect(state.draftSheet()?.hp.max.value).toBe(12);
    expect(state.draftSheet()?.ac.value).toBe(19);
    expect(state.draftSheet()?.prof).toBe(2);

    await advanceToReview(fixture);
    const createButton = createAction();
    expect(createButton?.disabled).toBeFalsy();
    createButton!.run();
    // `onCreate()`'s `CharacterStore.create`/`appendTx` calls are real (unmocked) fake-indexeddb
    // promise chains — not tracked by Angular's zoneless stability system (same reasoning as
    // `characters-list.component.spec.ts`'s own `flushDeleteFlow`), so a single `whenStable()`
    // can resolve before they (and the `router.navigate` that follows them) actually settle. Poll
    // real macrotask turns until `navigate` has actually been called (or give up loudly).
    for (let i = 0; i < 50 && navigateSpy.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const navArgs = navigateSpy.mock.calls[0]?.[0] as [string, string, string];
    expect(navArgs[0]).toBe('/c');
    expect(navArgs[2]).toBe('play');
    const streamId = navArgs[1];

    // Fresh replay of exactly what got persisted — never the live `state`/`store` signals above.
    const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
    const index = createContentIndex([corePack]);
    const system = index.system();
    const rules: SystemRules = { restRules: system.restRules, hpRules: system.hpRules };
    const facts = reduce(persisted, undefined, rules);
    const sheet = derive(facts, index, rules);

    expect(sheet.hp.max.value).toBe(12);
    // Controller ruling R11: `buildTransaction()` now appends `hp.changed {delta: 12, kind:
    // 'set'}` right after `level.gained`, so the PERSISTED stream (unlike `draftSheet()`'s own
    // live preview above, which never includes that event — see `CreateWizardState.
    // buildTransaction`'s own doc) tops current HP up to max on creation.
    expect(sheet.hp.current).toBe(12);
    expect(sheet.ac.value).toBe(19);
    expect(sheet.prof).toBe(2);

    // `character.created` (the store's own `create()` call) carries no txId; every OTHER persisted
    // event (the `appendTx`-ed decisions/level.gained/extraDrafts) shares exactly one.
    const created = persisted.find((e) => e.type === 'character.created');
    expect(created?.txId).toBeUndefined();
    const rest = persisted.filter((e) => e.type !== 'character.created');
    expect(rest.length).toBeGreaterThan(0);
    const txIds = new Set(rest.map((e) => e.txId));
    expect(txIds.size).toBe(1);
    expect([...txIds][0]).toBeDefined();
  });

  // Plan 12 task 14: the generic wizard machinery handles a NEW (slice-2) class with no bespoke UI —
  // Monk: a non-caster (no spells step), whose only level-1 choice is its skills, and whose Focus
  // Points resource only exists from level 2 (`monk-monks-focus` is granted by the level-2 row).
  it('creates a Monk through the generic wizard: no spells step, no Focus pips at level 1, Focus pips (2) after leveling to 2', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const MONK = 'srd-5e-2024:class/monk';

    const state = fixture.debugElement.injector.get(CreateWizardState);
    state.name.set('Lin');
    state.gender.set('feminine');
    state.setDecision(`${SYSTEM_ID}@0/species`, ['srd-5e-2024:species/human']);
    state.setDecision(`${SYSTEM_ID}@0/background`, ['srd-5e-2024:background/soldier']);
    state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
    state.setDecision('srd-5e-2024:background/soldier@0/tools', [
      'srd-5e-2024:item/gaming-set-dice',
    ]);
    state.setDecision(
      `${SYSTEM_ID}@0/ability-scores`,
      ['str:10', 'dex:15', 'con:13', 'int:8', 'wis:14', 'cha:12'],
      { method: 'standardArray' },
    );
    state.setDecision(`${SYSTEM_ID}@0/class`, [MONK]);
    await fixture.whenStable();

    // Monk's level-1 choices are its skills and (plan 13 task 2) its one Artisan's Tools or Musical
    // Instrument: outstanding until picked, then nothing else.
    expect(state.outstanding().map((o) => o.choiceId)).toEqual([
      `${MONK}@1/skills`,
      `${MONK}@1/tools`,
    ]);
    state.setDecision(`${MONK}@1/skills`, ['acrobatics', 'insight']);
    state.setDecision(`${MONK}@1/tools`, ['srd-5e-2024:item/musical-instrument-flute']);
    await fixture.whenStable();
    expect(state.outstanding()).toEqual([]);
    expect(state.invalidDecisions().size).toBe(0);

    // No caster step anywhere in the derived stepper, and an empty spellcasting draft.
    expect(state.steps().some((s) => s.kind === 'spells')).toBe(false);
    expect(state.draftSheet()?.spellcasting).toEqual([]);
    expect(state.draftSheet()?.resources.some((r) => r.id === 'focus-points')).toBe(false);

    await advanceToReview(fixture);
    createAction()!.run();
    for (let i = 0; i < 50 && navigateSpy.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const streamId = (navigateSpy.mock.calls[0]?.[0] as [string, string, string])[1];

    const repo = TestBed.inject(EventsRepository);
    const index = createContentIndex([corePack]);
    const system = index.system();
    const rules: SystemRules = { restRules: system.restRules, hpRules: system.hpRules };
    const sheetOf = async () =>
      derive(reduce(await repo.byStream(streamId), undefined, rules), index, rules);

    const level1 = await sheetOf();
    expect(level1.classes).toEqual([expect.objectContaining({ classId: MONK, level: 1 })]);
    expect(level1.spellcasting).toEqual([]);
    expect(level1.resources.some((r) => r.id === 'focus-points')).toBe(false);

    // Level 2 (store-level, same engine path the level-up wizard commits): Focus appears, 2 points.
    await TestBed.inject(CharacterStore).load(streamId);
    await TestBed.inject(CharacterStore).appendTx([
      { type: 'level.gained', v: 1, payload: { classId: MONK, level: 2, hpRoll: 'average' } },
    ]);
    const level2 = await sheetOf();
    expect(level2.level).toBe(2);
    expect(level2.resources.find((r) => r.id === 'focus-points')?.max.value).toBe(2);
  });

  // Whole-branch review finding 2: `create()` succeeding followed by `appendTx` failing (leadership
  // lost between the two calls, a storage error, …) must not leave a name-only stub character
  // behind — `onCreate()`'s catch now best-effort `deleteCharacter`s the id `create()` returned
  // before showing the failure toast. Spies `deleteCharacter` (still calls through, so the delete
  // is real) AND asserts the stream's events are actually gone from the repository afterward.
  it('appendTx rejecting after create() succeeded deletes the stub character and still shows the failure toast', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const toastService = TestBed.inject(ToastService);
    const toastShowSpy = vi.spyOn(toastService, 'show');
    const characterStore = TestBed.inject(CharacterStore);
    const deleteSpy = vi.spyOn(characterStore, 'deleteCharacter');
    vi.spyOn(characterStore, 'appendTx').mockRejectedValueOnce(new Error('boom'));

    const state = fixture.debugElement.injector.get(CreateWizardState);
    state.name.set('Ivan');
    state.gender.set('masculine');
    state.setDecision(`${SYSTEM_ID}@0/species`, ['srd-5e-2024:species/human']);
    state.setDecision(`${SYSTEM_ID}@0/background`, ['srd-5e-2024:background/soldier']);
    state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
    state.setDecision('srd-5e-2024:background/soldier@0/tools', [
      'srd-5e-2024:item/gaming-set-dice',
    ]);
    state.setDecision(
      `${SYSTEM_ID}@0/ability-scores`,
      ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
      { method: 'standardArray' },
    );
    state.setDecision(`${SYSTEM_ID}@0/class`, ['srd-5e-2024:class/fighter']);
    state.setDecision('srd-5e-2024:class/fighter@1/skills', ['athletics', 'perception']);
    state.setDecision('srd-5e-2024:class/fighter@1/fighting-style', ['srd-5e-2024:feat/defense']);
    // Task 8 (phase 4 plan 11): weapon-masteries' pick is now a real query over item entities
    // (T6 carry closed), not a `literal: 'text'` free-text placeholder. Fix round 1: count is 3.
    state.setDecision('srd-5e-2024:class/fighter@1/weapon-masteries', [
      'srd-5e-2024:item/longsword',
      'srd-5e-2024:item/shortsword',
      'srd-5e-2024:item/dagger',
    ]);
    await fixture.whenStable();

    expect(state.outstanding()).toEqual([]);
    await advanceToReview(fixture);
    const createButton = createAction();
    expect(createButton?.disabled).toBeFalsy();
    createButton!.run();

    // Same "real fake-indexeddb promise chain, poll real macrotask turns" reasoning as the test
    // above — wait for the catch block to fully finish (its LAST action is the toast, after the
    // awaited `deleteCharacter` — polling on the toast avoids a race where `deleteSpy` already
    // recorded the call but its promise hasn't resolved yet).
    for (let i = 0; i < 50 && toastShowSpy.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    const deletedId = deleteSpy.mock.calls[0]?.[0];
    expect(toastShowSpy).toHaveBeenCalledTimes(1);

    // No stub character stream survives the failed creation.
    const persisted = await TestBed.inject(EventsRepository).byStream(deletedId);
    expect(persisted).toEqual([]);
  });

  // task-1-brief.md carry fix (plan-5 ruling R12): `create()`+`appendTx` BOTH succeeding, followed
  // by `router.navigate` itself rejecting (a routing error, an unrelated guard throwing, …), must
  // NOT be treated the same as an `appendTx` failure — the character is already fully valid and
  // persisted; deleting it here would destroy real, committed work over a purely navigational
  // failure. The catch must still surface the failure toast (the user needs to know `/c/<id>/play`
  // didn't load), but never call `deleteCharacter`, and the stream's events must still be there.
  it('router.navigate rejecting after create()+appendTx both succeeded keeps the character and still shows the failure toast', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const router = TestBed.inject(Router);
    const navigateSpy = vi
      .spyOn(router, 'navigate')
      .mockRejectedValueOnce(new Error('nav rejected'));
    const toastService = TestBed.inject(ToastService);
    const toastShowSpy = vi.spyOn(toastService, 'show');
    const characterStore = TestBed.inject(CharacterStore);
    const deleteSpy = vi.spyOn(characterStore, 'deleteCharacter');

    const state = fixture.debugElement.injector.get(CreateWizardState);
    state.name.set('Ivan');
    state.gender.set('masculine');
    state.setDecision(`${SYSTEM_ID}@0/species`, ['srd-5e-2024:species/human']);
    state.setDecision(`${SYSTEM_ID}@0/background`, ['srd-5e-2024:background/soldier']);
    state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
    state.setDecision('srd-5e-2024:background/soldier@0/tools', [
      'srd-5e-2024:item/gaming-set-dice',
    ]);
    state.setDecision(
      `${SYSTEM_ID}@0/ability-scores`,
      ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
      { method: 'standardArray' },
    );
    state.setDecision(`${SYSTEM_ID}@0/class`, ['srd-5e-2024:class/fighter']);
    state.setDecision('srd-5e-2024:class/fighter@1/skills', ['athletics', 'perception']);
    state.setDecision('srd-5e-2024:class/fighter@1/fighting-style', ['srd-5e-2024:feat/defense']);
    // Task 8 (phase 4 plan 11): weapon-masteries' pick is now a real query over item entities
    // (T6 carry closed), not a `literal: 'text'` free-text placeholder. Fix round 1: count is 3.
    state.setDecision('srd-5e-2024:class/fighter@1/weapon-masteries', [
      'srd-5e-2024:item/longsword',
      'srd-5e-2024:item/shortsword',
      'srd-5e-2024:item/dagger',
    ]);
    await fixture.whenStable();

    expect(state.outstanding()).toEqual([]);
    await advanceToReview(fixture);
    const createButton = createAction();
    expect(createButton?.disabled).toBeFalsy();
    createButton!.run();

    // Same "real fake-indexeddb promise chain, poll real macrotask turns" reasoning as the specs
    // above — wait for the catch block to fully finish (its last action is the toast).
    for (let i = 0; i < 50 && toastShowSpy.mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(toastShowSpy).toHaveBeenCalledTimes(1);

    // The character `create()` minted is still there — a rejected navigate is not a reason to wipe
    // a fully-committed stream.
    const navArgs = navigateSpy.mock.calls[0]?.[0] as [string, string, string];
    const streamId = navArgs[1];
    const persisted = await TestBed.inject(EventsRepository).byStream(streamId);
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted.some((e) => e.type === 'character.created')).toBe(true);
  });
});

// --- Plan 15 (phase 4 slice 5) Task 4: content packs on the first step -------------------------
describe('CreateWizardComponent — content packs (plan 15 Task 4)', () => {
  const parsedSample = parsePack(sampleJson);
  if (!parsedSample.ok) throw new Error('sample-content.json fixture no longer parses');
  const sample = parsedSample.pack;
  const root = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

  const pickerNames = (fixture: { nativeElement: unknown }): string[] =>
    Array.from(root(fixture).querySelectorAll('.hk-picker-card__name, .entity-picker__name')).map(
      (el) => el.textContent?.trim() ?? '',
    );

  async function openSpeciesStep(fixture: {
    nativeElement: unknown;
    whenStable(): Promise<unknown>;
  }): Promise<string[]> {
    await pressStrap(fixture, 'next');
    return pickerNames(fixture);
  }

  it('shows no packs checklist when no content pack is installed (the wizard is unchanged)', async () => {
    configure();
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();

    expect(root(fixture).querySelector('.name-step__packs')).toBeNull();
  });

  it('shows the installed content packs on the first step, unchecked by default', async () => {
    configure([corePack, sample]);
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();

    const toggles = root(fixture).querySelectorAll<HTMLInputElement>(
      '.name-step__packs .name-step__pack-toggle',
    );
    expect(toggles).toHaveLength(1);
    expect(toggles[0].checked).toBe(false);
    expect(root(fixture).querySelector('.name-step__packs')?.textContent).toContain(
      'Sample content',
    );
    expect(fixture.debugElement.injector.get(CreateWizardState).pins()).toEqual({
      [corePack.id]: corePack.version,
    });
  });

  it("checking a pack makes the draft offer that pack's species; unchecked, it is not offered", async () => {
    configure([corePack, sample]);
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const state = fixture.debugElement.injector.get(CreateWizardState);
    state.name.set('Aldric');
    await fixture.whenStable();

    const before = await openSpeciesStep(fixture);
    expect(before).toContain('Human');
    expect(before).not.toContain('Moonkin');

    state.togglePack(sample.id, sample.version);
    await fixture.whenStable();
    const names = pickerNames(fixture);
    expect(names).toContain('Moonkin');
    expect(names).toContain('Human');
    expect(state.pins()).toEqual({
      [corePack.id]: corePack.version,
      [sample.id]: sample.version,
    });
  });

  it('creating with a checked pack commits pack.pinned right after character.created, in the same transaction', async () => {
    const { create, appendTx } = configure([corePack, sample]);
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const state = fixture.debugElement.injector.get(CreateWizardState);

    root(fixture).querySelector<HTMLInputElement>('.name-step__pack-toggle')!.click();
    await fixture.whenStable();
    fillValidDecisions(state);
    state.setDecision('srd-5e-2024:system/5e-2024@0/species', ['sample-content:species/moonkin']);
    await fixture.whenStable();
    await advanceToReview(fixture);
    const button = createAction();
    expect(button?.disabled).toBeFalsy();
    button!.run();
    await fixture.whenStable();
    await vi.waitFor(() => expect(appendTx).toHaveBeenCalledTimes(1));

    expect(create).toHaveBeenCalledTimes(1);
    const [drafts] = appendTx.mock.calls[0] as [{ type: string; payload: unknown }[]];
    expect(drafts[0]).toEqual({
      type: 'pack.pinned',
      v: 1,
      payload: { packId: sample.id, version: sample.version },
    });
    expect(drafts.filter((d) => d.type === 'pack.pinned')).toHaveLength(1);
    expect(drafts.some((d) => d.type === 'decision.made')).toBe(true);
    // The full creation transaction (what `buildTransaction` hands `create` + `appendTx`).
    expect(
      state
        .buildTransaction()
        .map((d) => d.type)
        .slice(0, 2),
    ).toEqual(['character.created', 'pack.pinned']);
  });
});

// --- Plan 17 B8a: the flow (stepper, strap, Next / Back / Edit) ---------------------------------
describe('CreateWizardComponent — flow navigation (plan 17 B8a)', () => {
  const SYSTEM = 'srd-5e-2024:system/5e-2024';
  const SPECIES = `${SYSTEM}@0/species`;
  const BACKGROUND = `${SYSTEM}@0/background`;
  const CLASS = `${SYSTEM}@0/class`;
  const ABILITIES = `${SYSTEM}@0/ability-scores`;
  const root = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    configure();
  });

  /** The decisions every flow below needs answered before the step under test. */
  function answerBackground(state: CreateWizardState): void {
    state.setDecision(BACKGROUND, ['srd-5e-2024:background/soldier']);
    state.setDecision('srd-5e-2024:background/soldier@0/ability-scores', ['str:+2', 'con:+1']);
    state.setDecision('srd-5e-2024:background/soldier@0/tools', [
      'srd-5e-2024:item/gaming-set-dice',
    ]);
  }

  const STANDARD_ARRAY = ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'];

  async function start(name = 'Aldric') {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const state = fixture.debugElement.injector.get(CreateWizardState);
    state.name.set(name);
    await fixture.whenStable();
    return { fixture, state };
  }

  it('Next never skips an unanswered step: it stays disabled, with its reason, until the current choice is answered', async () => {
    const { fixture, state } = await start();
    await pressStrap(fixture, 'next');
    expect(currentLabel(fixture)).toBe('Species');

    expect(strapAction('next')?.disabled).toBe(true);
    expect(strapAction('next')?.disabledReason).toBe('shell.strap.reason-step');
    // Even a direct activation cannot walk past the unanswered species.
    strapAction('next')!.run();
    await fixture.whenStable();
    expect(currentLabel(fixture)).toBe('Species');

    // Answered, the flow moves on by itself to the next step still to do — Background, not later.
    state.setDecision(SPECIES, ['srd-5e-2024:species/human']);
    await fixture.whenStable();
    expect(currentLabel(fixture)).toBe('Background');
    expect(strapAction('next')?.disabled).toBe(true);
  });

  it('Next goes to the first step still to do and leaves out one already answered out of order', async () => {
    const { fixture, state } = await start();
    // The class is answered before the species, from nowhere in the flow.
    state.setDecision(CLASS, ['srd-5e-2024:class/fighter']);
    await fixture.whenStable();

    const visited: string[] = [];
    await pressStrap(fixture, 'next');
    visited.push(currentLabel(fixture)!);
    state.setDecision(SPECIES, ['srd-5e-2024:species/human']);
    await fixture.whenStable();
    visited.push(currentLabel(fixture)!);
    answerBackground(state);
    await fixture.whenStable();
    visited.push(currentLabel(fixture)!);

    // Species, then Background, then the first unanswered step after it (the ability scores) —
    // the class was already answered, so it is not offered again, and nothing is skipped.
    expect(visited).toEqual(['Species', 'Background', 'Ability scores']);
  });

  it('Back returns to the previous step in the path, even one that was answered', async () => {
    const { fixture, state } = await start();
    await pressStrap(fixture, 'next');
    expect(currentLabel(fixture)).toBe('Species');
    state.setDecision(SPECIES, ['srd-5e-2024:species/human']);
    await fixture.whenStable();
    expect(currentLabel(fixture)).toBe('Background');

    await pressStrap(fixture, 'back');
    expect(currentLabel(fixture)).toBe('Species');
    // The answered step is shown as it was answered, not blank.
    expect(root(fixture).querySelector('hk-choice-step')).not.toBeNull();
    expect(strapAction('back')?.disabled).toBeFalsy();

    await pressStrap(fixture, 'back');
    expect(currentLabel(fixture)).toBe('Name');
    expect(strapAction('back')?.disabled).toBe(true);
  });

  it('the ability step does not auto-advance when its scores become valid', async () => {
    const { fixture, state } = await start();
    state.setDecision(SPECIES, ['srd-5e-2024:species/human']);
    answerBackground(state);
    await fixture.whenStable();
    await pressStrap(fixture, 'next');
    expect(currentLabel(fixture)).toBe('Class');
    state.setDecision(CLASS, ['srd-5e-2024:class/fighter']);
    await fixture.whenStable();
    expect(currentLabel(fixture)).toBe('Ability scores');

    // A valid standard array lands: the step stays open, Next is now enabled.
    state.setDecision(ABILITIES, STANDARD_ARRAY, { method: 'standardArray' });
    await fixture.whenStable();
    expect(currentLabel(fixture)).toBe('Ability scores');
    expect(strapAction('next')?.disabled).toBeFalsy();

    await pressStrap(fixture, 'next');
    expect(currentLabel(fixture)).not.toBe('Ability scores');
    expect(currentLabel(fixture)).toBe('Skills');
  });

  it('every picker option opens its description in the description drawer', async () => {
    const { fixture } = await start();
    await pressStrap(fixture, 'next');
    expect(currentLabel(fixture)).toBe('Species');
    const names = Array.from(
      root(fixture).querySelectorAll('.hk-picker-card__name, .entity-picker__name'),
    ).map((el) => el.textContent?.trim() ?? '');
    const buttons = Array.from(
      root(fixture).querySelectorAll<HTMLElement>('.hk-picker-card__body, .entity-picker__info'),
    );
    expect(buttons.length).toBeGreaterThan(5);

    for (const [i, button] of buttons.entries()) {
      press(button);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(
        root(fixture).querySelector('hk-description-drawer .hk-drawer__title')?.textContent?.trim(),
        `option ${i}`,
      ).toBe(names[i]);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      await fixture.whenStable();
    }
  });

  it('the review Edit link jumps to the step and Next returns to the review', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const state = fixture.debugElement.injector.get(CreateWizardState);
    fillValidDecisions(state);
    await fixture.whenStable();
    await advanceToReview(fixture);
    expect(currentLabel(fixture)).toBe('Review');
    expect(strapAction('next')?.label).toBe('shell.strap.create-hero');

    press(root(fixture).querySelector<HTMLElement>('[data-edit-step="species"]')!);
    await fixture.whenStable();
    expect(currentLabel(fixture)).toBe('Species');
    expect(strapAction('next')?.disabled).toBeFalsy();

    await pressStrap(fixture, 'next');
    expect(currentLabel(fixture)).toBe('Review');
    expect(strapAction('next')?.label).toBe('shell.strap.create-hero');
  });

  it('after an Edit that opens a new unanswered choice, Next visits it before returning to the review', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const state = fixture.debugElement.injector.get(CreateWizardState);
    fillValidDecisions(state);
    await fixture.whenStable();
    await advanceToReview(fixture);

    press(root(fixture).querySelector<HTMLElement>('[data-edit-step="class"]')!);
    await fixture.whenStable();
    expect(currentLabel(fixture)).toBe('Class');
    state.setDecision(CLASS, ['srd-5e-2024:class/rogue']);
    await fixture.whenStable();
    // The rogue's own skills are unanswered: Next does not jump over them to the review.
    expect(currentLabel(fixture)).toBe('Class');
    await pressStrap(fixture, 'next');
    expect(currentLabel(fixture)).toBe('Skills');
    expect(strapAction('next')?.disabled).toBe(true);
  });

  it('sets the strap: Cancel and Back, one Next slot that reads Create hero on the review, and the step status', async () => {
    const { fixture } = await start();
    const config = TestBed.inject(ActionStrapService).config()!;
    expect(config.exit?.map((a) => a.id)).toEqual(['cancel', 'back']);
    expect(config.primary.map((a) => a.id)).toEqual(['next']);
    expect(config.scope).toEqual(['/characters', 'new']);
    expect(strapAction('next')?.label).toBe('shell.strap.next');
    expect(config.status).toMatch(/^Step 1 of \d+ · Name$/);

    await openReview(fixture);
    expect(
      TestBed.inject(ActionStrapService)
        .config()!
        .primary.map((a) => a.id),
    ).toEqual(['next']);
    expect(strapAction('next')?.label).toBe('shell.strap.create-hero');
    expect(TestBed.inject(ActionStrapService).config()!.status).toMatch(
      /^Step \d+ of \d+ · Review$/,
    );
  });

  it('Next carries the reason on the name step until the name is valid, and the strap goes with the screen', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    expect(strapAction('next')?.disabled).toBe(true);
    expect(strapAction('next')?.disabledReason).toBe('shell.strap.reason-name');
    fixture.destroy();
    expect(TestBed.inject(ActionStrapService).config()).toBeNull();
  });

  it('Cancel leaves at once for an untouched wizard and asks first once something has changed', async () => {
    const back = vi
      .spyOn(TestBed.inject(NavHistoryService), 'back')
      .mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    // `provideEngineScope` gives the wizard its own DialogService (dialogs parent to the wizard).
    const open = vi
      .spyOn(fixture.debugElement.injector.get(DialogService), 'open')
      .mockReturnValue({ closed: Promise.resolve(false), close: () => undefined });
    await pressStrap(fixture, 'cancel');
    expect(open).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledWith(['/characters']);

    back.mockClear();
    fixture.debugElement.injector.get(CreateWizardState).name.set('Aldric');
    await fixture.whenStable();
    await pressStrap(fixture, 'cancel');
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    // Declined: the wizard stays.
    expect(back).not.toHaveBeenCalled();

    open.mockReturnValue({ closed: Promise.resolve(true), close: () => undefined });
    await pressStrap(fixture, 'cancel');
    await vi.waitFor(() => expect(back).toHaveBeenCalledWith(['/characters']));
  });

  it('carries the step in the URL', async () => {
    const { fixture } = await start();
    await pressStrap(fixture, 'next');
    expect(TestBed.inject(Location).path()).toContain('step=species');
    await pressStrap(fixture, 'back');
    expect(TestBed.inject(Location).path()).toContain('step=name');
  });

  it('opens the name step for a deep link the in-memory draft cannot back (review, a picker step)', async () => {
    for (const step of ['review', 'species']) {
      TestBed.resetTestingModule();
      configure();
      TestBed.overrideProvider(ActivatedRoute, {
        useValue: { snapshot: { queryParamMap: convertToParamMap({ step }) } },
      });
      const fixture = TestBed.createComponent(CreateWizardComponent);
      await fixture.whenStable();
      expect(currentLabel(fixture), step).toBe('Name');
      fixture.destroy();
    }
  });

  it('sets the phone top bar title for the screen', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    expect(TestBed.inject(TopBarService).config()?.title).toBe('New hero');
  });

  it('shows the vertical stepper on tablets and desktops and the strip on a phone', async () => {
    const wide = TestBed.createComponent(CreateWizardComponent);
    await wide.whenStable();
    expect(root(wide).querySelector('.hk-stepper--vertical')).not.toBeNull();
    expect(root(wide).querySelector('.hk-stepper--strip')).toBeNull();
    wide.destroy();

    stubViewport({ phone: true });
    try {
      const phone = TestBed.createComponent(CreateWizardComponent);
      await phone.whenStable();
      expect(root(phone).querySelector('.hk-stepper--strip')).not.toBeNull();
      expect(root(phone).querySelector('.hk-stepper__count')?.textContent).toBe('Step 1 of 2');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// --- Plan 17 B8b: the steps on the shared component library -------------------------------------
describe('CreateWizardComponent — rebuilt steps (plan 17 B8b)', () => {
  const root = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;
  const SYSTEM = 'srd-5e-2024:system/5e-2024';

  beforeEach(() => {
    configure();
  });

  async function startFull() {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const state = fixture.debugElement.injector.get(CreateWizardState);
    fillValidDecisions(state);
    await fixture.whenStable();
    return { fixture, state };
  }

  it('the name step is a text field, a three-way grammatical form of real radios and no pack list when none is installed', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const el = root(fixture);
    expect(el.querySelector('hk-text-field.name-step__name-input input')).not.toBeNull();
    const radios = Array.from(
      el.querySelectorAll<HTMLInputElement>('.name-step__segments input[type="radio"]'),
    );
    expect(radios.map((r) => r.value)).toEqual(['masculine', 'feminine', 'neuter']);
    radios[1].click();
    await fixture.whenStable();
    expect(fixture.debugElement.injector.get(CreateWizardState).gender()).toBe('feminine');
    expect(el.querySelector('.name-step__packs')).toBeNull();
  });

  it('with a content pack installed the core pack shows first, locked, and cannot be toggled', async () => {
    TestBed.resetTestingModule();
    const parsed = parsePack(sampleJson);
    if (!parsed.ok) throw new Error('sample-content.json fixture no longer parses');
    configure([corePack, parsed.pack]);
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const rows = Array.from(root(fixture).querySelectorAll('.name-step__pack-list > li'));
    expect(rows).toHaveLength(2);
    const core = rows[0];
    expect(core.classList.contains('name-step__pack--core')).toBe(true);
    expect(core.querySelector('input')).toBeNull();
    const lock = core.querySelector('[role="img"]')!;
    expect(lock.getAttribute('aria-label')).toContain(charactersEn.create.packs.coreLocked);
    expect(lock.getAttribute('tabindex')).toBe('0');
    expect(core.getAttribute('tabindex')).toBeNull();
    const hint = root(fixture).querySelector('.name-step__hint')!;
    expect(hint.getAttribute('aria-label')).toBe(charactersEn.create.packs.hint);
    expect(rows[1].querySelector('input[type="checkbox"]')).not.toBeNull();
  });

  it('choice steps carry the choice\'s own name from the pack, never the generic "Choice"', async () => {
    const { fixture } = await startFull();
    const labels = Array.from(root(fixture).querySelectorAll('.hk-stepper__name')).map((el) =>
      el.textContent?.trim(),
    );
    expect(labels).toContain('Fighting Style');
    expect(labels).toContain('Weapon Masteries');
    expect(labels).not.toContain('Choice');
  });

  it('the status line names the current choice step by its own label', async () => {
    const { fixture } = await startFull();
    (fixture.componentInstance as unknown as { flow: { go(id: string): void } }).flow.go(
      'srd-5e-2024:class/fighter@1/weapon-masteries',
    );
    await fixture.whenStable();
    expect(TestBed.inject(ActionStrapService).config()?.status).toContain('Weapon Masteries');
  });

  it('until a class is chosen one locked "Class choices" row holds the place of the class steps, then gives way to them', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const state = fixture.debugElement.injector.get(CreateWizardState);
    state.name.set('Aldric');
    await fixture.whenStable();
    const placeholder = () =>
      Array.from(root(fixture).querySelectorAll('.hk-stepper__step--locked'));
    expect(placeholder()).toHaveLength(1);
    expect(placeholder()[0].textContent).toContain('Class choices');
    // Not reachable: pressing it keeps the wizard where it is.
    const before = TestBed.inject(ActionStrapService).config()?.status;
    press(placeholder()[0]);
    await fixture.whenStable();
    expect(TestBed.inject(ActionStrapService).config()?.status).toBe(before);

    state.setDecision(`${SYSTEM}@0/class`, ['srd-5e-2024:class/fighter']);
    await fixture.whenStable();
    expect(placeholder()).toHaveLength(0);
    expect(
      Array.from(root(fixture).querySelectorAll('.hk-stepper__name')).map((e) =>
        e.textContent?.trim(),
      ),
    ).toContain('Fighting Style');
  });

  it('the strap gains Filter and Search on a picker step only, and Filter folds the chips away', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const state = fixture.debugElement.injector.get(CreateWizardState);
    state.name.set('Aldric');
    await fixture.whenStable();
    const strap = TestBed.inject(ActionStrapService);
    expect(strap.config()?.secondary).toBeUndefined();

    await pressStrap(fixture, 'next');
    expect(currentLabel(fixture)).toBe('Species');
    expect(strap.config()?.secondary?.map((a) => a.id)).toEqual(['filter', 'search']);
    expect(strapAction('filter')?.disabled).toBeFalsy();
    expect(root(fixture).querySelector('button[hk-filter-chip]')).not.toBeNull();

    await pressStrap(fixture, 'filter');
    fixture.detectChanges();
    expect(root(fixture).querySelector('button[hk-filter-chip]')).toBeNull();
    await pressStrap(fixture, 'filter');
    fixture.detectChanges();
    expect(root(fixture).querySelector('button[hk-filter-chip]')).not.toBeNull();

    await pressStrap(fixture, 'back');
    expect(strap.config()?.secondary).toBeUndefined();
  });

  it('leaving the equipment step with Next marks it done in the stepper; there is no Continue button', async () => {
    const { fixture, state } = await startFull();
    await advanceToStep(fixture, 'Equipment');
    expect(root(fixture).querySelector('.equipment-step__continue')).toBeNull();
    expect(state.doneSteps().has('equipment')).toBe(false);
    await pressStrap(fixture, 'next');
    expect(currentLabel(fixture)).toBe('Review');
    expect(state.doneSteps().has('equipment')).toBe(true);
  });

  // Plan 18 task 3 fix round 1: the wizard reads `?campaign=` at start (the draft name is still
  // empty then), so a hero made for a campaign with starting gold off gets the gold-only kit gated.
  it('?campaign= with starting gold off gates the gold-only kit on the equipment step, with its reason', async () => {
    TestBed.overrideProvider(ActivatedRoute, {
      useValue: { snapshot: { queryParamMap: convertToParamMap({ campaign: CAMPAIGN_ID }) } },
    });
    await seedCampaign({ startingGold: false });
    const { fixture } = await startFull();
    await advanceToStep(fixture, 'Equipment');

    const reason = 'Starting gold is off in The Emberfall Company — ask your DM';
    const cards = Array.from(
      root(fixture).querySelectorAll<HTMLElement>('.equipment-step__kits--class hk-picker-card'),
    );
    const gated = cards.filter((c) => c.classList.contains('hk-picker-card--gated'));
    expect(gated).toHaveLength(1);
    const choose = gated[0].querySelector<HTMLButtonElement>('.hk-picker-card__choose')!;
    expect(choose.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(choose)).toContain(reason);
  });

  it('the review groups by step, each with an Edit link; the abilities are seals in the system order', async () => {
    const { fixture } = await startFull();
    await advanceToReview(fixture);
    const el = root(fixture);
    expect(el.querySelectorAll('.create-wizard__group').length).toBeGreaterThanOrEqual(3);
    const editSteps = Array.from(el.querySelectorAll('[data-edit-step]')).map((b) =>
      b.getAttribute('data-edit-step'),
    );
    expect(editSteps).toContain('name');
    expect(editSteps).toContain('species');
    expect(editSteps).toContain('class');
    const seals = Array.from(el.querySelectorAll('hk-ability-seal .hk-ability__name')).map((s) =>
      s.textContent?.trim(),
    );
    expect(seals).toEqual([
      'Strength',
      'Dexterity',
      'Constitution',
      'Intelligence',
      'Wisdom',
      'Charisma',
    ]);
  });

  it("the review's equipment Edit link opens the equipment step and Next returns to the review", async () => {
    const { fixture, state } = await startFull();
    state.addItem('srd-5e-2024:item/chain-mail', 1);
    await advanceToReview(fixture);
    const edit = root(fixture).querySelector<HTMLElement>('[data-edit-step="equipment"]')!;
    expect(edit).not.toBeNull();
    press(edit);
    await fixture.whenStable();
    expect(currentLabel(fixture)).toBe('Equipment');
    await pressStrap(fixture, 'next');
    expect(currentLabel(fixture)).toBe('Review');
  });
});

/** Presses Next until the stepper marks the named step current. */
async function advanceToStep(
  fixture: { nativeElement: unknown; whenStable(): Promise<unknown> },
  label: string,
): Promise<void> {
  for (let i = 0; i < 20 && currentLabel(fixture) !== label; i++) {
    const next = strapAction('next');
    if (!next || next.disabled) break;
    next.run();
    await fixture.whenStable();
  }
  expect(currentLabel(fixture)).toBe(label);
}
