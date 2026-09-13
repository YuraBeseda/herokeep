import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { PackStore } from '@shared/stores/pack.store';
import { CharacterStore } from '@shared/stores/character.store';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import charactersRu from '../../../../assets/i18n/characters/ru.json';
import charactersUk from '../../../../assets/i18n/characters/uk.json';
import { CreateWizardComponent } from './create-wizard.component';
import { CreateWizardState } from './create-wizard.state';

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
    return of({});
  }
}

function configure(): { create: ReturnType<typeof vi.fn>; appendTx: ReturnType<typeof vi.fn> } {
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
      {
        provide: PackStore,
        useValue: { packs: signal([corePack]), ready: signal(true), corePack: signal(corePack) },
      },
      { provide: CharacterStore, useValue: { create, appendTx } },
    ],
  });
  return { create, appendTx };
}

function stepLabels(fixture: { nativeElement: unknown }): string[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll('.hk-stepper__step'),
  ).map((el) => el.textContent?.trim() ?? '');
}

/** Public-API-only navigation: clicks the footer's "Next" button until the review step's create
 * button appears (or gives up after a generous bound — a real stall fails loudly instead of
 * hanging). Exercises the exact same `canGoNext`/`next()` path a real user would. */
async function advanceToReview(fixture: {
  nativeElement: unknown;
  whenStable(): Promise<unknown>;
}): Promise<void> {
  const root = () => fixture.nativeElement as HTMLElement;
  for (let i = 0; i < 20 && !root().querySelector('.create-wizard__create'); i++) {
    const next = root().querySelector<HTMLButtonElement>('.create-wizard__next');
    if (!next || next.disabled) break;
    next.click();
    await fixture.whenStable();
  }
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
      '.create-wizard__name-input',
    );
    input!.value = 'Aldric';
    input!.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    await advanceToReview(fixture);

    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.create-wizard__create',
    );
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
  });

  it('typing a name grows the stepper with the system creation-choice steps', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '.create-wizard__name-input',
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
      'Equipment',
      'Review',
    ]);
  });

  it('re-homes the active step when its own decision is set without navigating away first', async () => {
    const fixture = TestBed.createComponent(CreateWizardComponent);
    await fixture.whenStable();
    const root = () => fixture.nativeElement as HTMLElement;

    const input = root().querySelector<HTMLInputElement>('.create-wizard__name-input');
    input!.value = 'Aldric';
    input!.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    // Navigate to 'species' via the public Next button (name -> species).
    root().querySelector<HTMLButtonElement>('.create-wizard__next')!.click();
    await fixture.whenStable();
    expect(root().querySelector('.hk-stepper__step--current')?.textContent?.trim()).toBe('Species');

    // A future species-step component (T6) would call `setDecision` here without itself calling
    // `next()` first — species is now decided while it is still the ACTIVE step, so it vanishes
    // from `state.steps()` out from under `activeStepId`.
    const state = fixture.debugElement.injector.get(CreateWizardState);
    state.setDecision('srd-5e-2024:system/5e-2024@0/species', ['srd-5e-2024:species/human']);
    await fixture.whenStable();

    // Re-homed to whatever now sits at species' own former ordinal position — 'background', which
    // shifted left into that slot — not stranded, and the footer works in both directions again.
    expect(root().querySelector('.hk-stepper__step--current')?.textContent?.trim()).toBe(
      'Background',
    );
    expect(root().querySelector<HTMLButtonElement>('.create-wizard__back')?.disabled).toBe(false);
    expect(root().querySelector<HTMLButtonElement>('.create-wizard__next')?.disabled).toBe(false);

    // Back/Next both still actually navigate (not just enabled-but-inert).
    root().querySelector<HTMLButtonElement>('.create-wizard__back')!.click();
    await fixture.whenStable();
    expect(root().querySelector('.hk-stepper__step--current')?.textContent?.trim()).toBe('Name');
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
    state.setDecision(
      'srd-5e-2024:system/5e-2024@0/ability-scores',
      ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
      { method: 'standardArray' },
    );
    state.setDecision('srd-5e-2024:system/5e-2024@0/class', ['srd-5e-2024:class/fighter']);
    state.setDecision('srd-5e-2024:class/fighter@1/skills', ['athletics', 'perception']);
    state.setDecision('srd-5e-2024:class/fighter@1/fighting-style', ['srd-5e-2024:feat/defense']);
    state.setDecision('srd-5e-2024:class/fighter@1/weapon-masteries', ['longsword']);
    await fixture.whenStable();

    expect(state.outstanding()).toEqual([]);

    await advanceToReview(fixture);
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.create-wizard__create',
    );
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    // The review skeleton's gender row resolves the SCOPED gender label key correctly (no
    // double-prefixed 'characters.characters....' lookup miss).
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Masculine');

    button!.click();
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
    // costs: 15 -> 9 (x5) + 8 -> 0 = 45, against a 27-point budget — over budget.
    state.setDecision(
      'srd-5e-2024:system/5e-2024@0/ability-scores',
      ['str:15', 'dex:15', 'con:15', 'int:15', 'wis:15', 'cha:8'],
      { method: 'pointBuy' },
    );
    state.setDecision('srd-5e-2024:system/5e-2024@0/class', ['srd-5e-2024:class/fighter']);
    state.setDecision('srd-5e-2024:class/fighter@1/skills', ['athletics', 'perception']);
    state.setDecision('srd-5e-2024:class/fighter@1/fighting-style', ['srd-5e-2024:feat/defense']);
    state.setDecision('srd-5e-2024:class/fighter@1/weapon-masteries', ['longsword']);
    await fixture.whenStable();

    // Unlike species/background (validly decided, vanished from the stepper), the invalid
    // ability-scores decision keeps its step and renders it 'blocked' — visible and clickable.
    expect(stepLabels(fixture)).toContain('Ability scores');
    const findStepButton = (label: string): HTMLButtonElement =>
      Array.from(root().querySelectorAll<HTMLButtonElement>('.hk-stepper__step')).find(
        (b) => b.textContent?.trim() === label,
      )!;
    const abilityStepButton = findStepButton('Ability scores');
    expect(abilityStepButton.classList.contains('hk-stepper__step--blocked')).toBe(true);
    expect(abilityStepButton.disabled).toBe(false);

    await advanceToReview(fixture);
    const createButton = root().querySelector<HTMLButtonElement>('.create-wizard__create');
    expect(createButton).not.toBeNull();
    expect(createButton?.disabled).toBe(true);

    // Revisit the blocked step directly from the stepper.
    findStepButton('Ability scores').click();
    await fixture.whenStable();
    expect(root().querySelector('.hk-stepper__step--current')?.textContent?.trim()).toBe(
      'Ability scores',
    );

    // Fix it: a valid standard-array selection.
    state.setDecision(
      'srd-5e-2024:system/5e-2024@0/ability-scores',
      ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
      { method: 'standardArray' },
    );
    await fixture.whenStable();

    expect(stepLabels(fixture)).not.toContain('Ability scores');
    await advanceToReview(fixture);
    expect(root().querySelector<HTMLButtonElement>('.create-wizard__create')?.disabled).toBe(false);
  });
});
