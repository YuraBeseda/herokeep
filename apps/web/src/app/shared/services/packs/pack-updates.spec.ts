import type { Pack } from '@hk/protocol';
import { updatesFor } from './pack-updates';

function mkPack(id: string, version: string, kind: Pack['kind'] = 'content'): Pack {
  return {
    format: 1,
    id,
    version,
    kind,
    name: id,
    authors: [],
    dependencies: [],
    locale: 'en',
    entities: [],
    overrides: [],
    assets: [],
    i18n: {},
    strings: {},
  };
}

const CORE = { id: 'srd-5e-2024', version: '0.1.0' };
const CORE_PACK = mkPack(CORE.id, CORE.version, 'core');

describe('updatesFor (plan 15 Task 5)', () => {
  it('orders versions by semver precedence, not by string: 1.0.0 < 1.1.0 < 2.0.0 < 10.0.0', () => {
    const installed = ['1.1.0', '10.0.0', '2.0.0', '1.0.0'].map((v) => mkPack('a', v));
    expect(updatesFor({ [CORE.id]: CORE.version, a: '1.0.0' }, installed, CORE)).toEqual([
      { packId: 'a', from: '1.0.0', to: '10.0.0', kind: 'content' },
    ]);
    const withoutTen = installed.filter((p) => p.version !== '10.0.0');
    expect(updatesFor({ a: '1.1.0' }, withoutTen, CORE)).toEqual([
      { packId: 'a', from: '1.1.0', to: '2.0.0', kind: 'content' },
    ]);
  });

  it('picks the HIGHEST installed version above the pin', () => {
    const installed = [mkPack('a', '1.0.0'), mkPack('a', '1.2.0'), mkPack('a', '1.1.0')];
    expect(updatesFor({ a: '1.0.0' }, installed, CORE)).toEqual([
      { packId: 'a', from: '1.0.0', to: '1.2.0', kind: 'content' },
    ]);
  });

  it('offers no update when the pin is the highest, or only lower versions are installed', () => {
    expect(updatesFor({ a: '1.0.0' }, [mkPack('a', '1.0.0')], CORE)).toEqual([]);
    expect(updatesFor({ a: '2.0.0' }, [mkPack('a', '1.0.0'), mkPack('a', '1.5.0')], CORE)).toEqual(
      [],
    );
    expect(updatesFor({ a: '1.0.0' }, [], CORE)).toEqual([]);
  });

  it('a pinned version that is not installed still updates to a higher installed one', () => {
    expect(updatesFor({ a: '1.0.0' }, [mkPack('a', '1.1.0')], CORE)).toEqual([
      { packId: 'a', from: '1.0.0', to: '1.1.0', kind: 'content' },
    ]);
  });

  it('prerelease rule: semver precedence (1.1.0-beta.1 is above 1.0.0 and below 1.1.0)', () => {
    expect(updatesFor({ a: '1.0.0' }, [mkPack('a', '1.1.0-beta.1')], CORE)).toEqual([
      { packId: 'a', from: '1.0.0', to: '1.1.0-beta.1', kind: 'content' },
    ]);
    expect(updatesFor({ a: '1.1.0' }, [mkPack('a', '1.1.0-beta.1')], CORE)).toEqual([]);
    expect(
      updatesFor({ a: '1.1.0-beta.1' }, [mkPack('a', '1.1.0-beta.2'), mkPack('a', '1.1.0')], CORE),
    ).toEqual([{ packId: 'a', from: '1.1.0-beta.1', to: '1.1.0', kind: 'content' }]);
  });

  it('ignores packs of another id, translation packs, and installed packs the character does not pin', () => {
    const installed = [
      mkPack('a', '1.0.0'),
      mkPack('b', '9.0.0'),
      mkPack('a', '3.0.0', 'translation'),
    ];
    expect(updatesFor({ a: '1.0.0' }, installed, CORE)).toEqual([]);
  });

  it('the core: no update (no downgrade) when the pinned core is NEWER than the shipped one', () => {
    expect(updatesFor({ [CORE.id]: '0.2.0' }, [CORE_PACK], CORE)).toEqual([]);
    expect(updatesFor({ [CORE.id]: '0.2.0-beta.1' }, [CORE_PACK], CORE)).toEqual([]);
  });

  it('a malformed pinned version yields no update and never throws', () => {
    const installed = [CORE_PACK, mkPack('a', '2.0.0')];
    expect(() =>
      updatesFor({ [CORE.id]: 'not-a-version', a: 'v1?' }, installed, CORE),
    ).not.toThrow();
    expect(updatesFor({ [CORE.id]: 'not-a-version', a: 'v1?' }, installed, CORE)).toEqual([]);
  });

  it('the core: an update to the shipped version when the pinned core is older (ruling 6)', () => {
    expect(updatesFor({ [CORE.id]: '0.0.9' }, [CORE_PACK], CORE)).toEqual([
      { packId: CORE.id, from: '0.0.9', to: '0.1.0', kind: 'core' },
    ]);
    expect(updatesFor({ [CORE.id]: CORE.version }, [CORE_PACK], CORE)).toEqual([]);
    // No core pin at all (a legacy pin set): nothing to bump.
    expect(updatesFor({}, [CORE_PACK], CORE)).toEqual([]);
  });

  it('is sorted by packId and deterministic', () => {
    const installed = [mkPack('zeta', '2.0.0'), mkPack('alpha', '2.0.0'), CORE_PACK];
    const pins = { zeta: '1.0.0', [CORE.id]: '0.0.1', alpha: '1.0.0' };
    const result = updatesFor(pins, installed, CORE);
    expect(result.map((u) => u.packId)).toEqual(['alpha', CORE.id, 'zeta']);
    expect(updatesFor(pins, [...installed].reverse(), CORE)).toEqual(result);
  });
});
