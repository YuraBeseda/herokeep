# Manual device checklist — Phase 1b wrap (plan 6) + Phase 2 sync (plan 8)

This checklist covers what the automated suites deliberately don't: real installs, real
offline/airplane-mode behavior, a real cross-device file transfer, and a real on-device timing
number. It supplements, and never replaces, the automated gates:

- `pnpm check` — format, lint, typecheck, engine + web unit tests (562 web tests as of this plan;
  includes the dev-mode perf-log spec below).
- `pnpm --filter web e2e` — Playwright against the real production build: 8 spec files, 20 tests
  (offline, library/search/locale, character creation, level-up, play actions, export/import,
  axe accessibility).
- `packages/engine/test/perf.test.ts` — an automated perf *tripwire* (median of 5 reduce+derive
  runs over an extended fixture, budget 150 ms — generous CI headroom, not the real-device number).
  This is the "automated proxy" the plan's Global Constraints refer to; the device numbers below
  are the actual measurement it stands in for.
- `pnpm --filter web e2e:sync` — a second Playwright project against a real Node API adapter
  (register/login/recover, cross-device restore, live two-context sync, device revocation). It
  proves the same protocol section 6 below walks through by hand, but as two browser contexts on
  one machine — not two real devices on real Wi‑Fi, which is what section 6 is for.

Run each pass on an actual phone, not a desktop responsive-mode simulation.

---

## 1. Install

### Android (Chrome)

1. Open the deployed app URL in Chrome.
2. Go to the characters list (`/characters`). If the browser qualifies the page for install
   (`beforeinstallprompt`), the in-app banner shows an **Install** button — tap it, confirm the
   native install dialog.
3. If the banner doesn't offer **Install** yet, use Chrome's own menu → *Add to Home screen* /
   *Install app* instead — either path is a valid pass.
4. Launch the app from the home-screen icon. Confirm it opens **standalone** (no browser
   address bar/tabs chrome).

### iPhone (Safari)

Safari never fires `beforeinstallprompt` — there is no native install prompt on iOS, so the app
falls back to its own instructions sheet.

1. Open the deployed app URL in Safari, go to the characters list.
2. The banner shows a **How to install** button instead of **Install** — tap it. Confirm the sheet
   reads, in order:
   1. "Tap the Share button in Safari's toolbar."
   2. "Scroll down and tap \"Add to Home Screen\"."
   3. "Tap \"Add\" to confirm."
   - and separately warns: "Safari removes a web app's saved data after 7 days without opening
     it. Installing to your Home Screen keeps your characters from being deleted." — **read this
     note out loud during the pass**; it's the reason this checklist exists at all for iOS users
     who don't install.
3. Follow the three steps via Safari's real Share sheet.
4. Launch from the home-screen icon. Confirm standalone display (no Safari chrome).

---

## 2. Airplane-mode pass (create → play → reload, fully offline)

Do this on the **installed** app (either platform), after it has been opened online at least once
(the service worker needs one online load to precache the app shell and the core content pack).

1. Open the installed app once online; let it finish loading (character list or library visible).
2. Turn on Airplane Mode (or otherwise fully disconnect Wi‑Fi and cellular data).
3. Relaunch the app from the home-screen icon. Confirm it opens with no network at all.
4. **Create**: run the full creation wizard (name/gender → species → background → ability scores →
   class/skills/fighting style → spells → equipment → review) end to end and confirm the character
   is created (creation is a local, on-device transaction against the SW-cached content pack — no
   network call is involved).
5. **Play**: open the new character's Play tab and perform at least one action that appends an
   event (e.g. apply damage, toggle inspiration, or roll dice) — confirm the sheet updates and the
   Timeline tab shows the new event.
6. **Reload**: force-quit the app and relaunch it, still offline. Confirm the character and the
   action from step 5 are both still there (this proves the write actually landed in the device's
   own IndexedDB, not just in memory).
7. Turn networking back on afterward.

This is deliberately broader than `apps/web/e2e/offline.spec.ts`, which only proves the app shell
and the Library still render from cache offline — it does not exercise character creation or play
actions offline.

---

## 3. Export on iOS → transfer → import on Android

1. On the iPhone, open a character that has a portrait set (Build tab → set a portrait first if
   needed).
2. On the sheet header, tap **Export**. iOS has no File System Access API, so the delivery ladder
   falls to `navigator.share({ files })` — the native Share sheet opens with the `<name>.hero`
   file attached.
3. Transfer that file to the Android device by whatever share target is convenient — AirDrop to a
   Mac then move it over, or share directly to a cloud-storage/messaging app the Android device can
   also reach (e.g. save to Google Drive, or send via email to yourself).
4. On the Android device, download/save the `.hero` file locally, then open the app's characters
   list and tap **Import**, and pick that file.
5. Confirm the character reappears with the same name and HP, and — the specific check this pass
   exists for — the **portrait renders correctly** (not stretched/cropped wrong, not a broken
   image) both in the characters-list row and the sheet header.

(A same-device export/import round trip is already covered by
`apps/web/e2e/export-import.spec.ts`; this pass is specifically about a real cross-device file
transfer and a real portrait surviving it.)

---

## 4. Perf measurement

**What this measures:** `CharacterStore`'s `loadNow` — the replay (`reduce`) plus one `derive`
call done when opening a character — timed and logged as `[perf] reduce+derive <ms>` via
`console.info`, gated behind Angular's `isDevMode()` so it never runs in the production build
(`apps/web/src/app/shared/stores/character.store.ts`). Because it's dev-mode-only, you need to run
the **development** build, not the installed production PWA, to see it.

**Acceptance: < 30 ms on a mid-range Android device.**

### Procedure

1. From the repo root, start the dev server reachable on your LAN:
   `pnpm --filter web start -- --host 0.0.0.0`
   Note the Network URL it prints (or find your machine's LAN IP and combine it with the printed
   port — 4200 by default).
2. On the phone (same Wi‑Fi), open that Network URL in the browser.
3. Build a level-5 character (Fighter Champion or Wizard Evoker) via the creation wizard, then the
   level-up wizard, up to level 5 — or reuse one you already have at that level.
4. Enable remote debugging so you can read the console:
   - **Android Chrome**: enable Developer Options + USB debugging on the phone, connect it to a
     desktop machine via USB, open `chrome://inspect` in desktop Chrome, find the phone's tab
     under "Remote Target" and click **inspect** to open DevTools, then the **Console** panel.
   - **iOS Safari**: on the iPhone, Settings → Safari → Advanced → turn on **Web Inspector**.
     Connect the iPhone to a Mac via cable, open Safari on the Mac, enable the **Develop** menu
     (Safari → Settings → Advanced → "Show Develop menu" if not already on), then
     Develop → *(your iPhone's name)* → *(the page)* to open Web Inspector, then its Console tab.
5. From the characters list, tap into the level-5 character. This navigates to `/c/:id`, which
   resolves through `CharacterStore.load(id)` before the sheet renders — the `[perf]` line appears
   in the console at that point.
6. Record the number below. Repeat for each device you can get your hands on.

### Results

| Device | Date | ms |
| --- | --- | --- |
| _(e.g. Pixel 7a, Chrome)_ | | |
| | | |
| | | |
| | | |

---

## 5. Accessibility / e2e pointers

- Full suite: `pnpm --filter web e2e` (builds production first via the `pree2e` script, then runs
  all 8 Playwright spec files against it).
- Accessibility only: `pnpm --filter web e2e -- e2e/a11y.spec.ts` — runs `apps/web/e2e/a11y.spec.ts`
  alone (11 axe-core passes: home, library, a library detail, settings, about, the characters list,
  the ability-scores wizard step, the sheet's play/build/timeline tabs, the short-rest dialog, the
  cast dialog, and the roll log with a logged entry — each asserted to have no serious/critical
  violations).
- Unit tests only: `pnpm --filter web test --watch=false`.
- Everything (the pre-commit gate): `pnpm check`.

---

## 6. Cross-device sync (Phase 2)

**What this proves:** accounts, restore-on-new-device, and *live* sync (not just upload-on-login)
between two real devices on real Wi‑Fi — the thing `pnpm --filter web e2e:sync` proves with two
browser contexts on one machine, but never with two actual phones.

### Get a LAN-reachable dev server

Root `pnpm dev` (`scripts/dev.mjs`) runs the Node API adapter and `ng serve` together, but it
doesn't forward extra CLI args to either child — so it can't be told to bind `ng serve` to your
LAN interface. For this pass, run the two halves **separately, in two terminals** instead:

1. Terminal 1: `pnpm --filter api dev:node` — the Node adapter listens on `127.0.0.1:8787` (the
   default; leave it there — see below).
2. Terminal 2: `pnpm --filter web start -- --host 0.0.0.0` — same flag as the perf pass above.
   Note the Network URL it prints (or your machine's LAN IP + port 4200).

The API adapter staying on `127.0.0.1` is fine: `apps/web/proxy.conf.json` proxies `/api` and
`/packs` from *inside* the `ng serve` process, which runs on your desktop and reaches
`127.0.0.1:8787` locally regardless of what address a phone used to reach `ng serve` itself. You
do **not** need to set `HK_HOST` for this pass.

If you want a persistent LAN/WAN endpoint instead of a temporary dev pass (e.g. to leave sync
running for longer than one sitting), use the self-host route instead:
[`docs/self-hosting-windows.md`](docs/self-hosting-windows.md).

### Procedure

1. On phone A (same Wi‑Fi as your desktop), open the Network URL from above. Go to **Settings** →
   **Account** → **Create an account**. Register with a username, password, and device label
   (e.g. "Phone A"); on the recovery-codes screen, download or copy the codes, check "I saved my
   recovery codes", and continue.
2. Create a character on phone A (creation wizard, as in section 2).
3. On phone B, open the same Network URL, go to **Settings** → **Account** → **Log in**, and sign
   in with the same username/password (a different device label, e.g. "Phone B").
4. **Restore**: confirm the character created in step 2 appears in phone B's character list
   without any manual action — this is restore-on-new-device, driven by login alone.
5. **Live sync**: with both phones' apps open, make a change on phone A (e.g. apply damage on the
   Play tab) and, without touching phone B, watch phone B's sheet/character update on its own
   within a few seconds — this is the live WebSocket path, not the one-time upload/restore from
   steps 2–4. Repeat in the other direction (edit on B, watch A).
6. **Devices list**: on either phone, go to **Settings** → **Devices**. Confirm both device
   labels are listed, each with a last-active time, and the current device is tagged "This
   device". Tap **Revoke** on the *other* device, confirm the dialog; on that other phone, the
   next action against the server (e.g. any edit) should sign it back out to the login prompt.
7. **Quota**: on either phone, **Settings** → **Storage quota** shows usage against the account's
   limits once at least one character has synced (before any sync it reads "No synced characters
   yet").
8. **Recovery-code reset**: on a signed-out browser (or after logging out on one phone), go to
   `/login` → **Forgot your password?** → enter the username, one of the saved recovery codes, and
   a new password → **Reset password**. Confirm you can log back in with the new password
   afterward, and that this signs out every *other* device with an active session (per the
   recover screen's own "Resetting your password will sign you out of every other device."
   notice) — check a still-open session on another phone gets signed out too.

### Results

| Devices (A / B) | Date | Restore | Live sync | Revoke | Recovery reset |
| --- | --- | --- | --- | --- | --- |
| _(e.g. Pixel 7a / iPhone 13, Safari)_ | | | | | |
| | | | | | |

---

## 7. Known Phase-4 / backlog items

These are known, deliberate scope boundaries or design rulings from plan 5/6 — not bugs to file
again, but worth knowing about while doing manual passes:

- **Weapon-mastery freeform typo trap** (plan-5 ruling R4): the Attacks table's Mastery column
  (`attack.mastery` in `play-tab.component.html`) renders whatever free text was entered for that
  weapon during the build flow — there is no controlled vocabulary or spell-check. A typo there
  will silently display as typed; it's not validated against the SRD's actual mastery list.
- **Resource/action names depend on the pack providing a resolvable source entity**: play-tab
  resource/action rows call `localizer.name(view.source)` when the `source` entity resolves against
  the loaded pack, and otherwise fall back to `view.name` — which is a baked **English** string
  (`ResourceView`/`ActionView`, `@hk/engine`). A resource or action whose source entity can't be
  resolved (a pack mismatch, a hand-built `DraftEvent` referencing something outside the pack) will
  show in English regardless of the active UI locale.
- **Exhaustion (and every other level-bearing condition) has no level cap in the UI**: the
  condition-add dialog's level stepper is a free `min="1"` number field with deliberately no `max`
  — the pack's own `levels` field (exhaustion = 6) only marks a condition as level-bearing, never a
  UI cap (`condition-dialog.component.ts`). Entering an out-of-range level (e.g. exhaustion 9) is
  currently possible and will not be rejected.
- **`tokenHash` is always identical to `thumbHash` today**: no separate token-art blob is generated
  — a would-be 256×256 token box hashes byte-for-byte identical to the thumb box today, so
  `ImagePipelineService` just reuses `thumbHash` rather than re-encoding an identical blob. If
  token art ever needs to diverge from the thumb crop (a circular mask, a different crop for
  campaign-map tokens), `image-pipeline.service.ts`'s class doc names the exact seam to split it
  back into its own `encodeWithinCap('token', …)` call.
- **Dialog accessible titles are a naming convention, not a type-checked contract**: every dialog's
  accessible name comes from `DialogComponent` finding a `[data-dialog-title]` attribute on the
  attached content's own title `<h2>` (`dialog.component.ts`) — a plain DOM data attribute, because
  the portal content's injector can't reach back up into the dialog shell to register itself any
  other way. A new dialog component that forgets to add `data-dialog-title` to its heading won't
  fail to compile or fail a unit test that doesn't specifically check for it — it silently falls
  back to the dialog's `ariaLabel` default instead.
