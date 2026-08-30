# ADR-010 — Images: limits, formats, transfer, offline behavior

**Status:** Approved 2026-08-30. Depends on ADR-001, ADR-002. Details in
`02-architecture/07-images-and-blobs.md`.

## Context

The app must look like a game: item icons, spell icons, portraits, maybe a campaign
banner. Users upload images; images must never be persisted on project infrastructure;
they may transit the server in memory. Phones with limited storage must not be filled.
Research (2026-08-29): Safari cannot encode WebP from a canvas (silently returns PNG);
AVIF encoding is not available; iPhones produce HEIC, which Safari transcodes to JPEG on
file input unless HEIC is explicitly accepted; Chrome cannot decode HEIC.

## Options considered

| Concern | Options | Decision |
|--------|---------|----------|
| Where images live | server storage (forbidden) / device-only with P2P relay (chosen) / third-party CDN (money, privacy) | Device-only; relayed through the DO in memory |
| Identity | filename / UUID / **content hash** | SHA-256 of the encoded bytes: dedup, cache-forever, integrity check |
| Format | original / WebP only / **WebP where encodable, JPEG for photos and PNG for transparency elsewhere** | Feature-detect WebP encoding once (1×1 canvas test); a WASM WebP encoder is an optional later enhancement |
| Sizing | server-side (impossible) / **client-side before storing** | `createImageBitmap` with `resizeWidth/Height` + canvas encode |

## Decision

### Kinds and hard caps (after client-side processing)

| Kind | Max dimensions | Max bytes | Typical use |
|------|----------------|-----------|-------------|
| `icon` | 256 × 256 (square, padded) | 64 KB | items, spells, features |
| `portrait` | 1024 on the long edge | 400 KB | character portrait; a 256-px thumbnail is generated alongside |
| `banner` | 1600 × 600 | 400 KB | campaign header |
| `token` | 256 × 256 (circular mask applied in UI) | 64 KB | party view avatars (derived from portrait automatically) |

Budgets: per pack 30 MB of assets; per campaign 150 MB total announced; per character 5
images; device cache cap default 500 MB (configurable), LRU eviction with pins for own
characters and the current campaign. Uploads exceeding a cap are re-encoded at lower
quality until they fit, or rejected with a clear message.

### Processing pipeline (browser)

decode (`createImageBitmap`; HEIC only on Safari, so the file input does *not* declare
`image/heic` to let iOS transcode to JPEG) → orientation fix → resize → encode (WebP
q=0.82 if the browser can encode it, else JPEG q=0.85 for opaque images or PNG for images
with alpha) → SHA-256 → store `{hash, mime, bytes, width, height, kind}` in Dexie → emit
the referencing event (`portrait.set {hash, thumbHash}`; pack asset manifests carry
`{hash, kind, mime, size}`).

### Transfer (device ↔ device via the DO)

- Every client reports the hashes it holds for the current context on connect
  (`blob.have`) and after each download. The DO keeps an in-memory `hash → sockets` map
  (rebuilt from reports after hibernation).
- `blob.request {hash}` → the DO picks a holder (uploader first, then the DM, then any) and
  sends `blob.pull {hash, to}`; the holder streams 64 KB binary chunks; the DO forwards
  each chunk to the requester and drops it. Nothing is written to DO storage — ever.
- One blob in flight per requester; prefetch order: thumbnails and icons of *your*
  character, then party tokens, then the rest while idle. The DM's client pulls every
  announced blob automatically (super-peer), so the DM's device holds all campaign
  images.
- No holder online → `blob.unavailable`; the UI shows a placeholder and retries when
  peers appear.

### What a player sees when images are unavailable

Placeholders are meaningful, not broken: an icon from the bundled game-icons.net set
chosen by entity type/tags (a spell school glyph, a weapon category glyph), and a
monogram token for portraits. Missing images never block any interaction.

### Bundled icon set

A curated subset (~300) of game-icons.net SVGs (CC-BY-3.0) as an SVG sprite, mapped to
SRD entities by a `icons.json` in the core pack; tintable with CSS. Portraits are never
bundled — users bring their own.

### Export

Bundles (`.hero`, `.campaign`) include referenced blobs, so a file export carries
images even though the server never does.

## Consequences

- Cross-device sync of *images* is P2P or by file only. A player logging in on a new
  phone gets images when the DM (or the uploader) is online. This is the honest cost of
  "never on our infrastructure" and the UI explains it once.
- Server bandwidth is tiny: each image crosses the DO once per receiving device.
- The DO's 32 MiB message limit is irrelevant with 64 KB chunks.

## Open points

- Whether to ship a WASM WebP encoder (~150 KB, loaded lazily) for Safari uploads is a
  Phase 5 polish item; JPEG at q=0.85 is fine for portraits meanwhile.
