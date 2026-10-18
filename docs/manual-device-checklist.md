# Manual device checklist — Phase 1b wrap (plan 6) + Phase 2 sync (plan 8) + Phase 3 campaigns (plan 10) + Phase 4 engine vocabulary (plan 11) + slice 2 (plan 12) + slice 3 (plan 13) + slice 4 (plan 14) + slice 5 (plan 15)

This checklist covers what the automated suites deliberately don't: real installs, real
offline/airplane-mode behavior, a real cross-device file transfer, and a real on-device timing
number. It supplements, and never replaces, the automated gates:

- `pnpm check` — format, lint, typecheck, engine + web unit tests (819 web tests as of the plan-8
  client-sync final fix wave; includes the dev-mode perf-log spec below).
- `pnpm --filter web e2e` — Playwright against the real production build: 13 spec files, 31 tests
  as of plan 15 (offline, library/search/locale, character creation (Fighter, Monk, Rogue with
  Expertise, Soldier options), level-up, multiclassing, play actions, export/import, custom content
  packs, axe accessibility).
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
  all 9 Playwright spec files against it).
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

## 7. Campaigns (Phase 3, plan 10) — two-device table test

**What this proves:** the same things `pnpm --filter web e2e:sync`'s campaign specs
(`campaign-table.spec.ts`, `campaign-claim.spec.ts`, `campaign-portrait.spec.ts`,
`campaign-session-lock.spec.ts`) already prove with two/three browser contexts on one machine —
join by scanning a real QR code with a real camera, visibility-routed rolls, a DM effect landing
live, a portrait actually relaying over Wi‑Fi, and a lobby removal — but between two real devices
on real Wi‑Fi, and with a real camera reading the QR code (something no Playwright context can
exercise).

Use the same LAN-reachable dev server as section 6 (`pnpm --filter api dev:node` +
`pnpm --filter web start -- --host 0.0.0.0`), with both phones already signed in to their own
accounts (section 6, steps 1–3) — reuse phone A/B's accounts and characters if you still have them
from that pass, or create fresh ones.

### Procedure

1. **Create + join by QR**: on phone A, go to **Campaigns** → **New campaign**, name it, confirm —
   this lands on the campaign's **Lobby** tab, which shows the join code and a QR code. On phone B,
   open the device camera (or QR scanner) and point it at phone A's screen; confirm it offers to
   open the `/join/<code>` link, tap it, and confirm the join screen's code field is already filled
   in. Fill a display name, **Join**, then pick (or create) a character to link.
2. **Party overview**: on phone A's **Party** tab, confirm phone B's linked character's card
   appears with a name, HP/AC, and class/level within a few seconds (no manual refresh).
3. **Roll visibility**: on phone B's own character sheet (Play tab), set the roll-visibility picker
   above the dice roller to **DM only**, then tap any **Roll check** button. On phone A's **Log**
   tab, confirm the roll appears. If you have a third device (or a second account) joined as an
   ordinary player, confirm that device's own Log tab does **not** show it.
4. **Chat**: send a chat message from either phone at the default **Everyone** visibility; confirm
   it appears on the other phone's Log tab live, no reload.
5. **DM effect lands live**: on phone A's **Party** tab, expand **DM tools** on phone B's
   character's card and apply a small amount of damage. On phone B — sheet already open, no
   reload — confirm the Play tab's Current HP drops by that amount within a few seconds.
6. **Portrait relay**: on phone B, set a portrait (Build tab, if this character doesn't already
   have one). On phone A's **Party** tab, confirm the placeholder monogram on that character's
   card is eventually replaced by the real portrait thumbnail (this is the blob-transfer client
   actually pulling the image bytes from phone B over the campaign socket — phone A never
   received the file any other way).
7. **Removal bye**: on phone A's **Lobby** tab, tap **Remove** on phone B's member row and confirm.
   On phone B — wherever it currently is inside the campaign (Party/Log/Lobby/Settings) — confirm
   it's redirected to the **Campaigns** list within a few seconds, with a toast explaining it was
   removed, with no manual action on phone B.

### Results

| Devices (A / B) | Date | QR join | Roll visibility | DM effect live | Portrait relay | Removal bye |
| --- | --- | --- | --- | --- | --- | --- |
| _(e.g. Pixel 7a / iPhone 13, Safari)_ | | | | | | |
| | | | | | | |

---

## 8. Multiclassing & pact-slot casting (Phase 4 slice 1, plan 11)

**What this proves:** the which-class picker (ADR-007) and Pact Magic casting render and respond
correctly to real touch input on a real phone — `apps/web/e2e/multiclass.spec.ts` (default
project) and the engine goldens already prove the underlying logic; this is the same real-device
reality-check sections 1–2 already do for install/offline.

### Procedure

1. On the installed app, build a Fighter through the creation wizard (as in section 2). Award it
   300 XP (the sheet's Award XP field) and tap the "Level up available" badge.
2. Confirm a "Which class?" picker appears, offering the character's own next level PLUS at least
   one "Multiclass into <class>" option (the standard array qualifies for more than one class) —
   confirm every option is comfortably tappable at your device's real screen width, with no
   overlap or overflow.
3. Tap a "Multiclass into <class>" option. Confirm the wizard skips straight into that class's own
   level-1 choices with no HP step at all (a brand-new class's own level 1 is priced automatically
   at that class's average hit die — no roll/average choice to make, unlike your very first
   class's own level 1, which took the hit die's max value at character creation), and complete
   them.
4. Finish the level-up. Confirm the sheet header now reads both classes (e.g. "Fighter 1 ·
   Barbarian 1").
5. Separately, build a Warlock through the creation wizard (Pact Magic grants its first slot at
   level 1 — no extra leveling needed for this check). Prepare a known spell, then Cast it, and
   confirm the cast dialog's slot picker offers a "Pact slot" option. Cast it, confirm the pact pip
   fills (visually distinct from a regular slot's own pips at the same level, once both exist),
   then take a short rest and confirm it restores — Pact Magic recovers on a short OR long rest,
   unlike regular slots (which only recover on a long rest).

### Results

| Device | Date | Which-class picker | New-class choices | Pact-slot cast/rest |
| --- | --- | --- | --- | --- |
| _(e.g. Pixel 7a, Chrome)_ | | | | |
| | | | | |

---

## 8b. A new slice-2 class on a real phone (Phase 4 slice 2, plan 12)

**What this proves:** a class added by slice 2 plays correctly under real touch input —
`apps/web/e2e/create-monk.spec.ts` (default project) and the slice-2 engine goldens already prove
the logic; this is the real-device reality-check for the new content, including the two
slice-2 UI paths (pooled multiclass slots, always-prepared spells).

### Procedure

1. On the installed app, create a Monk through the wizard (any species/background; standard
   array). Confirm the class card is selectable, the six-skill pool offers exactly Acrobatics,
   Athletics, History, Insight, Religion and Stealth for the two picks, and there is no weapon
   mastery or fighting-style step. Equip nothing and create.
2. On the Play tab, confirm Armor Class reads 10 + your Dexterity modifier + your Wisdom
   modifier (Unarmored Defense), and the Focus Points / Martial Arts rows are present.
3. Build a Paladin (or level a character into Paladin once its STR and CHA are both 13+).
   At level 3 pick Oath of Devotion; confirm the spell block lists the oath's always-prepared
   spells, that they cannot be unprepared, and that they never count against the prepared cap.
4. For a multiclass caster (e.g. Cleric + Paladin), confirm the shared spell-slot pips render
   ONCE (pooled), with per-class prepared lists still separate, at your device's real width.
5. Add a charged magic item (e.g. a wand) to the inventory, equip or attune it, spend a charge
   on the Play tab, then take a long rest and confirm the charge is restored (dawn items restore
   on a long rest in v1; since slice 3 an item with regain dice restores a ROLLED amount rather
   than fully — see section 8c, step 6, and doc 04).

### Results

| Device | Date | Monk create/AC | Always-prepared (Paladin) | Pooled slots | Charge long-rest restore |
| --- | --- | --- | --- | --- | --- |
| _(e.g. Pixel 7a, Chrome)_ | | | | | |
| | | | | | |

---

## 8c. Slice-3 builder & play behaviors on a real phone (Phase 4 slice 3, plan 13)

**What this proves:** the new slice-3 UI paths behave correctly under real touch input and at a
real phone width, including the disabled-with-reason controls with a screen reader.
`apps/web/e2e/create-rogue.spec.ts` (default project) covers step 1 and step 2 automatically; the
other steps rely on unit specs and engine goldens (plan-13 task reports 1–10).

### Procedure

1. **Expertise pick** (task 1). Create a Rogue (any species; Soldier background; standard array).
   After the four class skills, confirm the Expertise step lists ONLY your proficient skills (the four
   class picks plus the background's), with no others. Pick two, create, and on the Play tab confirm each
   expertise skill shows an "Expertise" chip and a bonus of ability modifier + twice the proficiency
   bonus.
2. **Tool proficiencies** (task 2). On the same Rogue's Play tab, open Proficiencies and confirm
   "Thieves' Tools" is listed under Tools (with the background's tool). Create a Monk or a Bard and
   confirm its tool step (one tool for the Monk, three instruments for the Bard) shows up under Tools too.
3. **Offer-time gating** (task 8). Level a character to 4 and open the feat picker (or the Rogue's
   level-6 Expertise step). Confirm an option you do not qualify for, or one you already picked at
   level 1, stays LISTED but its select button is disabled, with a visible reason ("Prerequisites not met"
   / "Already chosen"). With TalkBack/VoiceOver, confirm focusing the disabled card reads the
   reason. The card's description toggle must still open.
4. **Pre-seeded re-pick** (task 9). Level a Fighter from 3 to 4. When Weapon Masteries is
   offered again (count 3 → 4), confirm the three recorded weapons are already selected and one
   more tap completes the step. Nothing should need re-picking.
5. **Free-cast lane** (task 4). On a Ranger (level 1+), cast Hunter's Mark. Confirm the cast dialog
   offers a free option labelled with the Favored Enemy resource beside the slot options. Casting
   through it spends a Favored Enemy pip and no slot. When the pips run out, the free option is no
   longer offered. A Druid 2+ sees the same thing for Find Familiar, paid with a Wild Shape use.
6. **Rolled regain on rest** (task 6). Equip a wand with regain dice (e.g. Wand of Magic Missiles,
   1d6+1), spend several charges, take a long rest, and confirm the charges come back by a rolled
   amount (capped at the max), not always fully. Repeat a few times: the amount should vary.
7. **Immunity badges** (task 5). On a Paladin 10+ (Aura of Courage), confirm the Conditions
   section shows an "Immunities" heading with a "Frightened (Aura of Courage)" badge. An Oath of
   Devotion Paladin 7+ also shows "Charmed (Aura of Devotion)". The badges cannot be removed, and
   the heading is absent for a character with no immunities.
8. **Disabled unprepare** (task 8). On a character with always-prepared spells (e.g. a Paladin's
   Divine Smite or Oath spells), confirm each always-prepared row in the Prepared list has an
   Unprepare button that is disabled, with the always-prepared reason as its tooltip and its
   screen-reader description.

### Results

| Device | Date | Expertise | Tools | Gating/reasons | Pre-seed | Free cast | Rolled regain | Immunities | Disabled unprepare |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _(e.g. Pixel 7a, Chrome)_ | | | | | | | | | |
| | | | | | | | | | |

---

## 8d. Slice-4 carries & rule options on a real phone (Phase 4 slice 4, plan 14)

**What this proves:** the slice-4 builder, sheet and timeline changes behave correctly under real
touch input at a real phone width, including the disabled Rule options select with a screen reader.
`apps/web/e2e/create-soldier-options.spec.ts` (default project) covers step 1 and the solo half of
step 5 automatically; the other steps rely on unit specs and engine goldens (plan-14 task reports
1–7).

### Procedure

1. **Gaming-set pick** (task 2). Create a Soldier (any class). Right after the class skills, confirm
   a "Tool proficiency: choose one kind of Gaming Set" step offers exactly four Gaming Sets (Dice,
   Dragonchess, Playing Cards, Three-Dragon Ante). Pick one, create, and on the Play tab confirm Tools lists that set by name (not a
   generic "gaming-set").
2. **Skilled skills or tools** (task 2). Give a character the Skilled feat (e.g. a Fighter 4's
   feat). Confirm its step lists skills AND tools in one list, accepts any mix of three (e.g. two
   skills plus Smith's Tools), and the Play tab shows the skills as proficient and the tool under
   Tools.
3. **Later-class Bard: one instrument** (task 1). Level a non-Bard into Bard. Confirm the level-up
   offers ONE Musical Instrument (not three), and the Play tab lists exactly that instrument under
   Tools, sourced from Bard. A non-Monk levelling into Monk gets no tool step.
4. **Attune Slippers → climb** (task 3). Add Slippers of Spider Climbing and equip them: the Play
   tab shows no climb Speed tile. Attune them: a climb Speed tile equal to your walk speed appears. Un-attune:
   it goes away. (A Thief 3+ already has the same climb speed from Second-Story Work, and attuning
   the Slippers does NOT double it.)
5. **Rule options + house-rule disabled state** (task 5). On a solo character's Build tab, open Rule
   options and set Encumbrance to Variant: the Play tab's inventory now shows a carry line ("… / …
   lb carried" plus a state). Set it back to Off: the line disappears. Then open a character that is
   in a campaign: the select shows the campaign's house-rule value, is disabled, and the reason
   "Set by your campaign's house rules." is shown; with TalkBack/VoiceOver, focusing the select reads
   that reason.
6. **Resistance badges** (tasks 3 and 6). Add and attune a Cloak of Arachnida. Confirm the Conditions
   section shows a "Resistances" heading with a badge reading "Damage type: Poison (Cloak of
   Arachnida)" (the type is named by the pack's damage-type rule entity); un-attune and the heading is
   gone.
7. **Timeline regain counts** (task 6). Spend two charges of a charged item, restore one pip from the
   Play tab, then open the Timeline: the sentence reads "Restored 1 charge of <item>". Do the same
   with a feature pool (e.g. Second Wind): it reads "use", not "charge". A long rest's full restore
   keeps the plain "Restored <name>." sentence. Item names show for item charges, not `item:<id>`.
8. **Provenance numbers** (task 6). Open the breakdown popover on a value built from a formula (the
   climb Speed tile from step 4, or a Thief 3+'s): the row shows the NUMBER (`+30`), not
   `speed(walk)`, and hovering/long-pressing the number reveals the formula.
9. **Seeded count message** (task 6). Level a Fighter 3 → 4 so Weapon Masteries re-opens with the
   three recorded weapons pre-selected: the step immediately shows "Select the required number of
   options." until the fourth pick is made.

### Results

| Device | Date | Gaming set | Skilled | Later Bard | Slippers climb | Rule options | Resistances | Regain counts | Provenance | Seeded count |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _(e.g. Pixel 7a, Chrome)_ | | | | | | | | | | |
| | | | | | | | | | | |

---

## 8e. Custom content packs on a real phone (Phase 4 slice 5, plan 15)

**What this proves:** importing a pack from the phone's own file picker, the trust screen, pinning
and updating packs, the rebase report, the homebrew forms, and `.hero` bundles that carry packs.
Everything runs under real touch input, at real phone width, with a screen reader.

`apps/web/e2e/custom-packs.spec.ts` (default project) automates the desktop path of steps 1–7.
`e2e/sync/auth.spec.ts`'s restore scenario automates the missing-pack banner on a second device.
This pass covers what those cannot: the native file picker, a real download and share, and a
second real device. Fixtures: copy `apps/web/e2e/fixtures/packs/sample-content.hkpack` and
`sample-content-v2.hkpack` to the phone first.

### Procedure

1. **Import + trust screen** (tasks 2–3).
   - Open Packs from the nav, tap Import, and pick `sample-content.hkpack` in the native picker.
   - The trust screen shows "Install Sample content?", 1 image, a dependency on `srd-5e-2024
     ^0.1.0`, the attribution, entity counts (1 each of item, spell, feat and species), and "This
     pack does not change any existing content." under overrides.
   - With TalkBack/VoiceOver, focus stays inside the dialog and its title is announced.
   - Install: the pack appears under Content.
   - Re-import the same file: Install is disabled, with "This pack is already installed."
2. **Pin in the wizard** (task 4). Start a new character.
   - The name step lists "Content packs", with Sample content unchecked. Check it.
   - Moonkin is offered as a species, and Moonblade Sickle among the Weapon Masteries.
   - Create the character, then open the Timeline: it shows "Pinned Sample content v1.0.0."
3. **Pin/unpin on the Build tab** (tasks 4–5).
   - Build → Content packs: the core row is checked and disabled, and its reason ("The core rules
     are always on.") is read out.
   - Uncheck Sample content: a report opens, listing the choices that would be cleared (the Moonkin
     species, and the Moonblade Sickle mastery if you picked it).
   - Cancel: the box goes back to checked and nothing changes.
4. **Update report** (task 5).
   - Import `sample-content-v2.hkpack`. On `/packs`, the 1.1.0 row shows "Update available".
   - In the character's Build tab, the row reads "Update available: v1.0.0 → v1.1.0". Tap Update.
   - The report lists "Weapon Masteries: Moonblade Sickle → Moonsilver Sickle" under "Choices moved
     to a replacement". Confirm.
   - The Timeline reads "Updated Sample content v1.0.0 → v1.1.0."
5. **Missing-pack banner** (task 4). Remove Sample content 1.1.0 from its detail page.
   - The detail page shows "Used by 1 character" before you confirm.
   - The character's sheet now shows the warning banner listing `sample-content@1.1.0`, with a
     "Manage packs" link. The banner is on every tab.
6. **Homebrew forms** (task 7).
   - Packs → Homebrew → New item. Save with an empty name: the error is announced and
     `aria-invalid` is set. Then save "Starlit Lantern".
   - Do the same with a spell (pick at least one class), a feat, and a species with one trait.
     Russian or Ukrainian names give readable slugs.
   - Pin "My homebrew" on a character's Build tab: the item appears in Play → Add from library.
   - Edit the item's name: the pinned character fast-forwards silently, and the toast says "1
     character updated".
7. **`.hero` with packs** (task 6).
   - Export a character that pins Sample content and homebrew.
   - Remove Sample content on the phone, then import the `.hero` from the characters list.
   - The pack is back under Content, and the sheet shows no banner.
   - Also import the `.hero` on a second device that never had the pack: the pack installs there
     too.
8. **Other-device homebrew hint** (task 7 fix round). On that second device, `/packs` lists the
   first device's homebrew pack with "From another device". Its own "My homebrew" (after one save
   there) is a separate row without the hint.

### Results

| Device | Date | Import + trust | Wizard pin | Pin/unpin | Update report | Missing banner | Homebrew forms | `.hero` packs | Other-device hint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _(e.g. Pixel 7a, Chrome)_ | | | | | | | | | |
| | | | | | | | | | |

---

## 9. Known Phase-4 / backlog items

These are known, deliberate scope boundaries or design rulings from plan 5/6 — not bugs to file
again, but worth knowing about while doing manual passes:

- **Weapon-mastery picks are real weapon picks** (plan 11 task 6; multiclass cap plan 14 task 4):
  the old plan-5 freeform mastery text is gone. Each `weapon-masteries` choice is an entity pick
  over the weapons that have a mastery property, and the Attacks table's Mastery column
  (`attack.mastery` in `play-tab.component.html`) shows that weapon's own SRD mastery property —
  only for an equipped weapon that was picked. With two mastery classes, the count is the larger
  class count (not the sum), and picks past it are not applied. A legacy free-text mastery
  decision from an old character is inert: it shows nothing and does not crash.
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
