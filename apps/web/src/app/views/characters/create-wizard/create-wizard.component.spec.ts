import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { createContentIndex, derive, reduce, type SystemRules } from '@hk/engine';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { ToastService } from '@shared/components/toast/toast.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { EventsRepository } from '@shared/services/storage/events.repository';
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
      provideTranslocoMessageformat(),
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
    state.setDecision(
      'srd-5e-2024:system/5e-2024@0/ability-scores',
      ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
      { method: 'standardArray' },
    );
    state.setDecision('srd-5e-2024:system/5e-2024@0/class', ['srd-5e-2024:class/fighter']);
    state.setDecision('srd-5e-2024:class/fighter@1/skills', ['athletics', 'perception']);
    state.setDecision('srd-5e-2024:class/fighter@1/fighting-style', ['srd-5e-2024:feat/defense']);
    state.setDecision('srd-5e-2024:class/fighter@1/weapon-masteries', ['longsword']);
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
    expect(find('Weapon Masteries')?.selection).toBe('longsword');
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
      '.create-wizard__name-input',
    );
    input!.value = 'Aldric';
    input!.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    await advanceToReview(fixture);

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
    state.setDecision(
      `${SYSTEM_ID}@0/ability-scores`,
      ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
      { method: 'standardArray' },
    );
    state.setDecision(`${SYSTEM_ID}@0/class`, ['srd-5e-2024:class/fighter']);
    state.setDecision('srd-5e-2024:class/fighter@1/skills', ['athletics', 'perception']);
    state.setDecision('srd-5e-2024:class/fighter@1/fighting-style', ['srd-5e-2024:feat/defense']);
    state.setDecision('srd-5e-2024:class/fighter@1/weapon-masteries', ['longsword']);

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
    const createButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.create-wizard__create',
    );
    expect(createButton?.disabled).toBe(false);
    createButton!.click();
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
});
