# Glossary

Project terms, in the sense used throughout these documents. Russian/Ukrainian columns
for *game* terms will be added when translation work starts (Phase 5).

| Term | Meaning |
|------|---------|
| **Stream** | An append-only, sequence-numbered log of events. One per character (`char:<id>`), one per campaign (`camp:<id>`). Canonical copy in a Durable Object; replicas on devices. |
| **Event** | An immutable record in a stream: envelope (`id, stream, seq, ts, actor, type, v, txId?`) + payload. Never edited or deleted. |
| **Pending event** | An event created locally and applied optimistically but not yet acknowledged (no `seq`). |
| **Transaction (`txId`)** | Events that commit and revert together (a level-up). |
| **Reducer** | Pure function `fold(events) → Facts`; total and tolerant (invalid events are recorded as skipped). |
| **Facts** | The raw character state produced by the reducer: decisions, levels, XP, HP, slots, inventory, conditions, notes… No derived numbers. |
| **Derive** | Pure function `(Facts, ContentIndex) → Sheet`. |
| **Sheet** | The complete computed character: every number with provenance, outstanding choices, issues, actions, spellcasting blocks. |
| **Provenance / contribution** | The list of sources (entity + feature + amount) that produced a derived number. |
| **Snapshot** | Cached `{seq, facts}`; an optimization, never the truth. |
| **Replica** | A device's local copy of a stream (committed + pending events + snapshot) in IndexedDB. |
| **Context** | What a socket is for: *solo* (one character stream) or *campaign* (campaign stream + member characters). |
| **Gateway** | The `CampaignStream` DO acting as the single socket endpoint for campaign members, forwarding character events to `CharacterStream` DOs. |
| **Durable Object (DO)** | Cloudflare's single-instance, addressable object with its own SQLite storage and WebSocket support. |
| **Pack** | A JSON content bundle: `core` (defines a system), `content`, `translation`, or `theme`. Semver-versioned, namespaced entity ids. |
| **Core pack** | A pack containing a `system` entity; e.g. `srd-5e-2024`. |
| **System** | A ruleset described as data: abilities, skills, composition slots, tables, rest rules. `5e-2024` now, `5e-2014` later. |
| **Composition slot** | What a character is made of per system (species ×1, background ×1, classes ×N…). |
| **Entity** | A unit of content with a namespaced id (`srd-5e-2024:spell/fireball`) and a type. |
| **Effect** | A typed, declarative modification applied while its granting feature is active (`ability.bonus`, `ac.formula`…). |
| **Predicate** | A declarative condition (`{ability: {str: {gte: 13}}}`) used for prerequisites and conditional effects. |
| **Formula** | A string in the engine's tiny arithmetic grammar (`10 + mod(dex) + mod(con)`), parsed, never evaluated as code. |
| **Grant** | A feature conferred by an entity (possibly conditionally). |
| **Choice** | A decision point declared by content (`fighter@1/fighting-style`); answered by a `decision.made` event. |
| **Decision** | The recorded answer to a choice. |
| **Pin** | The exact pack version a character uses (`pack.pinned` event). |
| **Rebase** | Re-deriving a character against newer pack versions with a report of what changed or broke, then committing new pins and fix-ups. |
| **Override** | A DM (or solo owner) edit that bypasses mechanics (`override.applied`), always audited and shown distinctly. |
| **House rules** | Per-campaign settings that alter validation strictness, leveling mode, encumbrance, etc. |
| **Blob** | An image stored by content hash (`sha256:…`) on devices only. |
| **Holder** | A connected device that has a blob and can serve it through the gateway. |
| **Super-peer** | The DM's device, which automatically caches every blob announced in the campaign. |
| **Placeholder** | The bundled icon or monogram shown when a blob is unavailable. |
| **Bundle** | An export file: `.hero` (character), `.campaign`, `.hkpack` (pack with assets). |
| **Localizer** | Engine service resolving content text per locale with per-field fallback to English. |
| **Grammatical gender** | A character text setting (masculine/feminine/neuter) used by ICU `select` in RU/UK sentences. |
| **Recovery code** | One-time codes issued at registration; the password-reset mechanism (no email). |
| **Verifier** | The PBKDF2-derived value the browser sends instead of the password. |
| **Quota** | Size/count limits per user, stream, campaign, pack, message. |
| **Session (game)** | A period between `session.started`/`session.ended` events, used to group logs and timelines. |
| **Session (auth)** | A login on a device (cookie). |
| **Pregen** | A character created by the DM for players to claim. |
| **Claim** | Transfer of a pregen's ownership to a player (`character.owner_transferred`). |
| **Runtime port** | An interface the backend core depends on (`StreamHost`, `StreamStore`, `Connections`, `Db`, `RateLimit`, `Scheduler`, `Config`, `StaticAssets`, `Rpc`) with one implementation per deployment target (ADR-014). |
| **Adapter** | A set of runtime-port implementations for one target: *Cloudflare* (Workers + Durable Objects + D1) or *Node* (single process, `ws`, SQLite files). |
| **StreamActor** | The runtime-agnostic class holding all stream semantics (append pipeline, catch-up, fan-out); adapters instantiate it with their ports. |
| **Conformance suite** | The same backend tests run against both adapters in CI. |
| **Ability generation** | The system-defined methods for creation-time ability scores: standard array, point buy, manual, roll (4d6 drop lowest). |
