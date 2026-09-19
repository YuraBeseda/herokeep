/** Core's public surface for adapters (task-6-brief: "`index.ts` of core exports it [createApp]
 * plus the actors for adapters"). Node's `stream-host.ts` and Cloudflare's
 * `character-stream.do.ts` (Tasks 7/8) instantiate `CharacterActor` directly against their own
 * `StreamStore`/`Connections` implementations; `server.ts`/`worker.ts` call `createApp`. */
export { createApp, type AppPorts } from './app.ts';
export { StreamActor, type StreamActorDeps, type AppendOutcome, type ConnAttachment } from './streams/stream-actor.ts';
export { CharacterActor, type CharacterMeta } from './streams/character-actor.ts';
