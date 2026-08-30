# Images and blobs

Decision record: ADR-010. This document is the how.

## Blob record (client, Dexie table `blobs`)

```
{ hash: "sha256:<hex>", mime, size, width, height, kind: icon|portrait|thumb|banner|token,
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

Caps (ADR-010): icon 256² / 64 KB; portrait 1024 long edge / 400 KB; banner 1600×600 /
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
| 1 | own character's portrait thumb + token; icons of equipped items and prepared spells | immediately on connect |
| 2 | party tokens; campaign banner | after 1 |
| 3 | full portrait; remaining own icons | when idle (`requestIdleCallback` or 2 s after 2) |
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

Content packs list assets by hash; a `.hkpack` ZIP carries them. Enabling a pack in a
campaign announces its assets (`pack.enabled` payload includes the manifest) so the DM's
device (which imported the pack) becomes their holder. The DO never stores pack assets;
it stores only the pack's JSON (ADR-008).

## Export

Bundles include blobs referenced by the exported streams as `images/<hash>.<ext>`;
import verifies hashes and de-duplicates.

## Safety

Only `image/webp|jpeg|png` are stored; SVG uploads are rejected (script risk) — the
bundled icon set is the only SVG source and is compiled into a sprite at build time.
Images render via `<img src=blob:>` under the CSP `img-src 'self' blob: data:`.
