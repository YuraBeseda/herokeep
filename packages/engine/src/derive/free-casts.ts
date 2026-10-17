import { parseEntityId } from '@hk/protocol';
import type { ContentIndex } from '../content/index.ts';
import { type Diagnostic, warning } from '../diagnostics.ts';
import type { AbilitiesResult } from './abilities.ts';
import type { ResourceView } from './resources.ts';

/**
 * Plan 13 task 4 — one way to cast `spellId` WITHOUT a spell slot, paid by one use of `resourceId`
 * (`propose.cast`'s `freeResource` lane). `level` is the only level the free lane casts at: the
 * grant's own `level` when authored, else the spell's base level — there is no slot to upcast with.
 */
export interface FreeCast {
  spellId: string;
  resourceId: string;
  level: number;
}

/**
 * One `FreeCast` per active (post-`when`, post-deferral) `spell.grant` carrying `uses`, deduped by
 * spell+resource in effect order. The counter is the referenced resource (`uses.resource`) or, for an
 * inline `uses {count, per}`, the one `deriveResources` materialized under the spell's slug. A
 * reference to a resource the sheet does not have is never offered (`derive.freeCastResourceMissing`);
 * a grant whose spell does not resolve is skipped (the content validator already reports the ref).
 */
export function deriveFreeCasts(
  abilities: AbilitiesResult,
  index: ContentIndex,
  resources: readonly ResourceView[],
): { freeCasts: FreeCast[]; issues: Diagnostic[] } {
  const freeCasts: FreeCast[] = [];
  const issues: Diagnostic[] = [];
  for (const ae of abilities.effects) {
    const eff = ae.effect;
    if (eff.type !== 'spell.grant' || !eff.uses) continue;
    const spell = index.get(eff.spell);
    if (spell?.type !== 'spell') continue;
    const resourceId = 'resource' in eff.uses ? eff.uses.resource : (parseEntityId(eff.spell)?.slug ?? eff.spell);
    if (!resources.some((r) => r.id === resourceId)) {
      issues.push(
        warning(
          'derive.freeCastResourceMissing',
          `Free casts of "${eff.spell}" name missing resource "${resourceId}"`,
          {
            entityId: ae.feature ?? ae.source,
          },
        ),
      );
      continue;
    }
    if (freeCasts.some((f) => f.spellId === eff.spell && f.resourceId === resourceId)) continue;
    freeCasts.push({ spellId: eff.spell, resourceId, level: eff.level ?? spell.level });
  }
  return { freeCasts, issues };
}
