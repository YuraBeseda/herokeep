/**
 * `SyncBroadcast` — the leader→follower "poke" (docs/superpowers/plans/2026-09-19-phase-2-client-
 * sync.md, design ruling 4). Only the leader tab (`LeaderService.isLeader`) runs a
 * `StreamSyncSession` and its socket; every other open tab on this device shares the SAME Dexie
 * database (`HkDb`) but has no live connection. One `BroadcastChannel` per stream
 * (`hk:events:<streamId>`) lets the leader wake follower tabs after it applies server-committed
 * events for that stream.
 *
 * The message carries NO payload on purpose — ruling 4's own text: "followers RE-READ from Dexie
 * on message rather than trusting payloads ... the message is a poke, the data comes from the
 * shared DB; simpler and unfakeable". Dexie is already the cross-tab source of truth (a native
 * platform guarantee); trusting a `postMessage` payload would add a second, weaker one a
 * buggy/malicious extension could spoof for no actual benefit (the real data is one `byStream`
 * read away regardless).
 *
 * `BroadcastChannel` is absent from a handful of embedded WebViews (no evergreen desktop/mobile
 * browser Herokeep targets lacks it) — when the global is missing or construction throws,
 * `publish`/`subscribe` degrade to silent no-ops, the same "single tab still works" contract
 * `LeaderService` uses for a missing Web Locks API.
 */

export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type BroadcastChannelFactory = new (name: string) => BroadcastChannelLike;

const CHANNEL_PREFIX = 'hk:events:';

export function broadcastChannelName(streamId: string): string {
  return `${CHANNEL_PREFIX}${streamId}`;
}

export class SyncBroadcast {
  private readonly channel: BroadcastChannelLike | undefined;

  constructor(
    private readonly streamId: string,
    factory: BroadcastChannelFactory | undefined = globalThis.BroadcastChannel as
      BroadcastChannelFactory | undefined,
  ) {
    try {
      this.channel = factory ? new factory(broadcastChannelName(streamId)) : undefined;
    } catch {
      this.channel = undefined;
    }
  }

  /** Leader: wakes every follower tab watching this stream. Carries no payload — see class doc.
   * Safe to call even when the channel is unavailable (a no-op). */
  publish(): void {
    try {
      this.channel?.postMessage('poke');
    } catch {
      // Degrade open — see class doc.
    }
  }

  /** Follower: `onWake` fires (with no data — re-read Dexie yourself) whenever the leader tab
   * applies new committed events for this stream. Returns an unsubscribe function that also
   * closes this instance's own channel handle — callers own one `SyncBroadcast` per subscription,
   * never share instances across an unrelated subscribe/publish pair. A missing `BroadcastChannel`
   * global makes this a no-op subscription (degrade open). */
  subscribe(onWake: () => void): () => void {
    if (!this.channel) return () => undefined;
    const channel = this.channel;
    channel.onmessage = () => onWake();
    return () => {
      channel.onmessage = null;
      channel.close();
    };
  }

  /** Closes this instance's channel handle without going through `subscribe`'s returned
   * unsubscribe — used by a publisher (which never subscribes) once it's done publishing. */
  close(): void {
    this.channel?.close();
  }
}
