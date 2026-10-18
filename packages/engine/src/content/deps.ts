import { PACK_LIMITS, type Pack } from '@hk/protocol';
import semver from 'semver';
import { type Diagnostic, error } from '../diagnostics.ts';

export type Pins = Record<string, string>;

export function selectPackVersions(
  packs: Pack[],
  pins: Pins = {},
): { selected: Map<string, Pack>; diagnostics: Diagnostic[] } {
  const byId = new Map<string, Pack[]>();
  for (const p of packs) byId.set(p.id, [...(byId.get(p.id) ?? []), p]);
  const selected = new Map<string, Pack>();
  const diagnostics: Diagnostic[] = [];
  for (const [id, versions] of byId) {
    const pin = pins[id];
    if (pin !== undefined) {
      const hit = versions.find((p) => p.version === pin);
      if (hit) selected.set(id, hit);
      else
        diagnostics.push(
          error(
            'deps.pinMissing',
            `Pinned version ${id}@${pin} is not available (have ${versions.map((v) => v.version).join(', ')})`,
          ),
        );
      continue;
    }
    const best = [...versions].sort((a, b) => semver.rcompare(a.version, b.version))[0]!;
    selected.set(id, best);
  }
  return { selected, diagnostics };
}

/**
 * The `roots` for a per-character content index (plan 15): every pinned pack id, then every
 * translation pack among `packs` whose `translates.id` is a pinned pack or one of their
 * (transitive) dependencies, sorted by id. `resolveDependencyOrder` walks from a translation to the
 * pack it translates, but never the other way, so a root set of pinned content ids alone would
 * leave their translations out of the index.
 *
 * Dependencies are followed through the versions `selectPackVersions(packs, pins)` selects. A pin
 * whose pack is not in `packs` stays a root, so the index reports it (`deps.missing` or
 * `deps.pinMissing`) instead of silently dropping it.
 */
export function pinnedRoots(packs: Pack[], pins: Pins): string[] {
  const { selected } = selectPackVersions(packs, pins);
  const reached = new Set<string>();
  const pending = Object.keys(pins);
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const dep of selected.get(id)?.dependencies ?? []) pending.push(dep.id);
  }
  const translations = [...selected.values()]
    .filter((p) => p.kind === 'translation' && p.translates !== undefined && reached.has(p.translates.id))
    .map((p) => p.id)
    .filter((id) => !(id in pins))
    .sort();
  return [...Object.keys(pins), ...translations];
}

export function resolveDependencyOrder(
  selected: Map<string, Pack>,
  roots: string[],
): { order: Pack[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const order: Pack[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (id: string, depth: number, chain: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      diagnostics.push(error('deps.cycle', `Dependency cycle: ${[...chain, id].join(' → ')}`));
      return;
    }
    if (depth > PACK_LIMITS.maxDependencyDepth) {
      diagnostics.push(
        error(
          'deps.depth',
          `Dependency depth exceeds ${PACK_LIMITS.maxDependencyDepth} at ${[...chain, id].join(' → ')}`,
        ),
      );
      return;
    }
    const pack = selected.get(id);
    if (!pack) {
      diagnostics.push(
        error('deps.missing', `Missing pack "${id}" (required by ${chain[chain.length - 1] ?? 'roots'})`),
      );
      return;
    }
    state.set(id, 'visiting');
    for (const dep of pack.dependencies) {
      const target = selected.get(dep.id);
      if (target && !semver.satisfies(target.version, dep.range)) {
        diagnostics.push(
          error('deps.versionMismatch', `${pack.id} needs ${dep.id}@${dep.range} but ${target.version} is selected`),
        );
        continue;
      }
      visit(dep.id, depth + 1, [...chain, id]);
    }
    if (pack.kind === 'translation' && pack.translates) visit(pack.translates.id, depth + 1, [...chain, id]);
    state.set(id, 'done');
    order.push(pack);
  };

  for (const root of roots) visit(root, 0, []);
  return { order, diagnostics };
}
