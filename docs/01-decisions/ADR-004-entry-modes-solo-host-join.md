# ADR-004 — Entry modes: Solo, Host, Join

**Status:** Approved 2026-08-30. Depends on ADR-001.

## Context

The original brief said "a DM lobby is the only entry point", then described two usages:
(1) the DM creates a lobby and generates characters that players pick, and (2) the DM
creates and configures a lobby, players join and build their own characters. During
planning the owner agreed that building a character with no lobby at all ("drafts") is a
good use case, with the question of where such a character's data lives.

## Options considered

1. **Lobby-only.** Every character exists inside a campaign. Simple permission model, but
   a player cannot prepare at home, cannot try the builder without a DM, and the app has
   no value for a DM preparing NPC-style pregens without a session.
2. **Solo-only + share.** No campaigns; characters are shared by link. Loses the DM
   feature set entirely.
3. **Three first-class entry points (chosen).** Solo, Host, Join, with characters that can
   move between solo and campaign contexts.

## Decision

The home screen has exactly three actions plus the library:

- **My characters (Solo).** Create/edit characters with no network and no account. The
  character, its images and any personal packs live on the device. After login (Phase 2)
  the character's event stream also syncs to the account; images stay on devices.
- **Host a campaign.** Create a campaign: choose system (5e-2024; 5e-2014 later), enable
  content packs, set house rules and visibility (campaign settings are data — see
  `02-architecture/02`). Get a join code, link and QR. Create pregens if desired.
- **Join a campaign.** Enter a code / open a link / scan a QR. Then either bring a solo
  character, create a new one inside the campaign, or claim a DM-made pregen.

### Character ownership and movement

- A character has one **owner** (a user; in Phase 1 without accounts, the device). A DM who
  creates a pregen owns it until a player *claims* it (`character.owner_transferred`).
- A character is in at most one campaign at a time (`character.campaign_joined` /
  `character.campaign_left` events on the character stream; mirrored by
  `campaign.character_joined/left` on the campaign stream).
- Joining validates the character against the campaign: same system; every referenced
  pack must be enabled in the campaign at a compatible version; otherwise the join screen
  lists the problems ("uses pack *Ivan's Homebrew* 1.2 — not enabled here") and the DM
  can enable the pack (the character's copy is offered to the DM) or the player can
  rebase the character (ADR-008).
- Leaving a campaign keeps the full history; the character returns to solo context.

### Editing between sessions

Because the server is always on (ADR-001), a player can edit at home. It is a campaign
setting: `houseRules.editOutsideSession = free | dmApproval | locked` (default `free`).
With `dmApproval`, edits are still recorded but flagged `pendingReview` and the DM's
party view shows a "review changes" badge; the DM accepts (no-op) or reverts.

### DM edits to a player's sheet

The DM can apply **mechanics** with one tap (damage, heal, condition, XP, give/remove
item, grant level) and can **override** anything else — but only after switching the sheet
into an explicit *Override* mode, confirming each change with a reason. Overrides are
events (`override.applied`) shown in the character timeline in a distinct color.

### Solo characters and packs

A player may install packs in solo mode (import JSON). Those packs are stored on the
device (and are bundled in the character's export). When the character joins a campaign,
the campaign's pack set is authoritative (above).

## Consequences

- Phase 1 ships Solo only and is already useful at a table (each player on their own
  phone, no shared state). Host/Join arrive in Phase 3.
- Permission checks in the DO are simple because ownership and membership are explicit
  events, not inferred.
- The join screen doubles as the "compatibility report" for content packs.

## Open points

- Whether a character may be in several campaigns at once (e.g. West Marches style) is
  not supported; the data model does not forbid extending it later.
