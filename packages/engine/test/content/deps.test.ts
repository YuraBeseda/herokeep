import { type Pack } from '@hk/protocol';
import { describe, expect, it } from 'vitest';
import { resolveDependencyOrder, selectPackVersions } from '../../src/content/deps.ts';
import { loadFixturePack } from '../support/fixtures.ts';

const core = loadFixturePack('core-mini');
const content = loadFixturePack('content-mini');
const mk = (id: string, version: string, deps: { id: string; range: string }[] = []): Pack => ({
  ...content,
  id,
  version,
  dependencies: deps,
  entities: [],
  overrides: [],
  i18n: {},
});

describe('selectPackVersions', () => {
  it('prefers pinned versions, else the highest', () => {
    const v1 = mk('x', '1.0.0');
    const v2 = mk('x', '1.5.0');
    expect(selectPackVersions([v1, v2]).selected.get('x')?.version).toBe('1.5.0');
    expect(selectPackVersions([v1, v2], { x: '1.0.0' }).selected.get('x')?.version).toBe('1.0.0');
    const r = selectPackVersions([v1], { x: '9.9.9' });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['deps.pinMissing']);
  });
});

describe('resolveDependencyOrder', () => {
  it('orders dependencies first', () => {
    const { order, diagnostics } = resolveDependencyOrder(
      new Map([
        [core.id, core],
        [content.id, content],
      ]),
      [content.id],
    );
    expect(diagnostics).toEqual([]);
    expect(order.map((p) => p.id)).toEqual(['core-mini', 'homebrew-mini']);
  });

  it('reports missing dependencies and version mismatches', () => {
    const onlyContent = resolveDependencyOrder(new Map([[content.id, content]]), [content.id]);
    expect(onlyContent.diagnostics.map((d) => d.code)).toEqual(['deps.missing']);
    const mismatch = resolveDependencyOrder(
      new Map([
        [core.id, { ...core, version: '2.0.0' }],
        [content.id, content],
      ]),
      [content.id],
    );
    expect(mismatch.diagnostics.map((d) => d.code)).toEqual(['deps.versionMismatch']);
  });

  it('detects cycles and depth', () => {
    const a = mk('aaa', '1.0.0', [{ id: 'bbb', range: '^1' }]);
    const b = mk('bbb', '1.0.0', [{ id: 'aaa', range: '^1' }]);
    expect(
      resolveDependencyOrder(
        new Map([
          ['aaa', a],
          ['bbb', b],
        ]),
        ['aaa'],
      ).diagnostics.map((d) => d.code),
    ).toContain('deps.cycle');
    const chain = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, i, all) =>
      mk(id, '1.0.0', i < all.length - 1 ? [{ id: all[i + 1]!, range: '^1' }] : []),
    );
    const deep = resolveDependencyOrder(new Map(chain.map((p) => [p.id, p])), ['p1']);
    expect(deep.diagnostics.map((d) => d.code)).toContain('deps.depth');
  });
});
