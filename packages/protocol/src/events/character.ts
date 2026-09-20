import { z } from 'zod';
import { EntityIdSchema, PackIdSchema, SlugSchema } from '../ids.ts';
import { ChoiceIdSchema } from '../pack/choice.ts';
import { BlobHashSchema, SemverSchema } from '../pack/common.ts';
import { LongTextSchema, ShortTextSchema } from '../pack/enums.ts';
import { type ActorRole, UUID } from './envelope.ts';

export const GrammaticalGenderSchema = z.enum(['masculine', 'feminine', 'neuter']);
export type GrammaticalGender = z.infer<typeof GrammaticalGenderSchema>;

// --- Identity & lifecycle ---------------------------------------------------

export const CharacterCreatedV1 = z.strictObject({
  name: ShortTextSchema,
  system: SlugSchema,
  corePack: z.strictObject({ id: PackIdSchema, version: SemverSchema }),
  engineVersion: SemverSchema,
  grammaticalGender: GrammaticalGenderSchema,
});
export const CharacterRenamedV1 = z.strictObject({ name: ShortTextSchema });
export const CharacterAppearanceSetV1 = z.strictObject({
  age: ShortTextSchema.optional(),
  height: ShortTextSchema.optional(),
  weight: ShortTextSchema.optional(),
  eyes: ShortTextSchema.optional(),
  hair: ShortTextSchema.optional(),
  skin: ShortTextSchema.optional(),
  description: LongTextSchema.optional(),
});
export const CharacterGenderSetV1 = z.strictObject({ grammaticalGender: GrammaticalGenderSchema });
export const CharacterArchivedV1 = z.strictObject({});
export const CharacterRestoredV1 = z.strictObject({});
export const CharacterOwnerTransferredV1 = z.strictObject({ toUserId: z.string().min(1).max(64) });
export const CharacterCampaignJoinedV1 = z.strictObject({ campaignId: z.string().regex(UUID) });
export const CharacterCampaignLeftV1 = z.strictObject({ campaignId: z.string().regex(UUID) });

// --- Pack pins & builder decisions -------------------------------------------

export const PackPinnedV1 = z.strictObject({
  packId: PackIdSchema,
  version: SemverSchema,
  previous: SemverSchema.optional(),
});
export const DecisionMadeV1 = z.strictObject({
  choiceId: ChoiceIdSchema,
  selection: z.array(z.string().min(1).max(200)).max(20),
  context: z.record(z.string().max(64), z.unknown()).optional(),
});
export const DecisionClearedV1 = z.strictObject({ choiceId: ChoiceIdSchema });

// --- Leveling & XP -------------------------------------------------------------

export const LevelGainedV1 = z.strictObject({
  classId: EntityIdSchema,
  level: z.int().min(1).max(20),
  hpRoll: z.union([z.int().min(1), z.literal('average')]).optional(),
  subclassId: EntityIdSchema.optional(),
});
export const LevelGrantedV1 = z.strictObject({ count: z.int().min(1).optional() });
export const XpAwardedV1 = z.strictObject({ amount: z.int(), reason: ShortTextSchema.optional() });

// --- HP, hit dice, death saves --------------------------------------------------

export const HpChangedV1 = z.strictObject({
  delta: z.int(),
  kind: z.enum(['damage', 'heal', 'temp', 'set']),
  source: ShortTextSchema.optional(),
  damageType: SlugSchema.optional(),
});
export const HitDiceSpentV1 = z.strictObject({
  classId: EntityIdSchema,
  count: z.int().min(1),
  healed: z.int().min(0).optional(),
});
export const HitDiceRegainedV1 = z.strictObject({
  classId: EntityIdSchema,
  count: z.int().min(1),
  healed: z.int().min(0).optional(),
});
export const DeathSaveRecordedV1 = z.strictObject({
  result: z.enum(['success', 'failure', 'critSuccess', 'critFailure']),
});
export const StabilizedV1 = z.strictObject({});

// --- Slots & resources -----------------------------------------------------------

export const SlotSpentV1 = z.strictObject({
  level: z.int().min(1).max(9),
  pact: z.boolean().optional(),
  count: z.int().min(1).optional(),
});
export const SlotRestoredV1 = z.strictObject({
  level: z.int().min(1).max(9),
  pact: z.boolean().optional(),
  count: z.int().min(1).optional(),
});
export const ResourceSpentV1 = z.strictObject({ resourceId: SlugSchema, count: z.int().min(1).optional() });
export const ResourceRestoredV1 = z.strictObject({ resourceId: SlugSchema, count: z.int().min(1).optional() });

// --- Spells --------------------------------------------------------------------------

export const SpellPreparedV1 = z.strictObject({ spellId: EntityIdSchema, classId: EntityIdSchema });
export const SpellUnpreparedV1 = z.strictObject({ spellId: EntityIdSchema, classId: EntityIdSchema });
export const SpellLearnedV1 = z.strictObject({
  spellId: EntityIdSchema,
  classId: EntityIdSchema,
  source: z.enum(['levelUp', 'scroll', 'copy']),
});
export const SpellForgottenV1 = z.strictObject({
  spellId: EntityIdSchema,
  classId: EntityIdSchema,
  source: z.enum(['levelUp', 'scroll', 'copy']),
});
export const SpellCastV1 = z.strictObject({
  spellId: EntityIdSchema,
  level: z.int().min(0).max(9),
  slotUsed: z.boolean().optional(),
  concentration: z.boolean().optional(),
});
export const ConcentrationStartedV1 = z.strictObject({ spellId: EntityIdSchema.optional() });
export const ConcentrationEndedV1 = z.strictObject({ spellId: EntityIdSchema.optional() });

// --- Conditions ----------------------------------------------------------------------

export const ConditionAddedV1 = z.strictObject({
  conditionId: EntityIdSchema,
  source: ShortTextSchema.optional(),
  until: ShortTextSchema.optional(),
  level: z.int().min(1).optional(),
});
export const ConditionRemovedV1 = z.strictObject({
  conditionId: EntityIdSchema,
  source: ShortTextSchema.optional(),
  until: ShortTextSchema.optional(),
  level: z.int().min(1).optional(),
});

// --- Inventory & currency --------------------------------------------------------------

export const ItemAddedV1 = z.strictObject({
  instanceId: z.string().regex(UUID),
  itemId: EntityIdSchema.optional(), // absent for fully custom items
  qty: z.int().min(1),
  name: ShortTextSchema.optional(),
  custom: z.record(z.string().max(64), z.unknown()).optional(),
});
export const ItemRemovedV1 = z.strictObject({ instanceId: z.string().regex(UUID), qty: z.int().min(1).optional() });
export const ItemEquippedV1 = z.strictObject({ instanceId: z.string().regex(UUID), slot: SlugSchema.optional() });
export const ItemUnequippedV1 = z.strictObject({ instanceId: z.string().regex(UUID), slot: SlugSchema.optional() });
export const ItemAttunedV1 = z.strictObject({ instanceId: z.string().regex(UUID) });
export const ItemUnattunedV1 = z.strictObject({ instanceId: z.string().regex(UUID) });
export const ItemUpdatedV1 = z.strictObject({
  instanceId: z.string().regex(UUID),
  name: ShortTextSchema.optional(),
  notes: ShortTextSchema.optional(),
  qty: z.int().min(1).optional(),
});
export const CurrencyChangedV1 = z.strictObject({
  cp: z.int().optional(),
  sp: z.int().optional(),
  ep: z.int().optional(),
  gp: z.int().optional(),
  pp: z.int().optional(),
});

// --- Rest & inspiration -----------------------------------------------------------------

export const RestTakenV1 = z.strictObject({
  kind: z.enum(['short', 'long']),
  hitDiceSpent: z.array(z.strictObject({ classId: EntityIdSchema, count: z.int().min(1) })).optional(),
});
export const InspirationChangedV1 = z.strictObject({ value: z.boolean() });

// --- Notes -----------------------------------------------------------------------------

export const NoteAddedV1 = z.strictObject({
  id: z.string().regex(UUID),
  title: ShortTextSchema.optional(),
  body: z.string().max(8192).optional(),
});
export const NoteUpdatedV1 = z.strictObject({
  id: z.string().regex(UUID),
  title: ShortTextSchema.optional(),
  body: z.string().max(8192).optional(),
});
export const NoteRemovedV1 = z.strictObject({
  id: z.string().regex(UUID),
  title: ShortTextSchema.optional(),
  body: z.string().max(8192).optional(),
});

// --- Portrait --------------------------------------------------------------------------

export const PortraitSetV1 = z.strictObject({
  hash: BlobHashSchema,
  thumbHash: z.string().min(1).max(256),
  mime: z.string().min(1).max(64),
  w: z.int().min(1),
  h: z.int().min(1),
});
export const PortraitClearedV1 = z.strictObject({});

// --- Overrides & history ----------------------------------------------------------------

export const OverrideAppliedV1 = z.strictObject({
  path: z.string().min(1).max(128),
  value: z.unknown(),
  reason: ShortTextSchema,
});
export const EventRevertedV1 = z
  .strictObject({
    targetId: z.string().regex(UUID).optional(),
    txId: z.string().regex(UUID).optional(),
    reason: ShortTextSchema.optional(),
  })
  .refine((p) => p.targetId !== undefined || p.txId !== undefined, { message: 'targetId or txId required' });
export const HistoryCompactedV1 = z.strictObject({ throughSeq: z.int().min(1), facts: z.unknown() });

// --- Registries --------------------------------------------------------------------------

export const EVENT_PAYLOADS: Record<string, z.ZodType> = {
  'character.created@1': CharacterCreatedV1,
  'character.renamed@1': CharacterRenamedV1,
  'character.appearance_set@1': CharacterAppearanceSetV1,
  'character.gender_set@1': CharacterGenderSetV1,
  'character.archived@1': CharacterArchivedV1,
  'character.restored@1': CharacterRestoredV1,
  'character.owner_transferred@1': CharacterOwnerTransferredV1,
  'character.campaign_joined@1': CharacterCampaignJoinedV1,
  'character.campaign_left@1': CharacterCampaignLeftV1,
  'pack.pinned@1': PackPinnedV1,
  'decision.made@1': DecisionMadeV1,
  'decision.cleared@1': DecisionClearedV1,
  'level.gained@1': LevelGainedV1,
  'level.granted@1': LevelGrantedV1,
  'xp.awarded@1': XpAwardedV1,
  'hp.changed@1': HpChangedV1,
  'hit_dice.spent@1': HitDiceSpentV1,
  'hit_dice.regained@1': HitDiceRegainedV1,
  'death_save.recorded@1': DeathSaveRecordedV1,
  'stabilized@1': StabilizedV1,
  'slot.spent@1': SlotSpentV1,
  'slot.restored@1': SlotRestoredV1,
  'resource.spent@1': ResourceSpentV1,
  'resource.restored@1': ResourceRestoredV1,
  'spell.prepared@1': SpellPreparedV1,
  'spell.unprepared@1': SpellUnpreparedV1,
  'spell.learned@1': SpellLearnedV1,
  'spell.forgotten@1': SpellForgottenV1,
  'spell.cast@1': SpellCastV1,
  'concentration.started@1': ConcentrationStartedV1,
  'concentration.ended@1': ConcentrationEndedV1,
  'condition.added@1': ConditionAddedV1,
  'condition.removed@1': ConditionRemovedV1,
  'item.added@1': ItemAddedV1,
  'item.removed@1': ItemRemovedV1,
  'item.equipped@1': ItemEquippedV1,
  'item.unequipped@1': ItemUnequippedV1,
  'item.attuned@1': ItemAttunedV1,
  'item.unattuned@1': ItemUnattunedV1,
  'item.updated@1': ItemUpdatedV1,
  'currency.changed@1': CurrencyChangedV1,
  'rest.taken@1': RestTakenV1,
  'inspiration.changed@1': InspirationChangedV1,
  'note.added@1': NoteAddedV1,
  'note.updated@1': NoteUpdatedV1,
  'note.removed@1': NoteRemovedV1,
  'portrait.set@1': PortraitSetV1,
  'portrait.cleared@1': PortraitClearedV1,
  'override.applied@1': OverrideAppliedV1,
  'event.reverted@1': EventRevertedV1,
  'history.compacted@1': HistoryCompactedV1,
};

// Plan-9 Task 2 audit (settles the plan-7 owner-flag comment this replaces): every entry below
// that grants 'dm' was checked against doc-08 §Authorization matrix
// (docs/02-architecture/08-security-permissions-quotas.md, the character-stream rows) read
// verbatim, cross-referenced against doc-02 §"Event catalog — character stream"
// (docs/02-architecture/02-domain-model-and-events.md, the per-type Actor column — the finer-
// grained catalog doc-08's rows summarize) and ADR-012 §Authorization model
// (docs/01-decisions/ADR-012-identity-and-security.md, the original table). Full per-entry
// citations live in packages/protocol/test/character-actor-audit.test.ts (test names quote the
// source line each entry rests on). Outcomes:
//   - CORRECTED: `character.renamed` had NO textual support for a direct DM append. doc-08's
//     "Append owner events (..., pack.pinned)" row gives DM access only "if
//     houseRules.allowOverrides (as override.applied)"; doc-02 confirms this exact reading with
//     an explicit qualifier this catalog doesn't use for any other type: "O, D(override)". A DM
//     renames a character via `override.applied`, never by appending `character.renamed`
//     directly — corrected from ['owner','dm'] to ['owner'] (pack.pinned above already got this
//     same correction pre-plan-9).
//   - SUPPORTED, no doc-08 row (doc-02 is the textual support): `character.campaign_joined` /
//     `character.campaign_left` aren't named in any doc-08 row, but doc-02's dedicated line
//     ("O, D | {campaignId} | mirrored on campaign stream") explicitly authorizes both — the
//     same "lifecycle event with its own catalog line, no matrix row" pattern
//     `character.owner_transferred` (which DOES have a doc-08 row) fits too.
//   - OWNER-FLAGged (kept as-is, genuinely ambiguous): `death_save.recorded`, `stabilized`,
//     `resource.spent`/`resource.restored`, `concentration.started`/`concentration.ended`.
//     doc-08's row 2 ("Append owner events... in-play...") reads as though these "in-play"
//     mechanics are owner-only-direct/DM-via-override-only, like `character.renamed` above — but
//     UNLIKE `character.renamed`, doc-02's per-type lines for these five give a plain "O, D" with
//     NO "(override)" qualifier, the same unqualified form used for the doc-08-row-3-backed
//     dm.*-class grants (hp.changed, condition.*, etc.). That is a genuine textual conflict
//     between the two docs, not a gap in either — kept dm-granted per doc-02's more specific
//     table + the defensible product reading that a DM narrating in-play mechanics for an
//     unavailable player needs the same direct access here as for the dm.*-class events. Flagged
//     for an owner/product decision, not silently resolved either way.
//   - OWNER-FLAGged (kept as-is): `level.granted` is the ONLY member of doc-08 row 3's own named
//     dm.*-class list ("hp.changed, condition.*, xp.awarded, item.added/removed, level.granted,
//     currency.changed, inspiration.changed") whose doc-02 catalog line withholds Owner entirely
//     ("D" only, no "(solo)" annotation — every sibling row in that class carries an O, and
//     `xp.awarded` even gets the same "(solo)" qualifier doc-08's row-3 text literally promises
//     to `level.granted` too). Kept dm-only (doc-02's more specific table + the product reading
//     that milestone-mode leveling is inherently a DM pacing call: a solo/self player has no
//     reason to grant themselves permission-to-level rather than just calling `level.gained`
//     directly) rather than adding 'owner' on doc-08's literal but less specific row text.
export const EVENT_ACTORS: Record<string, ActorRole[]> = {
  'character.created': ['owner'],
  // Corrected 2026-09-20 (plan-9 Task 2, see audit note above): doc-08 "Append owner events"
  // row + doc-02 "O, D(override)" — DM renames only via `override.applied`, never directly.
  'character.renamed': ['owner'],
  'character.appearance_set': ['owner'],
  'character.gender_set': ['owner'],
  'character.archived': ['owner'],
  'character.restored': ['owner'],
  // doc-08: "character.owner_transferred | ✔ | ✔ (pregens) | ✖ | ✖"; ADR-012's DM cell names it
  // explicitly ("character.owner_transferred (claim flows)").
  'character.owner_transferred': ['dm', 'owner'],
  // doc-08 has no dedicated row; doc-02: "character.campaign_joined / character.campaign_left |
  // O, D | {campaignId} | mirrored on campaign stream" is the textual support (see audit note).
  'character.campaign_joined': ['owner', 'dm'],
  'character.campaign_left': ['owner', 'dm'],
  // Owner-only (doc-08 §Authorization matrix: "Append owner events (... pack.pinned)"); a DM
  // effects a pin on an owner's character via `override.applied` (gated by
  // `houseRules.allowOverrides`), not by appending `pack.pinned` directly.
  'pack.pinned': ['owner'],
  'decision.made': ['owner'],
  'decision.cleared': ['owner'],
  'level.gained': ['owner'],
  // OWNER-FLAGged: doc-02 withholds Owner for this one dm.*-class type; see audit note. Kept
  // dm-only.
  'level.granted': ['dm'],
  // doc-08 row 3: "xp.awarded" named, "Owner ✔ (solo/self)"; doc-02: "D, O(solo)".
  'xp.awarded': ['dm', 'owner'],
  // doc-08 row 3: "hp.changed" named, "Owner ✔ (solo/self)".
  'hp.changed': ['owner', 'dm'],
  'hit_dice.spent': ['owner'],
  'hit_dice.regained': ['owner'],
  // OWNER-FLAGged (conflicts with doc-08 row 2's "in-play" bucket); see audit note. Kept
  // dm-granted per doc-02's unqualified "O, D".
  'death_save.recorded': ['owner', 'dm'],
  // OWNER-FLAGged; see audit note (same reasoning as death_save.recorded above).
  stabilized: ['owner', 'dm'],
  'slot.spent': ['owner'],
  'slot.restored': ['owner'],
  // OWNER-FLAGged; see audit note (same reasoning as death_save.recorded above).
  'resource.spent': ['owner', 'dm'],
  'resource.restored': ['owner', 'dm'],
  'spell.prepared': ['owner'],
  'spell.unprepared': ['owner'],
  'spell.learned': ['owner'],
  'spell.forgotten': ['owner'],
  'spell.cast': ['owner'],
  // OWNER-FLAGged; see audit note (same reasoning as death_save.recorded above).
  'concentration.started': ['owner', 'dm'],
  'concentration.ended': ['owner', 'dm'],
  // doc-08 row 3: "condition.*" named, "Owner ✔ (solo/self)".
  'condition.added': ['owner', 'dm'],
  'condition.removed': ['owner', 'dm'],
  // doc-08 row 3: "item.added/removed" named, "Owner ✔ (solo/self)".
  'item.added': ['owner', 'dm'],
  'item.removed': ['owner', 'dm'],
  'item.equipped': ['owner'],
  'item.unequipped': ['owner'],
  'item.attuned': ['owner'],
  'item.unattuned': ['owner'],
  'item.updated': ['owner'],
  // doc-08 row 3: "currency.changed" named, "Owner ✔ (solo/self)".
  'currency.changed': ['owner', 'dm'],
  'rest.taken': ['owner'],
  // doc-08 row 3: "inspiration.changed" named, "Owner ✔ (solo/self)".
  'inspiration.changed': ['owner', 'dm'],
  'note.added': ['owner'],
  'note.updated': ['owner'],
  'note.removed': ['owner'],
  'portrait.set': ['owner'],
  'portrait.cleared': ['owner'],
  // doc-08: "override.applied | ✔ (solo) | ✔ | ✖ | ✖".
  'override.applied': ['dm', 'owner'],
  // doc-08: "event.reverted | own events | any | ✖ | ✖" — the role LIST is owner+dm; the
  // own-vs-any SCOPE restriction is enforced by permissions.ts's `canRevertOwn`, not expressible
  // in this static role table.
  'event.reverted': ['owner', 'dm'],
  'history.compacted': ['owner'],
};

export type CharacterCreated = z.infer<typeof CharacterCreatedV1>;
export type CharacterRenamed = z.infer<typeof CharacterRenamedV1>;
export type CharacterAppearanceSet = z.infer<typeof CharacterAppearanceSetV1>;
export type CharacterGenderSet = z.infer<typeof CharacterGenderSetV1>;
export type CharacterArchived = z.infer<typeof CharacterArchivedV1>;
export type CharacterRestored = z.infer<typeof CharacterRestoredV1>;
export type CharacterOwnerTransferred = z.infer<typeof CharacterOwnerTransferredV1>;
export type CharacterCampaignJoined = z.infer<typeof CharacterCampaignJoinedV1>;
export type CharacterCampaignLeft = z.infer<typeof CharacterCampaignLeftV1>;
export type PackPinned = z.infer<typeof PackPinnedV1>;
export type DecisionMade = z.infer<typeof DecisionMadeV1>;
export type DecisionCleared = z.infer<typeof DecisionClearedV1>;
export type LevelGained = z.infer<typeof LevelGainedV1>;
export type LevelGranted = z.infer<typeof LevelGrantedV1>;
export type XpAwarded = z.infer<typeof XpAwardedV1>;
export type HpChanged = z.infer<typeof HpChangedV1>;
export type HitDiceSpent = z.infer<typeof HitDiceSpentV1>;
export type HitDiceRegained = z.infer<typeof HitDiceRegainedV1>;
export type DeathSaveRecorded = z.infer<typeof DeathSaveRecordedV1>;
export type Stabilized = z.infer<typeof StabilizedV1>;
export type SlotSpent = z.infer<typeof SlotSpentV1>;
export type SlotRestored = z.infer<typeof SlotRestoredV1>;
export type ResourceSpent = z.infer<typeof ResourceSpentV1>;
export type ResourceRestored = z.infer<typeof ResourceRestoredV1>;
export type SpellPrepared = z.infer<typeof SpellPreparedV1>;
export type SpellUnprepared = z.infer<typeof SpellUnpreparedV1>;
export type SpellLearned = z.infer<typeof SpellLearnedV1>;
export type SpellForgotten = z.infer<typeof SpellForgottenV1>;
export type SpellCast = z.infer<typeof SpellCastV1>;
export type ConcentrationStarted = z.infer<typeof ConcentrationStartedV1>;
export type ConcentrationEnded = z.infer<typeof ConcentrationEndedV1>;
export type ConditionAdded = z.infer<typeof ConditionAddedV1>;
export type ConditionRemoved = z.infer<typeof ConditionRemovedV1>;
export type ItemAdded = z.infer<typeof ItemAddedV1>;
export type ItemRemoved = z.infer<typeof ItemRemovedV1>;
export type ItemEquipped = z.infer<typeof ItemEquippedV1>;
export type ItemUnequipped = z.infer<typeof ItemUnequippedV1>;
export type ItemAttuned = z.infer<typeof ItemAttunedV1>;
export type ItemUnattuned = z.infer<typeof ItemUnattunedV1>;
export type ItemUpdated = z.infer<typeof ItemUpdatedV1>;
export type CurrencyChanged = z.infer<typeof CurrencyChangedV1>;
export type RestTaken = z.infer<typeof RestTakenV1>;
export type InspirationChanged = z.infer<typeof InspirationChangedV1>;
export type NoteAdded = z.infer<typeof NoteAddedV1>;
export type NoteUpdated = z.infer<typeof NoteUpdatedV1>;
export type NoteRemoved = z.infer<typeof NoteRemovedV1>;
export type PortraitSet = z.infer<typeof PortraitSetV1>;
export type PortraitCleared = z.infer<typeof PortraitClearedV1>;
export type OverrideApplied = z.infer<typeof OverrideAppliedV1>;
export type EventReverted = z.infer<typeof EventRevertedV1>;
export type HistoryCompacted = z.infer<typeof HistoryCompactedV1>;
