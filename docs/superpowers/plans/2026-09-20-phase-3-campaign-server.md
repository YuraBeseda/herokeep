# Phase 3 Plan 9 — Campaign Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the campaign backend: campaign event schemas in `@hk/protocol`, the `CampaignActor` (permissions with a real `member` role, per-connection read filtering, presence, the char-stream gateway, cross-stream mirrors, blob relay) on BOTH adapters, campaigns/memberships D1 tables + join-by-code routes, `bye` frame emission (a plan-8 ledger flag), maintenance/quota coverage, and conformance scenarios for it all. The campaign CLIENT (host/join UI, party view, DM tools, blob transfer client, super-peer prefetch) is the NEXT plan — this plan ends with a server the conformance suite can drive as DM + members end-to-end.

**Architecture:** CampaignActor extends the plan-7 StreamActor exactly as CharacterActor does; the two ready-made seams get their real implementations: `StreamActor.filterForConnection` (visibility: `dm.note_*` DM-only; `roll.logged` by its `visibility` field) and `ports.Rpc` (gateway forwarding + after-commit character→campaign notify). Campaign state is server-index + DO-authoritative — `@hk/engine` stays untouched (campaign reduction is explicitly NOT engine work per doc-01/doc-05; the client plan owns the character-side `notApplicableSolo` upgrades). D1 gains `campaigns`/`memberships` via the additive migration the schema comment already reserves.

**Tech Stack:** Existing only (Hono, Drizzle, better-sqlite3, ws, wrangler/pool-workers, Zod). No new dependencies expected; any that prove necessary are verified+pinned at execution.

**Spec:** `docs/03-roadmap/phases.md` Phase-3 row (server half); `docs/02-architecture/02-domain-model-and-events.md` §campaign-stream catalog + §settings doc + D1 tables (BINDING payloads/actors — executor reads the catalog section in full); `docs/02-architecture/03-sync-protocol.md` (gateway, mirrors, subscribe/members, blob frames, bye — IN FULL); `docs/02-architecture/08-security-permissions-quotas.md` (BINDING authorization matrix incl. campaign rows, read-filtering rules, campaign quotas 20 MB/12 members/6 packs×5 MB — IN FULL); `docs/02-architecture/07-images-and-blobs.md` §Blob transfer protocol (BINDING relay mechanics: holder priority, 16-byte chunk header, ≤64 KB chunks, 1-in-flight/requester, 2-serves/holder, blob.resend-have); `docs/02-architecture/10-backend-architecture.md` §CampaignActor; ADR-004 (join semantics). ADRs never edited.

## Global Constraints

- Repo non-negotiables hold. TDD strictly red-first with captured RED evidence (WIP-commit/path-scoped-stash revert techniques from prior plans; if sandbox blocks reverts, per-assertion reasoning evidence is the documented fallback). Conventional Commits; the executing session's trailer.
- Core boundary rule unchanged (`apps/api/src/core/**` imports only ports + @hk/protocol). The two Phase-3 seams are EXTENDED, not replaced: `filterForConnection` gets its real implementation; `Rpc.notify(toStream, fromStream, events)` gets real adapter implementations (Node: direct in-process call via StreamHost; CF: DO-to-DO via bindings — trust-boundary-consistent with the plan-7 internal patterns).
- Protocol additions (BINDING shapes from doc-02's catalog, Q1 of the survey — executor re-reads the doc, not the survey): new `packages/protocol/src/events/campaign.ts` with all 14 campaign-stream event families (campaign.created/renamed/settings_changed/join_code_rotated/archived; pack.enabled/disabled; member.joined/left/removed/renamed; campaign.character_joined/left; party.overview_updated; session.started/ended; roll.logged; chat.message ≤2 KB; dm.note_added/updated/removed) as versioned strictObject schemas registered in EVENT_PAYLOADS + EVENT_ACTORS; `CampaignSettingsSchema` (the full doc-02 settings document incl. houseRules/visibility/join sub-docs with their exact enums); `ActorRoleSchema` gains `'member'`. EVENT_ACTORS rows follow doc-08's matrix EXACTLY (D-only vs M rows per the doc-02 actor column). Reducers untouched — campaign events never reach `@hk/engine`'s reducer (parseEvent accepts them; the engine's dispatch simply has no handlers, which is fine because campaign streams are never reduced client-side in this plan; VERIFY parseEvent/reduce layering tolerates unknown-to-reducer types without engine changes — if reduce would throw on an unknown type, that's a client-plan concern only since nothing reduces camp: streams; document the finding).
- EVENT_ACTORS RECONCILIATION (settles the plan-7 owner-flag): one task audits the existing character-stream dm-grants against doc-08's character-stream matrix rows read verbatim; entries the matrix supports stay; entries it does not textually support are corrected; genuinely ambiguous ones get an OWNER-FLAG comment + ledger entry (not silently changed). This runs BEFORE DM sockets become reachable.
- Campaign permission semantics (doc-08 verbatim): DM appends settings/packs/session/member-removal families; members append `roll.logged`, `chat.message`, `member.renamed`, own `campaign.character_joined/left`; join-by-code creates membership only when `join.open`; reads filtered per connection (dm.note_* never to non-DM; roll.logged visibility dm → DM + roller; private → roller only; ALL stored regardless).
- Gateway (doc-03 verbatim): campaign sockets may carry `append` frames whose events target `char:` streams → CampaignActor forwards via Rpc to that CharacterStream with the STAMPED actor {userId, role: dm|member-owner-mapping}; the CharacterStream re-checks permissions against its own meta (defense in depth); acks/rejects relayed to the campaign socket. Cross-stream mirror: `campaign.character_joined` accepted only after an RPC read confirms the matching `character.campaign_joined` exists on the char stream (no half-joins). After-commit notify: CharacterActor's Phase-2 no-op hook becomes real — character commits notify the campaign stream (when meta.campaignId set) so campaign sockets receive character events per visibility.
- Blob relay (doc-07 verbatim): in-memory `holders: Map<hash, Set<connId>>` (rebuilt after hibernation via a `notice blob.resend-have` ask when empty); holder priority uploader→DM→any; binary chunk frames parsed by the 16-byte header ONLY (never buffered server-side beyond forwarding); ≤64 KB payloads; one in-flight per requester; two concurrent serves per holder; `blob.unavailable` when no holder. Binary WS frames must traverse BOTH adapters (Node ws binary + CF hibernation ArrayBuffer messages) and the conformance suite proves forwarding.
- Presence: `members` snapshot on connect/close, throttled ≥1 per 5 s per doc-10.
- `bye {reason}` emission lands (plan-8 flag): session-expired (auth middleware detects an invalidated session on a live socket — design the trigger honestly: at minimum, `removed from campaign` on member removal closes that member's sockets with bye; session-expiry bye is emitted where detectable (e.g. on a failed re-verification during reconnect) — document exactly what triggers exist server-side and ledger what can't be detected mid-socket).
- Campaign quotas: 20 MB events / 12 members / 6 non-core packs × 5 MB — enforced in CampaignActor's append path + join route + pack.enabled; per-user create quota decision: doc-08 read for any campaign-count-per-user cap (verify; none known → no invented cap). Maintenance (Task 10 of plan 7) extends to campaign streams' bytes_used sync.
- Routes (same-origin, session-authed, XRW-gated like plan 7): POST /api/campaigns {id, name, system} (DM = creator; writes D1 row + join code + emits campaign.created via the actor); GET /api/campaigns (mine: DM-of + member-of); POST /api/campaigns/join {code} (join.open check → membership row + member.joined event; returns campaign id); POST /api/campaigns/:id/rotate-code (DM); DELETE /api/campaigns/:id/members/:userId (DM → member.removed + bye-close that member's campaign sockets); WS GET /api/campaigns/:id/ws (membership-verified, role stamped dm|member). Join-code format: doc-02/ADR-004 read for shape; else 8-char base32 (unambiguous alphabet), rotate-able, unique in D1 — document the decision.
- Conformance suite extension: campaign scenarios run against BOTH adapters (create/join/member-append-visibility/dm-note filtering/roll-visibility routing/gateway forward+re-check/mirror verification/presence throttle/blob relay forwarding/quota) — assertions in scenarios.ts only, drivers per runner (the pool-workers WS limitation workarounds from plan 7 apply; document honestly which scenarios need runInDurableObject fallbacks).
- Root `pnpm check` remains the gate; no web-code changes in this plan beyond none-expected (any client-visible protocol re-export is fine).

### Design rulings baked into this plan

1. **Membership role mapping**: D1 memberships.role is `'dm'|'player'`; stream actor roles are `'owner'|'dm'|'member'`. Mapping: campaign-socket role = `dm` if memberships.role='dm' else `member`; gateway-forwarded char-stream actor role = `dm` when the sender is the campaign's DM, else `owner` IF the target character's meta.ownerId == sender userId (a member acting on their OWN character through the campaign socket) else REJECT forbidden. Document in permissions code.
2. **Campaign stream ids**: `camp:<uuid>` (already schema-valid). The campaign uuid is client-generated uuidv7 like characters (POST body carries id).
3. **CampaignActor meta**: `{dmId, settings, members, characters, packs}` maintained from committed events (single-writer): member.joined/left/removed → members; campaign.character_joined/left → characters; settings_changed → settings; pack.enabled/disabled → packs (+ the DO packs table for the JSON). D1 rows are the INDEX (routes write campaigns/memberships rows transactionally with the event append — same pattern as character creation; document the dual-write ordering and failure handling: D1 first, event append second, best-effort D1 rollback on append failure — mirror plan-7's create route).
4. **Blob relay scope**: the SERVER side only (holders map, routing, flow control, forwarding). No client transfer code in this plan (plan 10). Conformance drives it with raw sockets.
5. **party.overview_updated** is an ordinary member event (owner's device posts it); the server only enforces actor legitimacy (the member owns that characterId per campaign meta) — content is opaque.
6. **Session grouping/pregens/claiming/campaign export**: pregens+claiming and campaign export are CLIENT-plan scope (owner_transferred already exists protocol-side; export reuses admin/CLI patterns later); session.started/ended events ship here (schema + DM-only permission) with no server behavior beyond storage/fan-out.

## File Structure

```
packages/protocol/src/events/campaign.ts (+ registrations in index/envelope; test)     # T1
apps/api/src/core/db/{schema,queries}.ts + migration 0002                              # T3
apps/api/src/core/routes/campaigns.ts; app.ts wiring                                   # T4
apps/api/src/core/streams/campaign-actor.ts; stream-actor filter impl                  # T5 (perms/filter/presence) + T6 (gateway/mirrors) + T7 (blob relay)
apps/api/src/adapters/node/* (campaign wiring, binary frames)                          # T8
apps/api/src/adapters/cloudflare/campaign-stream.do.ts + worker/wrangler               # T8
apps/api/src/core/maintenance.ts (campaign usage) + bye emission                       # T9
apps/api/test/conformance/* (campaign scenarios)                                       # T10
docs wrap                                                                              # T11
```

---

### Task 1: Campaign event schemas + member role (`@hk/protocol`)
Create events/campaign.ts (14 families per doc-02 verbatim; CampaignSettingsSchema with exact enums; RollLoggedV1 with kind/visibility enums; ChatMessageV1 body ≤2 KB), add `'member'` to ActorRoleSchema, register EVENT_PAYLOADS/EVENT_ACTORS per doc-08. Red-first protocol tests (accept/reject per family; settings enum bounds; actor rows spot-checked against doc-08 quotes). Verify parseEvent dispatch + reducer tolerance layering (document). Commit `feat(protocol): campaign stream events and member role`.

### Task 2: EVENT_ACTORS reconciliation (character-stream dm-grants audit)
Read doc-08's character-stream matrix rows verbatim; correct unsupported dm entries; OWNER-FLAG genuinely ambiguous ones in code + ledger; update the Phase-2 review-pending comment to reflect the audit. Red-first: protocol tests pinning each row to its doc-08 justification (test names cite the matrix row). Commit `fix(protocol): reconcile character event actors with the authorization matrix`.

### Task 3: D1 campaigns/memberships + queries
Additive migration 0002 (doc-02 shapes verbatim); queries (createCampaign, findCampaignByJoinCode, listCampaignsForUser (dm-of + member-of), insertMembership, removeMembership, listMembers, rotateJoinCode, campaign usage helpers). Fold/uniqueness where applicable; join_code UNIQUE. Red-first repo tests over real sqlite. Commit `feat(api): campaign and membership tables`.

### Task 4: Campaign routes + WS handoff
Routes per Global Constraints (create/list/join/rotate/remove-member/WS) with dual-write ordering per ruling 3; join validates join.open + 12-member quota; WS stamps dm|member per ruling 1. Red-first route tests (fakes + real db). Commit `feat(api): campaign routes and socket handoff`.

### Task 5: CampaignActor — permissions, read filtering, presence, meta
CampaignActor extends StreamActor: meta maintenance per ruling 3; member-role permission enforcement (doc-08 rows); REAL filterForConnection (dm.note_* DM-only; roll.logged visibility routing incl. roller-always; everything stored); presence members frames throttled 5 s; subscribe/unsubscribe attachment handling; campaign quota checks (20 MB, pack count/size on pack.enabled). Red-first actor tests (fake store/connections; every filter rule; throttle with fake clock). Commit `feat(api): campaign actor with visibility filtering and presence`.

### Task 6: Gateway + cross-stream mirrors + character notify
Gateway append forwarding via Rpc with stamped actor per ruling 1 + relayed acks/rejects; mirror verification (campaign.character_joined ← RPC read of char stream); CharacterActor after-commit notify → campaign stream (meta.campaignId) fan-out through campaign filtering; DM subscribe-to-member-streams delivery path (subscribe {stream} on the campaign socket → campaign actor relays that char stream's events to the subscriber per doc-03). Red-first with a two-actor harness (real actors, fake stores/Rpc). Commit `feat(api): campaign gateway and cross-stream mirrors`.

### Task 7: Blob relay (server side)
Per doc-07 verbatim (Global Constraints bullet): holders map + have/request/pull/chunk/cancel/unavailable + flow control + 16-byte header parse + hibernation rebuild ask. Red-first with scripted binary frames. Commit `feat(api): campaign blob relay`.

### Task 8: Both adapters
Node: stream-host campaign-actor instantiation (camp: prefix routing), ws binary frame pass-through, maintenance-streams coverage. Cloudflare: campaign-stream.do.ts (hibernation-safe per plan-7 patterns incl. generation guard/getUsage), CAMPAIGN_STREAM binding, wrangler migration, D1 driver reuse; pool-workers smoke tests. Red-first adapter tests incl. a real Node-adapter campaign WS e2e (register 2 users, create, join, roll fan-out with visibility). Commit `feat(api): campaign streams on both adapters`.

### Task 9: bye emission + maintenance extension
bye per Global Constraints (member removal closes sockets with bye; document detectable session-expiry triggers); maintenance syncs campaign bytes_used→D1 + per-user totals untouched (campaign quota is per-stream); usage_daily campaign counters. Red-first. Commit `feat(api): bye frames and campaign maintenance`.

### Task 10: Conformance extension
Campaign scenario set per Global Constraints, both adapters, assertions in scenarios.ts only. STOP on real cross-adapter divergence. Commit `test(api): campaign conformance scenarios`.

### Task 11: Docs wrap
README (Phase 3 server progress), CLAUDE.md if commands changed (none expected), plan STATUS headers, self-hosting doc if campaign-relevant env changed (none expected). Claims source-verified. Commit `docs(repo): campaign server wrap`.

---

## Self-Review

**Spec coverage (Phase-3 row, server half):** host (create/settings/packs/join-code/rotate) T1/T3/T4/T5; join T4; party overview transport T1/T5 (client renders in plan 10); DM effects + Override reach characters via the gateway T6 (+T2's audited permissions); roll log visibility T1/T5; presence T5; image relay server side T7; DM super-peer subscribe path T6 (client prefetch plan 10); session events T1 (grouping UI plan 10); edit-outside-session = settings data shipped T1 (enforcement is client/DM-UX, plan 10 — the server stores the setting; doc-08 assigns no server enforcement — verified against the matrix during T5); campaign export + pregens/claiming = plan 10 (ruling 6). bye flag closed T9; blob relay forwarding conformance (doc-10's list) T10.
**Placeholder scan:** execution-time verifications named with sources (join-code format; per-user campaign cap; session-expiry bye triggers; reducer tolerance of campaign types). No TBDs.
**Type consistency:** CampaignSettingsSchema/RollLoggedV1 (T1) consumed by T5; queries (T3) by T4/T9; ruling-1 role mapping used in T4 (stamp) and T6 (gateway); filterForConnection seam name matches shipped code; Rpc.notify signature matches ports/infra.ts.
**Scope check:** one subsystem (campaign server), independently testable via conformance + the Node campaign e2e; client half deliberately next.
