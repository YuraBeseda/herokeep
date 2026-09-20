/**
 * Plan-9 Task 2 — EVENT_ACTORS reconciliation (character-stream dm-grants audit).
 *
 * Pins every character-stream `EVENT_ACTORS` entry that grants `'dm'` to the doc-08
 * (docs/02-architecture/08-security-permissions-quotas.md § "Authorization matrix") row —
 * or, where doc-08 is silent, the ADR-012 (docs/01-decisions/ADR-012-identity-and-security.md
 * § "Authorization model") table line, or doc-02's
 * (docs/02-architecture/02-domain-model-and-events.md § "Event catalog — character stream")
 * per-type Actor column — that authorizes it. Test names cite the source verbatim so a future
 * doc change that breaks one of these citations breaks a specifically-named test, not a
 * generic "actors changed" failure.
 */
import { describe, expect, it } from 'vitest';
import { EVENT_ACTORS } from '../src/events/character.ts';

describe('character-stream EVENT_ACTORS — doc-08 "Append DM events" row (hp.changed, condition.*, xp.awarded, item.added/removed, level.granted, currency.changed, inspiration.changed | Owner ✔ (solo/self) | DM ✔)', () => {
  it('hp.changed: owner + dm', () => {
    expect(EVENT_ACTORS['hp.changed']).toEqual(['owner', 'dm']);
  });
  it('condition.added / condition.removed: owner + dm', () => {
    expect(EVENT_ACTORS['condition.added']).toEqual(['owner', 'dm']);
    expect(EVENT_ACTORS['condition.removed']).toEqual(['owner', 'dm']);
  });
  it('xp.awarded: dm + owner(solo)', () => {
    expect(EVENT_ACTORS['xp.awarded']).toEqual(['dm', 'owner']);
  });
  it('item.added / item.removed: owner + dm', () => {
    expect(EVENT_ACTORS['item.added']).toEqual(['owner', 'dm']);
    expect(EVENT_ACTORS['item.removed']).toEqual(['owner', 'dm']);
  });
  it('currency.changed: owner + dm', () => {
    expect(EVENT_ACTORS['currency.changed']).toEqual(['owner', 'dm']);
  });
  it('inspiration.changed: owner + dm', () => {
    expect(EVENT_ACTORS['inspiration.changed']).toEqual(['owner', 'dm']);
  });
  it(
    'level.granted: dm-only despite the row\'s literal "(solo/self)" text — doc-02\'s per-type ' +
      'table (line "`level.granted` | D | ... | milestone mode") is the ONLY dm.*-class row that ' +
      'withholds Owner, deliberately (every sibling row in the same doc-02 table carries an O); ' +
      'OWNER-FLAGged, kept dm-only',
    () => {
      expect(EVENT_ACTORS['level.granted']).toEqual(['dm']);
    },
  );
});

describe('character-stream EVENT_ACTORS — doc-08 explicit single-row grants', () => {
  it('override.applied: "✔ (solo) | ✔ | ✖ | ✖" → owner(solo) + dm', () => {
    expect(EVENT_ACTORS['override.applied']).toEqual(['dm', 'owner']);
  });
  it(
    'event.reverted: "own events | any | ✖ | ✖" → role list is owner + dm ' +
      "(the own-vs-any SCOPE restriction is enforced by permissions.ts's canRevertOwn, not by " +
      'this role list)',
    () => {
      expect(EVENT_ACTORS['event.reverted']).toEqual(['owner', 'dm']);
    },
  );
  it(
    'character.owner_transferred: "✔ | ✔ (pregens) | ✖ | ✖" → owner + dm; ' +
      'also ADR-012\'s DM cell names it explicitly ("character.owner_transferred (claim flows)")',
    () => {
      expect(EVENT_ACTORS['character.owner_transferred']).toEqual(['dm', 'owner']);
    },
  );
});

describe("character-stream EVENT_ACTORS — doc-08 has no dedicated row; doc-02's per-type Actor column is the textual support", () => {
  it('character.campaign_joined: doc-02 "`character.campaign_joined` / `character.campaign_left` | O, D | ... | mirrored on campaign stream" → owner + dm', () => {
    expect(EVENT_ACTORS['character.campaign_joined']).toEqual(['owner', 'dm']);
  });
  it('character.campaign_left: same doc-02 row as campaign_joined → owner + dm', () => {
    expect(EVENT_ACTORS['character.campaign_left']).toEqual(['owner', 'dm']);
  });
});

describe('character-stream EVENT_ACTORS — doc-08 "Append owner events (..., pack.pinned)" row: DM only via override.applied, never direct append', () => {
  it(
    'character.renamed CORRECTED to owner-only: doc-02 "`character.renamed` | O, D(override) | {name}" ' +
      "explicitly marks the DM path as override-only, matching doc-08's row; the Phase-2 " +
      "['owner','dm'] direct grant had no textual support and is corrected",
    () => {
      expect(EVENT_ACTORS['character.renamed']).toEqual(['owner']);
    },
  );
  it('pack.pinned stays owner-only (already corrected pre-plan-9; re-pinned here for completeness)', () => {
    expect(EVENT_ACTORS['pack.pinned']).toEqual(['owner']);
  });
});

describe('character-stream EVENT_ACTORS — OWNER-FLAGged: doc-08\'s "in-play" bucket (row 2, override-only for DM) textually conflicts with doc-02\'s plain "O, D" (no override qualifier) for these five types; kept dm-granted per doc-02 + product reading (DM narrating on-the-fly mechanics for an unavailable player), flagged for owner review', () => {
  it('death_save.recorded: doc-02 "`death_save.recorded` | O, D | ..." (no override annotation)', () => {
    expect(EVENT_ACTORS['death_save.recorded']).toEqual(['owner', 'dm']);
  });
  it('stabilized: doc-02 "`stabilized` | O, D | {}"', () => {
    expect(EVENT_ACTORS['stabilized']).toEqual(['owner', 'dm']);
  });
  it('resource.spent / resource.restored: doc-02 "`resource.spent` / `resource.restored` | O, D | ..."', () => {
    expect(EVENT_ACTORS['resource.spent']).toEqual(['owner', 'dm']);
    expect(EVENT_ACTORS['resource.restored']).toEqual(['owner', 'dm']);
  });
  it('concentration.started / concentration.ended: doc-02 "`concentration.started` / `concentration.ended` | O, D | ..."', () => {
    expect(EVENT_ACTORS['concentration.started']).toEqual(['owner', 'dm']);
    expect(EVENT_ACTORS['concentration.ended']).toEqual(['owner', 'dm']);
  });
});

describe('the audit is exhaustive over every dm-granting character-stream entry', () => {
  it("every EVENT_ACTORS entry that includes 'dm' was covered by one of the describe blocks above", () => {
    const dmGranting = Object.entries(EVENT_ACTORS)
      .filter(([, roles]) => roles.includes('dm'))
      .map(([type]) => type)
      .sort();
    const audited = [
      'character.owner_transferred',
      'character.campaign_joined',
      'character.campaign_left',
      'xp.awarded',
      'hp.changed',
      'death_save.recorded',
      'stabilized',
      'level.granted',
      'resource.spent',
      'resource.restored',
      'concentration.started',
      'concentration.ended',
      'condition.added',
      'condition.removed',
      'item.added',
      'item.removed',
      'currency.changed',
      'inspiration.changed',
      'override.applied',
      'event.reverted',
    ].sort();
    expect(dmGranting).toEqual(audited);
  });
});
