/**
 * Internal-only headers `worker.ts` stamps onto the Request it hands to a stream DO's `fetch()`
 * — `character-stream.do.ts`'s header comment has the full trust-boundary argument (a client can
 * never reach a DO's `fetch()` directly; only `worker.ts`, which alone holds the
 * `CHARACTER_STREAM`/`CAMPAIGN_STREAM` bindings, can). Shared here (not declared separately in
 * each DO file) so `CharacterStreamDO` and `CampaignStreamDO` — and `worker.ts`'s
 * `CloudflareWsUpgrade`, which stamps them — all use the exact same names; a per-file copy could
 * silently drift.
 */
export const INTERNAL_STREAM_ID_HEADER = 'X-Hk-Internal-Stream-Id';
export const INTERNAL_USER_ID_HEADER = 'X-Hk-Internal-User-Id';
export const INTERNAL_ROLE_HEADER = 'X-Hk-Internal-Role';
/** [plan-9 Task 8] Carries `WsUpgradeContext.displayName` (`ports/infra.ts`) across the
 * Worker->DO internal request — only ever set by `core/routes/campaigns.ts`'s WS route
 * (`ConnAttachment.displayName`'s doc comment: "unused on a character stream"), so
 * `CharacterStreamDO.fetch()` never reads it. Omitted from the internal request entirely when
 * `ctx.displayName` is `undefined` (the character-stream case), rather than sent as an empty
 * string — `Headers` has no clean way to express "absent" vs "empty" otherwise. */
export const INTERNAL_DISPLAY_NAME_HEADER = 'X-Hk-Internal-Display-Name';
