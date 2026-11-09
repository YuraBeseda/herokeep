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
});
