import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { parsePack, type Pack } from '@hk/protocol';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { PackStore } from '@shared/stores/pack.store';
import { CreateWizardState } from './create-wizard.state';

// Real built SRD pack (per task-2-brief.md's "prefer the real pack over a minimal fixture"
// ruling) — `pretest` (apps/web/package.json) runs `pnpm --filter @hk/content build:pack` first,
// so the dist pack is always on disk before this file runs. Same approach as
// `character.store.spec.ts` / `engine.facade.spec.ts`.
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

const SYSTEM_ID = 'srd-5e-2024:system/5e-2024';
const SPECIES_CHOICE = `${SYSTEM_ID}@0/species`;
const BACKGROUND_CHOICE = `${SYSTEM_ID}@0/background`;
const CLASS_CHOICE = `${SYSTEM_ID}@0/class`;
const ABILITY_SCORES_CHOICE = `${SYSTEM_ID}@0/ability-scores`;
const BACKGROUND_ABILITIES_CHOICE = 'srd-5e-2024:background/soldier@0/ability-scores';
const CLASS_SKILLS_CHOICE = 'srd-5e-2024:class/fighter@1/skills';

class StubLoader implements TranslocoLoader {
  getTranslation() {
    return of({});
  }
}

function configure(): void {
  TestBed.configureTestingModule({
    providers: [
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
      CreateWizardState,
    ],
  });
}

function createState(): CreateWizardState {
  return TestBed.inject(CreateWizardState);
}

describe('CreateWizardState', () => {
  beforeEach(() => {
    configure();
  });

  it('starts with name+review steps only, an undefined draftSheet, and no outstanding choices', () => {
    const state = createState();

    expect(state.steps().map((s) => s.id)).toEqual(['name', 'review']);
    expect(state.draftSheet()).toBeUndefined();
    expect(state.outstanding()).toEqual([]);
  });

  it('setting name+species/background/class decisions grows the step list (background-abilities and class-skills appear)', () => {
    const state = createState();

    state.name.set('Aldric');
    // Right after a name is set the system's own creation choices become outstanding.
    expect(state.steps().map((s) => s.id)).toEqual([
      'name',
      'species',
      'background',
      'class',
      'ability-scores',
      'equipment',
      'review',
    ]);

    state.setDecision(SPECIES_CHOICE, ['srd-5e-2024:species/human']);
    state.setDecision(BACKGROUND_CHOICE, ['srd-5e-2024:background/soldier']);
    // The background's own creation choice (its ability-score bump) is now surfaced.
    expect(state.steps().map((s) => s.id)).toContain('background-abilities');
    expect(state.steps().map((s) => s.id)).not.toContain('species');
    expect(state.steps().map((s) => s.id)).not.toContain('background');

    state.setDecision(CLASS_CHOICE, ['srd-5e-2024:class/fighter']);
    // Choosing a class drafts `level.gained` internally, surfacing the synthetic skills choice
    // (and the class's own level-1 choices, e.g. fighting-style/weapon-masteries — real pack
    // choices this task doesn't curate, so they land in the list too, just uncurated).
    const ids = state.steps().map((s) => s.id);
    expect(ids).toContain('class-skills');
    expect(ids).toContain('srd-5e-2024:class/fighter@1/fighting-style');
    expect(ids).not.toContain('class');
    // Curated order preserved: background-abilities, then ability-scores, then class-skills —
    // uncurated entries (fighting-style, weapon-masteries) come after, name first/review last.
    expect(ids[0]).toBe('name');
    expect(ids.at(-1)).toBe('review');
    expect(ids.at(-2)).toBe('equipment');
    expect(ids.indexOf('background-abilities')).toBeLessThan(ids.indexOf('ability-scores'));
    expect(ids.indexOf('ability-scores')).toBeLessThan(ids.indexOf('class-skills'));
    expect(ids.indexOf('class-skills')).toBeLessThan(ids.indexOf('equipment'));
  });

  it('draftSheet reflects decisions made so far: fighter L1, base con 14 + soldier +1 -> hp 12', () => {
    const state = createState();
    state.name.set('Aldric');
    state.setDecision(SPECIES_CHOICE, ['srd-5e-2024:species/human']);
    state.setDecision(BACKGROUND_CHOICE, ['srd-5e-2024:background/soldier']);
    state.setDecision(BACKGROUND_ABILITIES_CHOICE, ['str:+2', 'con:+1']);
    state.setDecision(
      ABILITY_SCORES_CHOICE,
      ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
      { method: 'standardArray' },
    );
    state.setDecision(CLASS_CHOICE, ['srd-5e-2024:class/fighter']);

    const sheet = state.draftSheet();
    expect(sheet).toBeDefined();
    expect(sheet?.level).toBe(1);
    // Base array con 14 + soldier's own +1 ability-score bump = 15 (mod +2, same bracket as 14).
    expect(sheet?.abilities['con']?.score.value).toBe(15);
    expect(sheet?.abilities['con']?.mod).toBe(2);
    expect(sheet?.hp.max.value).toBe(12);
    // The synthetic class-skills choice is now outstanding too.
    expect(state.outstanding().map((c) => c.choiceId)).toContain(CLASS_SKILLS_CHOICE);
  });

  it('validate rejects a wrong-multiset standard-array selection once the method context is recorded', () => {
    const state = createState();
    state.name.set('Aldric');
    state.setDecision(
      ABILITY_SCORES_CHOICE,
      ['str:15', 'dex:13', 'con:14', 'int:10', 'wis:12', 'cha:8'],
      { method: 'standardArray' },
    );

    // Same multiset as a valid standard array must actually be {15,14,13,12,10,8}; swapping one
    // value for a duplicate breaks the multiset while keeping the count and range plausible.
    const wrongMultiset = ['str:15', 'dex:15', 'con:14', 'int:10', 'wis:12', 'cha:8'];
    const diagnostics = state.validate(ABILITY_SCORES_CHOICE, wrongMultiset);

    expect(diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(diagnostics.some((d) => d.code === 'selection.standardArrayMismatch')).toBe(true);
  });

  it('validate returns no diagnostics before a name/draft exists', () => {
    const state = createState();
    expect(state.validate(ABILITY_SCORES_CHOICE, ['str:15'])).toEqual([]);
  });

  it('buildTransaction orders events as character.created, decision.made*, level.gained, extraDrafts', () => {
    const state = createState();
    state.name.set('Aldric');
    state.gender.set('masculine');
    // Deliberately set the class decision FIRST — level.gained must still land after every
    // decision.made, never interleaved by setDecision call order.
    state.setDecision(CLASS_CHOICE, ['srd-5e-2024:class/fighter']);
    state.setDecision(SPECIES_CHOICE, ['srd-5e-2024:species/human']);
    state.setDecision(BACKGROUND_CHOICE, ['srd-5e-2024:background/soldier']);

    const tx = state.buildTransaction();

    expect(tx[0]).toMatchObject({ type: 'character.created', v: 1 });
    expect((tx[0].payload as { name: string }).name).toBe('Aldric');
    const decisionMadeCount = tx.filter((e) => e.type === 'decision.made').length;
    expect(decisionMadeCount).toBe(3);
    const levelGainedIndex = tx.findIndex((e) => e.type === 'level.gained');
    expect(levelGainedIndex).toBe(4); // after character.created + 3 decision.made
    expect(tx[levelGainedIndex]).toMatchObject({
      type: 'level.gained',
      v: 1,
      payload: { classId: 'srd-5e-2024:class/fighter', level: 1 },
    });
  });

  it('buildTransaction appends extraDrafts last', () => {
    const state = createState();
    state.name.set('Aldric');
    state.extraDrafts.set([{ type: 'currency.changed', v: 1, payload: { gp: 10 } }]);

    const tx = state.buildTransaction();

    expect(tx.at(-1)).toEqual({ type: 'currency.changed', v: 1, payload: { gp: 10 } });
  });
});
