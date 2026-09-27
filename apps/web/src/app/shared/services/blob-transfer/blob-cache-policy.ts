/**
 * Pure cache-management policy — docs/02-architecture/07-images-and-blobs.md §Cache management:
 * "`pinned` for blobs referenced by own characters and the current campaign; LRU over the rest
 * with a cap ... Eviction never removes pinned blobs; if pinned exceeds the cap the UI explains.
 * Orphans (not referenced by any local stream or pack) are cleaned weekly." No Angular/Dexie
 * import here on purpose — `CacheManagerService` (the Dexie-facing orchestrator) is the only
 * caller, so these two decisions are trivially unit-testable against plain data.
 */

/** The narrow slice of `BlobRow` (`dexie.db.ts`) these functions actually need. */
export interface CacheableBlob {
  readonly hash: string;
  readonly size: number;
  readonly pinned: boolean;
  readonly lastUsedAt: number;
}

/**
 * LRU eviction over UNPINNED rows only, oldest `lastUsedAt` first, until the running total is
 * `<= capBytes` — or every unpinned row is gone, whichever happens first. A pinned row is NEVER a
 * candidate, even if the cap remains exceeded afterward solely because of pinned content (doc-07:
 * "if pinned exceeds the cap the UI explains" — that explanation is `CacheManagerService`'s job,
 * not this function's). Returns the hashes to delete, in eviction order.
 */
export function selectLruEvictions(rows: readonly CacheableBlob[], capBytes: number): string[] {
  let total = rows.reduce((sum, r) => sum + r.size, 0);
  if (total <= capBytes) return [];

  const unpinned = [...rows].filter((r) => !r.pinned).sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const evictions: string[] = [];
  for (const row of unpinned) {
    if (total <= capBytes) break;
    evictions.push(row.hash);
    total -= row.size;
  }
  return evictions;
}

/**
 * A row is an orphan when it is NOT pinned AND its hash is absent from `referencedHashes` — doc-07:
 * "Orphans (not referenced by any local stream or pack) are cleaned weekly." Pinned rows are never
 * orphan-swept, even if unreferenced (pin implies "own/current-campaign", a stronger, more current
 * signal than a reference scan — see `CacheManagerService`'s own doc for exactly what that scan can
 * see in this codebase today).
 */
export function selectOrphans(
  rows: readonly CacheableBlob[],
  referencedHashes: ReadonlySet<string>,
): string[] {
  return rows.filter((r) => !r.pinned && !referencedHashes.has(r.hash)).map((r) => r.hash);
}

/** doc-07: "cleaned weekly" — `true` when the sweep has never run (`lastRunAt === undefined`) or
 * `intervalMs` has elapsed since it last did. A tiny pure gate so `CacheManagerService`'s boot-time
 * decision is unit-testable without faking an async constructor's own clock. */
export function isOrphanSweepDue(
  lastRunAt: number | undefined,
  now: number,
  intervalMs: number,
): boolean {
  if (lastRunAt === undefined) return true;
  return now - lastRunAt >= intervalMs;
}
