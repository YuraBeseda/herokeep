import type { DraftEvent } from '../../stores/character.store';

/**
 * Pure `DraftEvent` builders for the DM effects panel (plan-10 task-11-brief.md). Every builder
 * targets the CHARACTER stream (`char:<id>`, via `CampaignStore.gatewayAppend` — the caller's
 * job, not this module's) and matches the SCHEMA authority
 * (`packages/protocol/src/events/character.ts`), not doc-02's shorthand, wherever the two differ:
 *
 * - doc-02 calls it "xp.granted"; the real registered type is `xp.awarded@1`
 *   (`XpAwardedV1 = {amount, reason?}`).
 * - `hp.changed@1`'s `delta` is NOT always a delta: for `kind: 'damage'`/`'heal'`/`'temp'` it is a
 *   signed/magnitude delta the reducer arithmetically applies against the character's PRIOR
 *   `current`/`temp` (`packages/engine/src/reduce/handlers/vitals.ts`); for `kind: 'set'` the SAME
 *   field is instead the ABSOLUTE new `current` value, no arithmetic at all. This module mirrors
 *   `packages/engine/src/propose/vitals.ts`'s own damage/heal clamping (reachable-HP for damage,
 *   headroom-to-max for heal) so a DM's typed "amount" produces the same well-formed delta the
 *   owner's own device would — the reducer floors `current` at 0 unconditionally, but nothing
 *   stops it from being told to ADD past `max` on a heal (the reducer never clamps `heal` to max
 *   itself; only the propose layer does), so skipping this clamping here would let overhealing
 *   silently inflate `current` past the sheet's real cap.
 */

/** The character's current HP baseline the DM effects panel composes damage/heal/temp deltas
 * against — from whatever source is available where the panel is mounted (task-11-brief.md's own
 * "hp delta source" note): `state.overviews` (`PartyOverview`, party-card mode) or a live
 * subscribed `Sheet` (member-sheet dialog, 'full' mode). `currentWasMax` is only ever knowable from
 * a real `Sheet` (`derive/hp.ts`'s own additive flag) — `PartyOverviewUpdatedV1` carries no such
 * field, so overview-mode callers pass it `undefined` (treated as "already resolved"). */
export interface HpSnapshot {
  readonly current: number;
  readonly max: number;
  readonly temp: number;
  readonly currentWasMax?: boolean;
}

/** Mirrors `propose/vitals.ts`'s `resolveMaxSentinel`: when the character's `facts.hp.current` is
 * still the long-rest `'max'` sentinel, a raw `damage`/`heal` reducer case skips with
 * `'hp-unresolved'` (it has no rules-free way to do arithmetic against the sentinel) — so this
 * prepends a resolving `hp.changed {kind: 'set', delta: hp.max}` event first, in the SAME batch,
 * exactly like the owner's own device would. Never applies to `'temp'` (the reducer's `temp` case
 * never reads prior `current`, so no sentinel resolution is needed there either). */
function resolveMaxSentinel(hp: HpSnapshot): DraftEvent[] {
  return hp.currentWasMax
    ? [{ type: 'hp.changed', v: 1, payload: { delta: hp.max, kind: 'set' } }]
    : [];
}

/** Damage clamps to reachable HP (`current + temp`) so the recorded delta matches what actually
 * happened — same reasoning as `propose.damage`. Returns one or two drafts (a leading sentinel
 * resolve, when needed, plus the damage event itself) for a single `gatewayAppend` batch. */
export function damageDraft(amount: number, hp: HpSnapshot): DraftEvent[] {
  const resolve = resolveMaxSentinel(hp);
  const reachable = Math.max(0, Math.min(amount, hp.current + hp.temp));
  // `reachable === 0 ? 0 : -reachable` (not a bare `-reachable`): negating a floored-to-zero
  // amount produces `-0`, which is schema-valid (`z.int()`) but deep-equality-distinct from `0`
  // in tests and needlessly surprising in the timeline's own rendered sentence.
  const delta = reachable === 0 ? 0 : -reachable;
  return [...resolve, { type: 'hp.changed', v: 1, payload: { delta, kind: 'damage' } }];
}

/** Heal clamps to the headroom below max — overhealing is what temp HP is for. */
export function healDraft(amount: number, hp: HpSnapshot): DraftEvent[] {
  const resolve = resolveMaxSentinel(hp);
  const reachable = Math.max(0, Math.min(amount, hp.max - hp.current));
  return [...resolve, { type: 'hp.changed', v: 1, payload: { delta: reachable, kind: 'heal' } }];
}

/** `temp` never reads prior `current` (handlers/vitals.ts), so it needs no sentinel resolution —
 * always exactly one draft. */
export function tempHpDraft(amount: number): DraftEvent[] {
  return [{ type: 'hp.changed', v: 1, payload: { delta: Math.max(0, amount), kind: 'temp' } }];
}

/** `condition.added@1`/`condition.removed@1` (`ConditionAddedV1`/`ConditionRemovedV1`,
 * `character.ts`) — `level` only for a level-bearing condition (exhaustion), never sent otherwise
 * (an explicit `undefined` key would fail the schema's `strictObject`). */
export function conditionDraft(conditionId: string, add: boolean, level?: number): DraftEvent {
  return add
    ? {
        type: 'condition.added',
        v: 1,
        payload: { conditionId, ...(level !== undefined ? { level } : {}) },
      }
    : { type: 'condition.removed', v: 1, payload: { conditionId } };
}

/** `inspiration.changed@1` (`InspirationChangedV1 = {value: boolean}`). */
export function inspirationDraft(value: boolean): DraftEvent {
  return { type: 'inspiration.changed', v: 1, payload: { value } };
}

/** `xp.awarded@1` (`XpAwardedV1 = {amount, reason?}`) — doc-02's catalog shorthand calls this
 * "xp.granted"; the schema's REAL registered type is `xp.awarded`. Gated by the panel to
 * `houseRules.xpMode === 'xp'` (a milestone-mode campaign grants levels directly instead). */
export function xpAwardedDraft(amount: number, reason?: string): DraftEvent {
  return { type: 'xp.awarded', v: 1, payload: { amount, ...(reason ? { reason } : {}) } };
}

/** `level.granted@1` (`LevelGrantedV1 = {count?: 1}`) — milestone-mode's DM-driven leveling.
 * Omitting `count` entirely is valid (doc-02: "{count?: 1}", the schema's own `.optional()`) — the
 * panel only sends it when the DM typed something other than the implied default of 1. */
export function levelGrantedDraft(count?: number): DraftEvent {
  return { type: 'level.granted', v: 1, payload: count !== undefined ? { count } : {} };
}

/** `item.added@1` (`ItemAddedV1 = {instanceId, itemId?, qty, name?, custom?}`) — a DM ad-hoc grant
 * has no resolved pack `itemId` (v1 scope: a freeform name, not the play tab's own
 * `hk-entity-picker` pack lookup — see task-11-report.md's judgment calls); `instanceId` is
 * caller-generated (`uuidv7()`, the same convention `play-tab.component.ts`'s own item-add flow
 * uses) since the schema requires it on every `item.added`, never minted by the reducer. */
export function itemGrantDraft(instanceId: string, qty: number, name?: string): DraftEvent {
  return { type: 'item.added', v: 1, payload: { instanceId, qty, ...(name ? { name } : {}) } };
}

/** `override.applied@1` (`OverrideAppliedV1 = {path, value, reason}`) — `reason` is REQUIRED by
 * the schema itself (`ShortTextSchema`, `.min(1)`), matching the brief's own "reason required in
 * the dialog" instruction; this builder doesn't re-validate that (the panel's own confirm gating
 * does), it just never emits an empty string either way. */
export function overrideAppliedDraft(path: string, value: unknown, reason: string): DraftEvent {
  return { type: 'override.applied', v: 1, payload: { path, value, reason } };
}
