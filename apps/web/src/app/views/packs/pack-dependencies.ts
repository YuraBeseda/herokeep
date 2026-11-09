import type { Pack } from '@hk/protocol';
import semver from 'semver';

/** A dependency as the screens say it: the pack's display name and a version phrase, not the raw
 * id and semver range. */
export interface DependencyView {
  readonly id: string;
  /** The installed pack's display name; the id only while the pack is not installed at all. */
  readonly name: string;
  /** The lowest version the range accepts (`^0.1.0` and `>=0.1.0` both give `0.1.0`), if any. */
  readonly minVersion: string | null;
  /** The range names exactly one version. */
  readonly exact: boolean;
  /** The newest installed version that satisfies the range, if any. */
  readonly installed: string | null;
}

/** Resolves each `{id, range}` against the installed packs (core included). */
export function resolveDependencies(
  dependencies: readonly { readonly id: string; readonly range: string }[],
  installed: readonly Pack[],
): readonly DependencyView[] {
  return dependencies.map((dep) => {
    const range = semver.validRange(dep.range);
    const satisfying = installed
      .filter((p) => p.id === dep.id && range !== null && semver.satisfies(p.version, range))
      .sort((a, b) => semver.rcompare(a.version, b.version));
    return {
      id: dep.id,
      name: installed.find((p) => p.id === dep.id)?.name ?? dep.id,
      minVersion: range === null ? null : (semver.minVersion(range)?.version ?? null),
      exact: semver.valid(dep.range) !== null,
      installed: satisfying[0]?.version ?? null,
    };
  });
}
