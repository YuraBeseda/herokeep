import { TestBed } from '@angular/core/testing';
import type { Sheet } from '@hk/engine';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { setupLeafSpec } from './play-spec-support';
import { sheetNames } from './play-names';

type ResourceView = Sheet['resources'][number];
type ActionView = Sheet['actions'][number];

describe('sheetNames', () => {
  setupLeafSpec();

  // `resourceLabel`/`actionLabel` prefer `localizer.name(view.source)` over the baked English name,
  // falling back to it only when the source entity does not resolve (mirrors `resolve`'s own
  // defensive convention).
  it('resourceLabel/actionLabel fall back to the baked view.name when the source entity does not resolve', () => {
    const names = sheetNames(TestBed.inject(EngineFacade));

    const fakeResource: ResourceView = {
      id: 'ghost-resource',
      name: 'Ghost Resource',
      max: { value: 1, contributions: [] },
      used: 0,
      reset: 'shortRest',
      display: 'pips',
      source: 'srd-5e-2024:feature/does-not-exist',
    };
    expect(names.resourceLabel(fakeResource)).toBe('Ghost Resource');

    const fakeAction: ActionView = {
      id: 'ghost-action',
      name: 'Ghost Action',
      kind: 'free',
      description: '',
      source: 'srd-5e-2024:feature/does-not-exist',
    };
    expect(names.actionLabel(fakeAction)).toBe('Ghost Action');
  });

  // Plan 17 B9b fix round: the dialogs' extra facts are read off the pack entities, never typed in.
  it('conditionOptions carry the localized effect text of a condition (and the level cap of exhaustion)', () => {
    const options = sheetNames(TestBed.inject(EngineFacade)).conditionOptions();
    const blinded = options.find((o) => o.id === 'srd-5e-2024:condition/blinded')!;
    expect(blinded.description).toMatch(/can.t see/i);
    expect(options.find((o) => o.id === 'srd-5e-2024:condition/exhaustion')).toMatchObject({
      levelBearing: true,
      maxLevel: 6,
    });
  });

  it('spellRow carries the spell facts for the cast dialog summary, from the spell entity', () => {
    const row = sheetNames(TestBed.inject(EngineFacade)).spellRow(
      'srd-5e-2024:spell/shield-of-faith',
    );
    expect(row.summary).toMatchObject({
      school: { kind: 'text', text: 'Abjuration' },
      castingTime: { kind: 'key', key: 'fact.unit.bonus', params: { value: 1 } },
      range: { kind: 'key', key: 'fact.unit.feet', params: { value: 60 } },
      ritual: false,
    });
    expect(row.summary?.components).toMatchObject({ kind: 'text' });
    expect(row.summary?.duration).toMatchObject({ kind: 'key', key: 'fact.unit.minute' });
  });

  it('spellRow has no summary for a spell id the index does not know', () => {
    expect(
      sheetNames(TestBed.inject(EngineFacade)).spellRow('srd-5e-2024:spell/does-not-exist').summary,
    ).toBeUndefined();
  });
});
