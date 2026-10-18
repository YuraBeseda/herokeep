import { inject, Injectable } from '@angular/core';
import { reduce } from '@hk/engine';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { SnapshotsRepository } from '@shared/services/storage/snapshots.repository';

/**
 * "Used by N characters" for the pack detail screen: counts the stored characters whose
 * `facts.pins` pin exactly `packId@version`.
 *
 * Source: each Library row's own event log, folded with the engine's `reduce` on top of its cached
 * snapshot — the same `reduce(events, snapshot)` `CharacterStore.loadNow` runs, minus `derive`.
 * The index row (`CharacterRow`) does not carry pins, and the snapshot alone can be behind its
 * log (a `pack.pinned`/`pack.unpinned`/`event.reverted` appended after it), so `reduce` is the
 * cheapest source that is always correct. Pins never depend on `SystemRules`, so none are passed.
 */
@Injectable({ providedIn: 'root' })
export class PackUsageService {
  private readonly charactersRepository = inject(CharactersRepository);
  private readonly eventsRepository = inject(EventsRepository);
  private readonly snapshotsRepository = inject(SnapshotsRepository);

  async countPinning(packId: string, version: string): Promise<number> {
    const rows = await this.charactersRepository.list();
    const pinned = await Promise.all(
      rows.map(async (row) => {
        const [events, snapshot] = await Promise.all([
          this.eventsRepository.byStream(row.id),
          this.snapshotsRepository.get(row.id),
        ]);
        return reduce(events, snapshot).pins[packId] === version;
      }),
    );
    return pinned.filter(Boolean).length;
  }
}
