import { describe, expect, it } from 'vitest';
import { createContentIndex } from '../../src/content/index.ts';
import { derive } from '../../src/derive/index.ts';
import { emptyFacts } from '../../src/reduce/facts.ts';
import { loadFixturePack } from '../support/fixtures.ts';

/**
 * Plan 15 (phase 4 slice 5) Task 1 — `sheet.pins` is a COPY of `facts.pins` (what the Build tab's
 * Packs section and `propose.pinPack` read), and `sheet.corePackId` names the core pack of the
 * index the sheet was derived with (what `propose.unpinPack` refuses).
 */
describe('derive: sheet.pins and sheet.corePackId', () => {
  const index = createContentIndex([loadFixturePack('core-mini'), loadFixturePack('content-mini')]);

  it('copies facts.pins', () => {
    const facts = emptyFacts('char:test');
    facts.pins = { 'core-mini': '1.0.0', 'homebrew-mini': '1.2.0' };
    const sheet = derive(facts, index);
    expect(sheet.pins).toEqual(facts.pins);
    expect(sheet.pins).not.toBe(facts.pins);
  });

  it('names the core pack (kind core) of the index, never a content pack', () => {
    const sheet = derive(emptyFacts('char:test'), index);
    expect(sheet.corePackId).toBe('core-mini');
  });
});
