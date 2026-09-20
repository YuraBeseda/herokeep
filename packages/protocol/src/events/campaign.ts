import { z } from 'zod';
import { EntityIdSchema, PackIdSchema, SlugSchema } from '../ids.ts';
import { SemverSchema } from '../pack/common.ts';
import { ShortTextSchema } from '../pack/enums.ts';
import { FormulaSchema } from '../pack/formula.ts';
import { type ActorRole, UUID } from './envelope.ts';

// --- Shared value schemas ----------------------------------------------------------------

/** A campaign member's display name. Reuses `sync/messages.ts`'s `MemberSchema.displayName`
 * precedent (same field, same package, 1..128 cap) rather than the generic `ShortTextSchema`
 * (1..200) — doc-02 doesn't restate a bound for this field, so the closest existing precedent
 * for the identical concept wins over inventing a third number. */
export const MemberDisplayNameSchema = z.string().min(1).max(128);

/** A user id referenced from ANOTHER actor's event payload (e.g. `member.joined`'s `userId`,
 * `campaign.character_joined`'s `ownerId`) — not the envelope's own `actor.userId` field, which
 * has its own schema. Same shape as `CharacterOwnerTransferredV1.toUserId` (character.ts): the
 * Identifiers table (doc-02) gives no format beyond "usr_ + 22-char base62", so this keeps the
 * existing loose bound rather than inventing a stricter regex the doc doesn't ask for. */
export const UserIdRefSchema = z.string().min(1).max(64);

/** D1 `memberships.role` (doc-02 Entities table: `memberships(..., role: 'dm'|'player', ...)`;
 * plan-9 design ruling 1: "D1 memberships.role is 'dm'|'player'"). Distinct from the stream
 * envelope's `ActorRoleSchema` ('owner'|'dm'|'system'|'member') — this is the campaign's OWN
 * membership role, carried inside `member.*` event payloads, not the actor that authored them. */
export const MembershipRoleSchema = z.enum(['dm', 'player']);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

/**
 * Join code (doc-02 Identifiers table: "8 chars, Crockford base32, no vowels (avoids words)",
 * example `7QX4-M2HN`). Crockford's 32-symbol alphabet already excludes I/L/O/U (ambiguous with
 * 1/0); "no vowels" removes A/E too, leaving digits 0-9 plus the 20 consonants
 * B C D F G H J K M N P Q R S T V W X Y Z (30 symbols total). The example is dash-grouped for
 * readability, so the schema accepts the dash but doesn't require it — Task 4 (routes) owns the
 * canonical generated/stored form; this only needs to accept whatever that task emits and reject
 * anything else (vowels, lowercase, wrong length).
 */
export const JoinCodeSchema = z.string().regex(/^[0-9BCDFGHJKMNPQRSTVWXYZ]{4}-?[0-9BCDFGHJKMNPQRSTVWXYZ]{4}$/);

/** `pack.enabled`/`pack.disabled`'s `sha256` field (doc-02: "{packId, version, sha256}"). Named
 * `sha256` — not `hash` — unlike `BlobHashSchema`'s `sha256:<hex>` blob-id format
 * (pack/common.ts): the field name already states the algorithm, so re-prefixing it would be
 * redundant (`sha256: "sha256:...".`). This is the bare 64-char hex digest of the pack JSON. */
export const PackSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/** Shared by `roll.logged` and `chat.message`. Doc-02 lists `chat.message`'s payload as
 * `{text ≤ 2 KB, visibility}` without restating an enum — the only `visibility` concept the
 * catalog defines anywhere is `roll.logged`'s `everyone | dm | private`, so chat reuses it
 * verbatim rather than inventing a second, undocumented one. */
export const CampaignVisibilitySchema = z.enum(['everyone', 'dm', 'private']);
export type CampaignVisibility = z.infer<typeof CampaignVisibilitySchema>;

/** A rolled die face, restricted to the polyhedral set `DiceSchema` (pack/common.ts) already
 * recognizes (d4/d6/d8/d10/d12/d20/d100) — `roll.logged.results[].die` names a single die, not a
 * dice expression, so it's simpler than `DiceSchema`'s full `NdS(+/-M)` grammar but draws from
 * the same face set for consistency. */
const RollDieSchema = z.string().regex(/^d(4|6|8|10|12|20|100)$/);

// --- Campaign settings document -----------------------------------------------------------

/**
 * The campaign settings document (doc-02 § "Campaign settings document", the FULL shape).
 * `campaign.settings_changed`'s payload always carries the whole document — doc-02's catalog row
 * says so explicitly ("(full document, see below)") — so there is no separate "changed fields
 * only" patch variant to design here.
 */
export const CampaignSettingsSchema = z.strictObject({
  system: SlugSchema,
  // Generous sanity ceiling on array length, not a business rule: the real quota (doc-08: "6
  // non-core packs × 5 MB") is enforced server-side against `pack.enabled` events (Task 5), not
  // by this payload shape.
  packs: z.array(z.strictObject({ id: PackIdSchema, version: SemverSchema })).max(64),
  houseRules: z.strictObject({
    strictValidation: z.boolean(),
    allowOverrides: z.boolean(),
    editOutsideSession: z.enum(['free', 'dmApproval', 'locked']),
    xpMode: z.enum(['xp', 'milestone']),
    hpOnLevelUp: z.enum(['roll', 'average', 'choice']),
    encumbrance: z.enum(['off', 'standard', 'variant']),
    // Doc-02's example value is 3 (5e's default attunement cap); no official variant rule raises
    // it into double digits, but a homebrew table might, so the bound stays generous rather than
    // hard-coding the default as a ceiling.
    attunementMax: z.int().min(0).max(20),
    // Same 1..20 bound as `LevelGainedV1.level` (character.ts) — 5e's character level range.
    startingLevel: z.int().min(1).max(20),
  }),
  visibility: z.strictObject({
    partySheets: z.enum(['none', 'overview', 'full']),
    rolls: z.enum(['everyone', 'dm']),
    allowPrivateRolls: z.boolean(),
  }),
  join: z.strictObject({ open: z.boolean(), requireApproval: z.boolean() }),
});
export type CampaignSettings = z.infer<typeof CampaignSettingsSchema>;

// --- Campaign lifecycle --------------------------------------------------------------------

export const CampaignCreatedV1 = z.strictObject({
  name: ShortTextSchema,
  system: SlugSchema,
  corePack: z.strictObject({ id: PackIdSchema, version: SemverSchema }),
});
export const CampaignRenamedV1 = z.strictObject({ name: ShortTextSchema });
export const CampaignSettingsChangedV1 = z.strictObject({ settings: CampaignSettingsSchema });
export const CampaignJoinCodeRotatedV1 = z.strictObject({ joinCode: JoinCodeSchema });
export const CampaignArchivedV1 = z.strictObject({});

// --- Packs -----------------------------------------------------------------------------------

export const PackEnabledV1 = z.strictObject({ packId: PackIdSchema, version: SemverSchema, sha256: PackSha256Schema });
export const PackDisabledV1 = z.strictObject({ packId: PackIdSchema, version: SemverSchema, sha256: PackSha256Schema });

// --- Membership --------------------------------------------------------------------------------

export const MemberJoinedV1 = z.strictObject({
  userId: UserIdRefSchema,
  displayName: MemberDisplayNameSchema,
  role: MembershipRoleSchema,
});
export const MemberLeftV1 = z.strictObject({
  userId: UserIdRefSchema,
  displayName: MemberDisplayNameSchema,
  role: MembershipRoleSchema,
});
export const MemberRemovedV1 = z.strictObject({
  userId: UserIdRefSchema,
  displayName: MemberDisplayNameSchema,
  role: MembershipRoleSchema,
});
export const MemberRenamedV1 = z.strictObject({ displayName: MemberDisplayNameSchema });

// --- Character <-> campaign linkage (mirrors character.ts's campaign_joined/left) ---------------

export const CampaignCharacterJoinedV1 = z.strictObject({
  characterId: z.string().regex(UUID),
  ownerId: UserIdRefSchema,
  name: ShortTextSchema,
});
export const CampaignCharacterLeftV1 = z.strictObject({
  characterId: z.string().regex(UUID),
  ownerId: UserIdRefSchema,
  name: ShortTextSchema,
});

// --- Party overview ------------------------------------------------------------------------------

/** doc-02 names `party.overview_updated`'s fields but doesn't elaborate `classes`' element shape
 * beyond the field name. This mirrors the character facts model's `classes: [{classId, level,
 * subclassId?}]` (doc-02 § "Character facts") minus `subclassId` — the party view only needs
 * enough to render "Fighter 3", not a full multiclass breakdown. */
const PartyClassEntrySchema = z.strictObject({ classId: EntityIdSchema, level: z.int().min(1).max(20) });

export const PartyOverviewUpdatedV1 = z.strictObject({
  characterId: z.string().regex(UUID),
  overview: z.strictObject({
    hp: z.int().min(0),
    hpMax: z.int().min(0),
    temp: z.int().min(0),
    ac: z.int().min(0),
    level: z.int().min(1).max(20),
    classes: z.array(PartyClassEntrySchema).max(20),
    // Condition ids, same entity-id shape as `condition.added.conditionId` (character.ts).
    conditions: z.array(EntityIdSchema).max(20),
    // Design ruling 5 ("content is opaque" to the server) means the CampaignActor never
    // interprets this — it just relays it — so this stays a simple "are they concentrating"
    // flag rather than the full `{spellId, since}` object the character facts model carries;
    // the party view only needs the boolean to render an icon.
    concentration: z.boolean(),
    portraitThumb: z.string().min(1).max(4096).optional(),
    passivePerception: z.int().min(0).max(40),
  }),
});

// --- Sessions --------------------------------------------------------------------------------------

export const SessionStartedV1 = z.strictObject({ title: ShortTextSchema.optional() });
export const SessionEndedV1 = z.strictObject({ title: ShortTextSchema.optional() });

// --- Rolls & chat --------------------------------------------------------------------------------------

export const RollLoggedV1 = z.strictObject({
  characterId: z.string().regex(UUID).optional(),
  label: ShortTextSchema,
  formula: FormulaSchema,
  results: z
    .array(z.strictObject({ die: RollDieSchema, value: z.int().min(1).max(100) }))
    .min(1)
    .max(100),
  total: z.int(),
  kind: z.enum(['check', 'attack', 'damage', 'save', 'spell', 'custom']),
  visibility: CampaignVisibilitySchema,
  manual: z.boolean().optional(),
});

export const ChatMessageV1 = z.strictObject({
  // `.max(2048)` here is a cheap UTF-16-code-unit pre-check (always looser than the byte cap for
  // any non-ASCII text); the `.refine` below is the AUTHORITATIVE "≤ 2 KB" check doc-02 asks for,
  // measured the way the wire actually counts it (UTF-8 bytes).
  text: z
    .string()
    .min(1)
    .max(2048)
    .refine((s) => new TextEncoder().encode(s).length <= 2048, {
      message: 'text must be at most 2048 bytes (UTF-8)',
    }),
  visibility: CampaignVisibilitySchema,
});

// --- DM notes (mirrors character.ts's note.added/updated/removed shape) --------------------------------

export const DmNoteAddedV1 = z.strictObject({
  id: z.string().regex(UUID),
  title: ShortTextSchema.optional(),
  body: z.string().max(8192).optional(),
});
export const DmNoteUpdatedV1 = z.strictObject({
  id: z.string().regex(UUID),
  title: ShortTextSchema.optional(),
  body: z.string().max(8192).optional(),
});
export const DmNoteRemovedV1 = z.strictObject({
  id: z.string().regex(UUID),
  title: ShortTextSchema.optional(),
  body: z.string().max(8192).optional(),
});

// --- Registries ------------------------------------------------------------------------------------

export const CAMPAIGN_EVENT_PAYLOADS: Record<string, z.ZodType> = {
  'campaign.created@1': CampaignCreatedV1,
  'campaign.renamed@1': CampaignRenamedV1,
  'campaign.settings_changed@1': CampaignSettingsChangedV1,
  'campaign.join_code_rotated@1': CampaignJoinCodeRotatedV1,
  'campaign.archived@1': CampaignArchivedV1,
  'pack.enabled@1': PackEnabledV1,
  'pack.disabled@1': PackDisabledV1,
  'member.joined@1': MemberJoinedV1,
  'member.left@1': MemberLeftV1,
  'member.removed@1': MemberRemovedV1,
  'member.renamed@1': MemberRenamedV1,
  'campaign.character_joined@1': CampaignCharacterJoinedV1,
  'campaign.character_left@1': CampaignCharacterLeftV1,
  'party.overview_updated@1': PartyOverviewUpdatedV1,
  'session.started@1': SessionStartedV1,
  'session.ended@1': SessionEndedV1,
  'roll.logged@1': RollLoggedV1,
  'chat.message@1': ChatMessageV1,
  'dm.note_added@1': DmNoteAddedV1,
  'dm.note_updated@1': DmNoteUpdatedV1,
  'dm.note_removed@1': DmNoteRemovedV1,
};

/**
 * doc-08 §Authorization matrix, campaign rows (quoted verbatim):
 *   "Append campaign settings/packs/session/member removal | — | ✔ | ✖ | ✖" (DM only)
 *   "roll.logged, chat.message, member.renamed, own campaign.character_joined/left | — | ✔ | ✔ |
 *    ✖" (DM AND Member)
 *
 * `member.joined`/`member.left` are named in NEITHER row above — doc-02's catalog groups them
 * with `member.removed` under one actor column, "M / D" (§ "Event catalog — campaign stream").
 * Read together with doc-08's explicit "member removal" clause (DM-only, in the first row
 * quoted), that slash resolves as: joined/left = the member's own self-service action (M),
 * removed = DM-only (D) — the ordinary reading of "a member joins/leaves themselves; only a DM
 * removes someone else."
 *
 * `dm.note_*` isn't in either quoted row either. It follows doc-02's own `D` actor column for
 * that family, which also matches the read-filtering rule stated two paragraphs later in doc-08:
 * "[reads] never [send] dm.note_* events to non-DM sockets" — a type no non-DM socket ever
 * receives is not one a member would plausibly be granted write access to either.
 *
 * `party.overview_updated` isn't in either quoted row. It follows plan-9's design ruling 5
 * ("party.overview_updated is an ordinary member event (owner's device posts it) ... the server
 * only enforces actor legitimacy"). "Owner's device" can be a DM's device for an unclaimed pregen
 * (doc-02 § "Ownership and lifecycle summary": "Pregens: created by the DM inside the campaign
 * (owner = DM)"), so both roles are listed here; whether THIS actor legitimately owns THIS
 * characterId is a per-append check (Task 5, CampaignActor), not something this static
 * type→role table can express — the table only lists roles, per the task brief.
 */
export const CAMPAIGN_EVENT_ACTORS: Record<string, ActorRole[]> = {
  'campaign.created': ['dm'],
  'campaign.renamed': ['dm'],
  'campaign.settings_changed': ['dm'],
  'campaign.join_code_rotated': ['dm'],
  'campaign.archived': ['dm'],
  'pack.enabled': ['dm'],
  'pack.disabled': ['dm'],
  'member.joined': ['member'],
  'member.left': ['member'],
  'member.removed': ['dm'],
  'member.renamed': ['dm', 'member'],
  'campaign.character_joined': ['dm', 'member'],
  'campaign.character_left': ['dm', 'member'],
  'party.overview_updated': ['dm', 'member'],
  'session.started': ['dm'],
  'session.ended': ['dm'],
  'roll.logged': ['dm', 'member'],
  'chat.message': ['dm', 'member'],
  'dm.note_added': ['dm'],
  'dm.note_updated': ['dm'],
  'dm.note_removed': ['dm'],
};

export type CampaignCreated = z.infer<typeof CampaignCreatedV1>;
export type CampaignRenamed = z.infer<typeof CampaignRenamedV1>;
export type CampaignSettingsChanged = z.infer<typeof CampaignSettingsChangedV1>;
export type CampaignJoinCodeRotated = z.infer<typeof CampaignJoinCodeRotatedV1>;
export type CampaignArchived = z.infer<typeof CampaignArchivedV1>;
export type PackEnabled = z.infer<typeof PackEnabledV1>;
export type PackDisabled = z.infer<typeof PackDisabledV1>;
export type MemberJoined = z.infer<typeof MemberJoinedV1>;
export type MemberLeft = z.infer<typeof MemberLeftV1>;
export type MemberRemoved = z.infer<typeof MemberRemovedV1>;
export type MemberRenamed = z.infer<typeof MemberRenamedV1>;
export type CampaignCharacterJoined = z.infer<typeof CampaignCharacterJoinedV1>;
export type CampaignCharacterLeft = z.infer<typeof CampaignCharacterLeftV1>;
export type PartyOverviewUpdated = z.infer<typeof PartyOverviewUpdatedV1>;
export type SessionStarted = z.infer<typeof SessionStartedV1>;
export type SessionEnded = z.infer<typeof SessionEndedV1>;
export type RollLogged = z.infer<typeof RollLoggedV1>;
export type ChatMessage = z.infer<typeof ChatMessageV1>;
export type DmNoteAdded = z.infer<typeof DmNoteAddedV1>;
export type DmNoteUpdated = z.infer<typeof DmNoteUpdatedV1>;
export type DmNoteRemoved = z.infer<typeof DmNoteRemovedV1>;
