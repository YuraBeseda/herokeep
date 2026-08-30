# Platform research: browser storage, PWA, connectivity, images

*All facts checked 2026-08-29 against the cited sources (MDN browser-compat-data 8.0.13 of 2026-08-27, webkit.org, developer.chrome.com, web.dev, caniuse). Re-verify before relying on them in a later year.*

Raw fetched source pages were kept in the research scratchpad (`scratchpad/pages/`, one file per source).

## 1. Storage durability

### Safari / WebKit (17+)

- Origin quota: up to 60% of disk in browser apps; Home Screen web apps get the browser quota.
- Eviction: LRU per origin on disk pressure; persisted origins and active pages are exempt.
- `navigator.storage.persist()` is granted by heuristics (e.g. the site was opened as a Home Screen web app).
- OPFS shares the same quota.
- Sources: webkit.org/blog/14403/updates-to-storage-policy/ (Aug 2023); webkit.org/blog/14445/

### Chromium

- Origin quota: up to 60% of disk.
- `persist()` is auto-granted silently by heuristics (site engagement, installed/bookmarked, notification permission).
- Sources: web.dev/articles/persistent-storage; MDN "Storage quotas and eviction criteria".

### Firefox

- Best-effort quota: min(10% of disk, 10 GiB). Persistent quota: 50% of disk.
- `persist()` prompts the user.

### Safari 7-day ITP wipe (still in force)

- Script-writable storage is wiped when there has been no user interaction in the last 7 days of browser use (MDN; webkit.org/blog/10218/).
- Home Screen web apps are exempt (they have their own counter).
- `persist()` does NOT exempt browser-tab Safari (WebKit bug 209563, status still NEW, last modified 2025-07-24).

### OPFS writable streams on Safari

- Safari 26.0 (Sep 2025) added `FileSystemFileHandle.createWritable` (OPFS writable streams); sync access handles have been available since Safari 15.2. Source: webkit.org/blog/17333/

## 2. PWA reality

### iOS

- iOS 26: zero installability requirements; any site added to the Home Screen opens as a web app; user toggle "Open as Web App".
- Third-party iOS browsers can Add to Home Screen since iOS 16.4. Home Screen apps remain WebKit.
- Service workers and Web Push in Home Screen web apps since iOS 16.4 (push needs a user gesture). Declarative Web Push since iOS 18.4.
- Background behaviour: JS and timers pause shortly after backgrounding or screen lock; WebSockets are closed (WebKit bug 228296); WebRTC and Web Audio are suspended on lock (Apple developer forum thread 777860; exact timings unverified). Plan to reconnect on `visibilitychange` / `pageshow`.

### Android Chrome

- `freeze` / `resume` events since Chrome 68.
- Chrome 133+ Energy Saver freezes hidden tabs after more than 5 minutes unless the page has an open RTCDataChannel, holds a Web Lock, or has a blocking IndexedDB connection.
- Pages with an open WebSocket are exempt from aggressive timer throttling (Chrome 88 blog).

### Screen Wake Lock

- Chrome 84, Firefox 126, Safari 16.4.
- iOS: Home Screen web apps only, since iOS 18.4 (WebKit bug 254545).
- The lock is released when the page is hidden.

## 3. WebRTC on iOS Safari

- RTCDataChannel supported since Safari 11.
- Safari 26.4 (Mar 2026) fixed DataChannel close events not firing on PeerConnection close. Further unspecified fixes in 26.5 / 26.6.
- mDNS: all browsers replace host candidates with `.local` names.
- w3c/webrtc-pc#3109 (May 2026): on macOS 26+ an RTCPeerConnection created without getUserMedia triggers the OS "Local Network" prompt; if denied, LAN host candidates fail (Apple TN3179). iOS uses the same mechanism (unverified).
- Client-isolated venue access points block P2P host candidates entirely, so a TURN or hotspot fallback is needed.

## 4. Client-side image encoding

- WebP encode via canvas `toBlob` / `convertToBlob`: Chrome 50, Firefox 96, Edge 79. Safari: NOT supported through 26.6 / 27; it silently falls back to PNG (caniuse: mdn-api_htmlcanvaselement_toblob_type_parameter_webp). Use JPEG/PNG on Safari, or a WASM encoder (e.g. jsquash).
- AVIF encode: no BCD entry; treat as unavailable.
- `createImageBitmap` resize options: Chrome 54, Safari 15, Firefox 98.
- HEIC decode: Safari 17+ only; Chromium marked WontFix. iOS Safari transcodes HEIC to JPEG on `input type=file` unless `accept` includes `image/heic` (semi-official). Otherwise use heic2any / libheif-wasm.

## 5. Export UX

- `showSaveFilePicker`: Chrome/Edge 86, Chrome Android 132; Firefox and Safari: not supported.
- `a[download]`: Safari 10.1 / iOS 13; same-origin, `blob:` and `data:` URLs only; flaky in iOS standalone mode (currently unverified).
- Web Share with files: Safari/iOS 14+, Chrome Android 76, Chrome desktop 89 (Windows/ChromeOS), Edge 81; Firefox: no; requires transient activation. This is the best iOS export path.

## 6. Multi-tab coordination

- BroadcastChannel: Chrome 54, Firefox 38, Safari 15.4.
- Web Locks: Chrome 69, Firefox 96, Safari 15.4.

## 7. Page lifecycle

- `freeze` / `resume` events are Chromium-only. `pageshow` with `persisted` is universal.
- Safari does not fire `visibilitychange` on navigate-away; also listen for `pagehide`.
- Chrome: close WebSocket, IndexedDB, BroadcastChannel and WebRTC connections and release locks on `freeze` or bfcache entry; reopen on `resume` / `pageshow`.

## Top 5 platform risks

1. Safari 7-day wipe for browser-tab users; `persist()` does not help. Direction: push Home Screen install; keep multiple copies; server backup.
   Handled by ADR-003.
2. iOS background/lock kills WebSocket and WebRTC connections in seconds and pauses JS; Wake Lock only on iOS 18.4+ Home Screen apps.
   Handled by ADR-002.
3. LAN P2P fragility: client isolation on venue access points plus Local Network permission prompts (macOS 26, likely iOS).
   Handled by ADR-002.
4. No WebP/AVIF encode on Safari, so JPEG/PNG or a WASM encoder is needed; HEIC transcoding needed for non-Safari browsers.
   Handled by ADR-010.
5. No `showSaveFilePicker` on Safari/Firefox; shaky `a[download]` in iOS standalone mode, so use Web Share (files).
   Handled by ADR-003.
