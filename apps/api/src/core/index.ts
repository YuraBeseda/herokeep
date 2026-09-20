/** Core's public surface for adapters (task-6-brief: "`index.ts` of core exports it [createApp]
 * plus the actors for adapters"). Node's `stream-host.ts` and Cloudflare's
 * `character-stream.do.ts` (Tasks 7/8) instantiate `CharacterActor` directly against their own
 * `StreamStore`/`Connections` implementations; `server.ts`/`worker.ts` call `createApp`. */
export { createApp, type AppPorts } from './app.ts';
export {
  StreamActor,
  NO_OP_RPC,
  type StreamActorDeps,
  type AppendOutcome,
  type ConnAttachment,
} from './streams/stream-actor.ts';
export { CharacterActor, type CharacterMeta } from './streams/character-actor.ts';
// [plan-9 Task 8] `CampaignActor` (Phase 3, plan-9 Task 5) — added to this adapter-facing surface
// now that Node's `stream-host.ts` and Cloudflare's `campaign-stream.do.ts` actually construct it
// (this file's own header comment: "core's public surface for adapters").
export { CampaignActor, campaignQuotas, type CampaignActorDeps, type CampaignMeta } from './streams/campaign-actor.ts';
