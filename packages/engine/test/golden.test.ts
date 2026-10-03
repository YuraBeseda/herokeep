import { parseEvent } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../src/content/index.ts';
import { outstandingChoices } from '../src/derive/index.ts';
import { reduce } from '../src/reduce/reducer.ts';
import { loadDistPack, loadGoldens, runGolden } from './support/golden.ts';

describe('golden characters', () => {
  for (const fx of loadGoldens()) {
    it(fx.name, () => {
      const { actual, expected } = runGolden(fx);
      expect(actual).toEqual(expected);
    });
  }

  // Plan 12 final wave W1: spec-level pin (the fixture itself is unchanged) — the rogue3+bard2
  // golden's later Bard class (gains.skillChoiceCount 1) leaves exactly its multiclass bonus skill
  // pick outstanding, and no full `bard@1/skills` creation pick.
  it('multi-rogue3-bard2: the only outstanding skill pick is bard@1/multiclass-skills (count 1)', () => {
    const golden = loadGoldens().find((g) => g.name === 'multi-rogue3-bard2');
    expect(golden).toBeDefined();
    const index = createContentIndex([loadDistPack('srd-5e-2024')]);
    const facts = reduce(
      golden!.events.map((e) => {
        const r = parseEvent(e);
        if (!r.ok) throw new Error('bad event');
        return r.event;
      }),
      undefined,
      { restRules: index.system().restRules, hpRules: index.system().hpRules },
    );
    const skillPicks = outstandingChoices(facts, index).filter((r) => /@1\/(multiclass-)?skills$/.test(r.choiceId));
    expect(skillPicks).toEqual([
      { choiceId: 'srd-5e-2024:class/bard@1/multiclass-skills', ownerId: 'srd-5e-2024:class/bard', count: 1 },
    ]);
  });
});
