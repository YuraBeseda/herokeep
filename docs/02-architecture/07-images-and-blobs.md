# Images and blobs

Decision record: ADR-010. This document is the how.

## Blob record (client, Dexie table `blobs`)

```
{ hash: "sha256:<hex>", mime, size, width, height, kind: icon|portrait|thumb|banner|token,
  (the item-icon kind is also `icon`, but 128² / 32 KB, see the caps below),
  bytes: Blob, addedAt, lastUsedAt, pinned: boolean, origin: upload|peer|import|pack }
```

## Upload pipeline (`apps/web/src/app/shared/services/images/`)

1. `pickImage(kind)` — `<input type="file" accept="image/*">` (no `image/heic` so iOS
   transcodes to JPEG); size guard 25 MB before decoding.
2. `decode(file)` — `createImageBitmap(file, { imageOrientation: 'from-image' })`;
   fallback `<img>` decode for browsers without options support.
3. `fit(bitmap, kind)` — cover/contain to the kind's box; icons padded to square with
   transparent background; portraits also produce a 256-px `thumb` and a 256-px circular
   `token` (masked in UI, stored square).
4. `encode(canvas, kind)` — `canvas.convertToBlob` / `toBlob`: try `image/webp` if
   `supportsWebpEncode()` (one-time 1×1 probe; result cached); else `image/jpeg` for
   opaque, `image/png` for alpha. Quality ladder 0.85 → 0.7 → 0.55 until within the kind's
   byte cap; if still over, reduce dimensions by 0.8 and retry (max 3 times); else reject
   with `image.too-large`.
5. `hash(bytes)` — `crypto.subtle.digest('SHA-256')`.
6. Store; return `{hash, thumbHash?, tokenHash?, mime, w, h}` for the emitting event.

Caps (ADR-010): pack/spell icon 256² / 64 KB; item icon (plan 18, kind `icon` for a custom or homebrew item) 128² / 32 KB; portrait 1024 long edge / 400 KB; banner 1600×600 /
400 KB; token & thumb 256² / 64 KB.

## Blob transfer protocol (over the sync socket)

- On connect and after each completed download: `blob.have {hashes}` for the hashes
  relevant to the context (own character's blobs + everything announced in the campaign
  that the device holds). The DO keeps `hash → Set<socketId>` in memory; after
  hibernation it is rebuilt from the next `hello`s (the DO asks with a `blob.resend-have`
  notice if the map is empty).
- Requester → `blob.request {rid, hash}`. DO chooses a holder: the uploader (recorded
  in the announcing event's actor) if online → the DM → any. DO → holder: `blob.pull
  {hash, to: socketId}`. Holder streams `blob.chunk` binary frames: 16-byte header
  `[magic 4B][index u16][total u16][to u32][hash prefix 4B]` followed by ≤ 64 KB; the DO
  forwards to `to` and discards. Requester verifies the SHA-256 of the assembled bytes
  before storing; mismatch → discard and retry from another holder.
- Flow control: one blob in flight per requester; holders serve at most two requesters
  concurrently; DO drops chunks for closed sockets.
- `blob.unavailable {hash}` when no holder is online; the client retries when a `members`
  update shows a new peer.

## Prefetch policy

| Priority | What | When |
|----------|------|------|
| 1 | own character's portrait thumb + token; icons of equipped items and prepared spells (item icons are the 128² kind, spell and pack icons 256²) | immediately on connect |
| 2 | party tokens; campaign banner | after 1 |
| 3 | full portrait; remaining own icons; every asset of the campaign's enabled packs (plan 16: pack icons travel here as a whole, including the "equipped/prepared" ones row 1 names — §Pack assets) | when idle (`requestIdleCallback` or 2 s after 2) |
| 4 (DM only) | every announced blob in the campaign | idle, continuous (super-peer) |

## Cache management

- `pinned` for blobs referenced by own characters and the current campaign; LRU over the
  rest with a cap (default 500 MB, Settings slider 100 MB–2 GB, shows
  `navigator.storage.estimate()`).
- Eviction never removes pinned blobs; if pinned exceeds the cap the UI explains.
- Orphans (not referenced by any local stream or pack) are cleaned weekly.

## Placeholders

`PlaceholderService.for(entity)` maps type/tags → a game-icons sprite id (from the core
pack's `icons.json`) and an accent color by school/category; portraits fall back to a
monogram token with a deterministic hue from the character id. Placeholders are
indistinguishable in layout from real images (same box), so nothing shifts when the real
image arrives.

## Pack assets

Content packs list assets by hash; a `.hkpack` ZIP carries them. On import, each asset is
verified (size, magic-byte mime, sha256) and stored locally as a blob row with
`origin: 'pack'`. The cache manager's LRU and orphan sweeps never evict such rows: the pack store
owns them, and removing the pack deletes the asset blobs that no other installed pack lists
(plan 15 task 2). A `.hero` export carries a pinned pack's assets as `assets/<hex>` (plan 15
task 6).

**Campaign packs (implemented in plan 16).** `pack.enabled@1` still carries only
`{packId, version, sha256}` (`packages/protocol/src/events/campaign.ts`); the manifest is not in
the event. Per ADR-008, the campaign's DO now **stores the pack JSON** of every enabled non-core
pack, so a member can fetch it without the DM online:

- The DM uploads the canonical JSON with `PUT /api/campaigns/:id/packs/:packId/:version` before
  appending `pack.enabled@1`. The actor refuses the event unless a stored body with that version
  and sha256 exists (`apps/api/src/core/streams/campaign-actor.ts:580-603`); members fetch it with
  `GET` on the same path (`apps/api/src/core/routes/campaign-packs.ts:151-166`). Routes, the
  `packMissing` convention and `welcome.packs` are in `03-sync-protocol.md` §Campaign packs.
- Members install the body automatically after validating it like a `.hero` bundle pack, with no
  assets (`apps/web/src/app/shared/services/campaigns/campaign-packs.service.ts:324-340`).
- **Pack ASSETS are never stored by the server — relay only.** They ride the blob relay as a P3
  tier: every asset hash of an enabled pack installed on the device at the enabled version is
  wanted when its blob is absent (`apps/web/src/app/shared/services/blob-transfer/
  blob-transfer.service.ts:142-151`, `:517`, `:567`). Holders (the DM's `.hkpack` copy at least)
  announce held pack-asset hashes in `blob.have` after every held portrait hash, within the same
  512-hash cap (`blob-transfer.service.ts:41`, `:544-557`). Received bytes are verified and
  stored `origin: 'peer'`; the cache manager's sweeps keep any hash an installed pack lists (plan
  15), so a relayed icon is never evicted.

## Export

Bundles include blobs referenced by the exported streams as `images/<hash>.<ext>`;
import verifies hashes and de-duplicates.

## Safety

Only `image/webp|jpeg|png` are stored; SVG uploads are rejected (script risk) — the
bundled icon set is the only SVG source and is compiled into a sprite at build time.
Images render via `<img src=blob:>` under the CSP `img-src 'self' blob: data:`.
