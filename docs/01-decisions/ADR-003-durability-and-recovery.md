# ADR-003 — Durability and recovery: what survives when a device dies

**Status:** Approved 2026-08-30. Depends on ADR-001, ADR-012.

## Context

"My character vanished" is the failure mode that makes people stop using a tool. The
causes, in order of likelihood at a real table:

1. Browser storage evicted — Safari deletes script-writable storage for sites not used
   in 7 days **when used in a browser tab**; Home-Screen-installed web apps are exempt
   (`04-reference/platform-research.md`). Users also clear site data, use private mode,
   or run out of disk.
2. Different device or browser — the character was created on a laptop, the player
   arrives with a phone.
3. The player never had a copy — the DM created the character (pregen) and the player only
   viewed it.
4. The DM's device is lost — with option A topology this would lose the campaign.
5. User error — deleted the character, or an edit went wrong and they want "how it was".

## Options considered

- **Device-only + file export** (no server): relies on users exporting; they won't.
- **Server backup as a separate mechanism**: a second protocol (rejected in ADR-001).
- **Canonical streams on the server + full local replicas + export** (chosen): the same
  sync protocol makes every device a replica, and the server is a copy that is always on.

## Decision

### Three copies by construction

| Copy | Where | When it exists |
|------|-------|----------------|
| Owner's device | IndexedDB via Dexie | Always (created there or pulled on login) |
| Server | `CharacterStream` Durable Object (SQLite) | From the first sync after login (Phase 2). Solo-without-account characters have no server copy — the UI says so plainly. |
| DM's device | DM's IndexedDB as a campaign member | While the character is in a campaign |

Any one copy restores the others through the normal sync protocol; nothing special is
needed for "restore".

### Browser persistence

- Storage: **IndexedDB (Dexie 4)** for events, snapshots, packs, settings, and image
  blobs (as `Blob` values). OPFS is not used in v1: it offers no durability advantage
  (same quota and eviction), Safari only got writable streams in 26.0, and Dexie already
  handles blobs.
- Call `navigator.storage.persist()` after the first meaningful action (character
  created); show the result in Settings → Storage together with `estimate()` usage.
- **Push PWA installation**: on iOS, installation is the *only* protection against the
  7-day wipe. The app shows a non-dismissable-once-per-week banner on iOS Safari tabs
  explaining exactly that, with platform-specific install steps. On Android/desktop
  Chromium, installation also raises the chance that `persist()` is granted.
- Multi-tab safety: one tab holds the sync socket per stream (Web Locks); others follow
  via BroadcastChannel. Prevents duplicate pending events.

### Export / import

- **Bundle format**: `.hero` = a ZIP (fflate) containing `manifest.json` (format version,
  app version, created-at, contents list), `character.json` (full event log + latest
  snapshot + pinned pack versions), `packs/*.json` (any non-core pack the character
  depends on, exact pinned versions), `images/<sha256>.<ext>` (referenced blobs only).
  Campaign bundles (`.campaign`) contain the campaign stream, its enabled packs, and one
  `characters/<id>/` folder per member character (DM export).
- **Save**: `showSaveFilePicker` where available; otherwise Web Share with files (the only
  reliable path on iOS); otherwise `a[download]`.
- **Import** validates the manifest and every JSON against the shared schemas, de-duplicates
  images by hash, and imports as a *new* character id unless the same id exists and the
  user chooses "merge" (union of events by id — safe because events are immutable and
  uniquely identified).
- Reminders: after every level-up and every session end, a small "Back up to file" prompt
  appears if the character has no server copy or the last export is older than 30 days.

### Session resume

- A campaign has a stable id and a stable join code. Members' devices remember the
  campaign and reconnect automatically when the app opens; there is nothing to "reopen".
- If the DM's device dies, players keep playing; the DM signs in on any device and lands on
  the party view with everything up to the last acknowledged event.
- A player whose device dies signs in on a new device, sees their characters, and pulls the
  streams. Images arrive from the DM's device or from other online peers (ADR-010) — or
  show placeholders until then.

### "My character vanished" — cause by cause

| Cause | What the design does |
|-------|----------------------|
| Safari 7-day eviction | Install nag; server copy; DM copy. Worst case (never installed, no account): file export prompts. |
| Cleared site data / new browser | Sign in → pull. |
| Pregen viewed only | The character's owner is the DM until "claim"; claiming transfers ownership (an event) and the player's device pulls the full stream. |
| DM device lost | Server and players' devices hold everything; DM signs in elsewhere. |
| Accidental delete | Delete is soft: `character.archived` event + 30-day "Trash" list; hard delete requires typing the name and is what frees quota. |
| Bad edit | Timeline shows every event; any event (or transaction group) can be reverted (ADR-007). |
| Project server disappears | Every device has full replicas and can export; the pack format and bundle format are documented so data outlives the service. |

## Consequences

- Phase 1 (solo, no accounts) ships with honest UI: "This character exists only on this
  device — install the app and export regularly." Phase 2 removes the caveat.
- Storage usage is visible and capped per device (`02-architecture/07`), so a phone with
  little space is not silently filled with a campaign's images.

## Open points

- Whether Cloudflare D1/DO "Time Travel"-style point-in-time restore is available on the
  free plan for the DO SQLite backend was not confirmed. The design does not rely on it;
  the DM/device replicas are the backup of the server, not the other way round.
