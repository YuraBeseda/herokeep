import { inject, Injectable } from '@angular/core';
import { reduce, type Pins } from '@hk/engine';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { SnapshotsRepository } from '@shared/services/storage/snapshots.repository';

/** One stored character and the packs it pins (the packs screens' "used by" lists). */
export interface HeroPins {
  readonly id: string;
  readonly name: string;
  readonly system: string;
  readonly portraitThumbHash?: string;
  readonly pins: Pins;
}

/**
 * "Used by N heroes" for the packs screens: counts the stored characters whose `facts.pins` pin
 * exactly `packId@version`.
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
    const pinSets = await this.pinSets();
    return pinSets.filter((pins) => pins[packId] === version).length;
  }

  /** Every stored character's `facts.pins`, in Library order (the list's "Update available"). */
  async pinSets(): Promise<Pins[]> {
    return (await this.heroPins()).map((hero) => hero.pins);
  }

  /** Every stored character with its pins, in Library order: one `byStream` + one snapshot read
   * and one `reduce` per character; nothing is derived. */
  async heroPins(): Promise<HeroPins[]> {
    const rows = await this.charactersRepository.list();
    return Promise.all(
      rows.map(async (row) => {
        const [events, snapshot] = await Promise.all([
          this.eventsRepository.byStream(row.id),
          this.snapshotsRepository.get(row.id),
        ]);
        return {
          id: row.id,
          name: row.name,
          system: row.system,
          ...(row.portraitThumbHash ? { portraitThumbHash: row.portraitThumbHash } : {}),
          pins: reduce(events, snapshot).pins,
        };
      }),
    );
  }
}
