import type { MembershipRole } from '@hk/protocol';

/** A projected member (`CampaignState.members`'s value shape). */
export interface ProjectedMember {
  readonly displayName: string;
  readonly role: MembershipRole;
  readonly removed: boolean;
}

/** One entry of the live member list (`SyncService.membersFor`). */
export interface LiveMember {
  readonly userId: string;
  readonly displayName: string;
  readonly role?: string;
  readonly online: boolean;
}

export interface MemberPresence {
  readonly userId: string;
  readonly displayName: string;
  readonly role: MembershipRole;
  readonly removed: boolean;
  readonly online: boolean;
}

/**
 * The one derivation of "who is here" shared by the Lobby roster and the Party cards: the projected
 * members, with the live list's display name and online flag preferred where it has the member. A
 * member the live list lacks (or no live list at all) reads as offline; a live entry for someone the
 * projection does not know is ignored.
 */
export function mergeMemberPresence(
  members: ReadonlyMap<string, ProjectedMember>,
  live: readonly LiveMember[] | null,
): MemberPresence[] {
  const liveByUserId = new Map((live ?? []).map((m) => [m.userId, m]));
  const rows: MemberPresence[] = [];
  for (const [userId, entry] of members) {
    const liveEntry = liveByUserId.get(userId);
    rows.push({
      userId,
      displayName: liveEntry?.displayName ?? entry.displayName,
      role: entry.role,
      removed: entry.removed,
      online: liveEntry?.online ?? false,
    });
  }
  return rows;
}
