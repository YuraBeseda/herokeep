import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import { createContentIndex, createLocalizer } from '@hk/engine';
import { parsePack, type Choice, type ClassEntity, type Pack } from '@hk/protocol';
import { choiceOptionIds, optionsForChoice } from './choice-options';

// The test runner's working directory is `apps/web`.
const repoRoot = join(process.cwd(), '..', '..');
const raw: unknown = JSON.parse(
  readFileSync(
    join(repoRoot, 'packages/content/dist/packs', PACK_ID, PACK_VERSION, 'pack.json'),
    'utf8',
  ),
);
const parsed = parsePack(raw);
if (!parsed.ok) throw new Error(parsed.issues.map((i) => i.message).join('; '));
const corePack: Pack = parsed.pack;
const index = createContentIndex([corePack]);
const localizer = createLocalizer(index, 'en');
const href = (id: string): string => `/library/${id}`;

function choiceOf(classSlug: string, choiceSlug: string): { owner: ClassEntity; choice: Choice } {
  const owner = index.get(`${PACK_ID}:class/${classSlug}`);
  if (owner?.type !== 'class') throw new Error(`no class ${classSlug}`);
  for (const row of owner.levels) {
    const choice = row.choices.find((c) => c.id.endsWith(`/${choiceSlug}`));
    if (choice) return { owner, choice };
  }
  throw new Error(`no choice ${choiceSlug} on ${classSlug}`);
}

describe('optionsForChoice', () => {
  it("counts the pack's mastery-property weapons for Paladin Weapon Mastery", () => {
    const { owner, choice } = choiceOf('paladin', 'weapon-masteries');
    const withMastery = index
      .byType('item')
      .filter((item) => item.type === 'item' && item.weapon?.mastery !== undefined);
    expect(withMastery.length).toBeGreaterThan(0);
    const view = optionsForChoice(choice, index, { ownerId: owner.id, localizer, href });
    expect(view.count).toBe(withMastery.length);
    expect(view.options.map((o) => o.id).sort()).toEqual(withMastery.map((i) => i.id).sort());
  });

  it('lists the Fighting Style feats with their names and library links', () => {
    const { owner, choice } = choiceOf('paladin', 'fighting-style');
    const styles = index.byType('feat').filter((feat) => feat.tags.includes('fighting-style'));
    expect(styles.length).toBeGreaterThan(0);
    const view = optionsForChoice(choice, index, { ownerId: owner.id, localizer, href });
    expect(view.count).toBe(styles.length);
    const first = view.options[0];
    expect(first.name).toBe(localizer.name(first.id));
    expect(first.href).toBe(href(first.id));
  });

  it('gives the same ids the wizard picker lists (the engine offer set)', () => {
    const { owner, choice } = choiceOf('paladin', 'weapon-masteries');
    const view = optionsForChoice(choice, index, { ownerId: owner.id, localizer, href });
    expect(view.options.map((o) => o.id)).toEqual(choiceOptionIds(choice, index, owner.id));
  });

  it('caps the listed options at the limit but counts the whole set', () => {
    const { owner, choice } = choiceOf('paladin', 'weapon-masteries');
    const all = choiceOptionIds(choice, index, owner.id).length;
    const view = optionsForChoice(choice, index, { ownerId: owner.id, localizer, href, limit: 3 });
    expect(view.count).toBe(all);
    expect(view.options).toHaveLength(3);
  });

  it('lists every skill of a proficiency-gated pick (Expertise) when no hero is in play', () => {
    const { owner, choice } = choiceOf('rogue', 'expertise');
    const view = optionsForChoice(choice, index, { ownerId: owner.id, localizer, href });
    expect(view.count).toBe(index.byType('skill').length);
    const gated = choiceOptionIds(choice, index, owner.id, { skills: {} });
    expect(gated).toEqual([]);
  });

  it('has no options for a pick with no list (ability scores)', () => {
    const background = index.byType('background')[0];
    const choice = background.choices.find((c) => 'abilities' in c.pick)!;
    expect(optionsForChoice(choice, index, { ownerId: background.id, localizer, href })).toEqual({
      count: 0,
      options: [],
    });
  });
});
