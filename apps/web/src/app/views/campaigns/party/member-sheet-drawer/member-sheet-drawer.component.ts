import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  type ElementRef,
  type OnInit,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { DEATH_SAVE_MAX, type ContentIndex, type Localizer, type Sheet } from '@hk/engine';
import { makeEntityId, parseEntityId } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { filter } from 'rxjs';
import { ForeignCharacterSession } from '@shared/services/campaigns/foreign-character-session';
import type { HpSnapshot } from '@shared/services/campaigns/dm-effects';
import { provideEngineScope } from '@shared/services/engine/engine-scope.providers';
import { EngineFacade, type EngineScope } from '@shared/services/engine/engine.facade';
import { BlobTransferService } from '@shared/services/blob-transfer/blob-transfer.service';
import { customIconBlobHashes } from '@shared/services/images/custom-icons';
import { EventsRepository } from '@shared/services/storage/events.repository';
import { SyncService } from '@shared/services/sync/sync.service';
import { PackStore } from '@shared/stores/pack.store';
import { HkAbilitySealComponent } from '../../../../ui/ability-seal/ability-seal.component';
import { HkConditionChipComponent } from '../../../../ui/condition-chip/condition-chip.component';
import { HkDrawerComponent } from '../../../../ui/drawer/drawer.component';
import { HkPoolBarComponent } from '../../../../ui/pool-bar/pool-bar.component';
import { HkStatTileComponent } from '../../../../ui/stat-tile/stat-tile.component';
import { HkTagChipComponent } from '../../../../ui/tag-chip/tag-chip.component';
import { QuickEffectsLeafComponent } from '../quick-effects-leaf/quick-effects-leaf.component';

const ABILITY_ORDER = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

type AbilityBlock = Sheet['abilities'][string];
type SpellcastingBlock = Sheet['spellcasting'][number];

interface AbilityRow {
  readonly id: string;
  readonly label: string;
  readonly score: number;
  readonly mod: number;
  readonly save: number;
  readonly saveProficient: boolean;
}

interface SkillRow {
  readonly id: string;
  readonly label: string;
  readonly total: number;
}

interface SpellRow {
  readonly id: string;
  readonly name: string;
  readonly level: number;
}

/**
 * `MemberSheetDrawerComponent` (board C08, plan 17 B11b; it replaces the member-sheet dialog): the
 * DM party-sheet drill-in as a side drawer (`hk-drawer`). The party tab renders it while a member's
 * sheet is open and only for an authorized viewer (DM + `partySheets: 'full'`: that gate lives
 * entirely in the OPENER; this component trusts it), and removes it on `closed`.
 *
 * ## Read-only rendering
 *
 * It draws the subscribed member's derived `Sheet` with presentational atoms only (stat tiles,
 * ability seals, pool bars, condition chips). Nothing here mutates: there is no `propose.*` or
 * `appendTx` call in this file, so a DM cannot change a character they don't own from the sheet
 * itself. The DM tools at the foot are the quick-effects leaf, which writes only through the
 * campaign gateway.
 *
 * ## Viewer session lifecycle
 *
 * It owns one `ForeignCharacterSession` for exactly as long as it exists: `start()` on init,
 * `close()` on destroy (every close path: the drawer's Close button, Escape, a press outside, and
 * the party tab removing it). `hk-drawer` closes itself on a router `NavigationStart`; this also
 * closes on a `NavigationEnd` that leaves the campaign's `/g/<campaignId>` prefix, since the
 * session must never outlive the campaign.
 *
 * ## The member's pack set (plan 16 Task 5, design ruling 6)
 *
 * The session derives with the member's own pins, and this drawer is the `EngineScope` of a
 * component-level `EngineFacade` (`provideEngineScope`) whose pins are the derived sheet's. Every
 * name drawn here, and every name the embedded leaf resolves, comes from the member's index. A
 * `'warning'` status draws the sheet with the member's packs this device lacks listed above it;
 * their references show as raw ids, as on the member's own device.
 */
@Component({
  selector: 'app-member-sheet-drawer',
  imports: [
    TranslocoDirective,
    HkAbilitySealComponent,
    HkConditionChipComponent,
    HkDrawerComponent,
    HkPoolBarComponent,
    HkStatTileComponent,
    HkTagChipComponent,
    QuickEffectsLeafComponent,
  ],
  providers: [provideTranslocoScope('campaigns'), provideEngineScope(MemberSheetDrawerComponent)],
  templateUrl: './member-sheet-drawer.component.html',
  styleUrl: './member-sheet-drawer.component.scss',
})
export class MemberSheetDrawerComponent implements EngineScope, OnInit {
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly syncService = inject(SyncService);
  private readonly packStore = inject(PackStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly eventsRepository = inject(EventsRepository);
  private readonly blobTransferService = inject(BlobTransferService);

  /** Bare campaign uuid (no `camp:` prefix). */
  readonly campaignId = input.required<string>();
  /** Bare character uuid (no `char:` prefix). */
  readonly characterId = input.required<string>();
  /** Pre-resolved by the party card (`state.roster`) so the drawer never needs its own
   * name-resolving read before a `Sheet` exists. */
  readonly name = input.required<string>();
  /** The control that opened the drawer: focus returns to it. */
  readonly opener = input<ElementRef<HTMLElement> | HTMLElement | null>(null);

  readonly closed = output<void>();

  protected readonly open = signal(true);
  private readonly session = signal<ForeignCharacterSession | null>(null);

  protected readonly status = computed(() => this.session()?.status() ?? 'loading');
  protected readonly sheet = computed(() => this.session()?.sheet());
  protected readonly missingPins = computed(() => this.session()?.missingPins() ?? []);
  protected readonly maxDeathSaves = DEATH_SAVE_MAX;

  /** `EngineScope`: the pins the shown sheet derives with (core-only until a sheet exists). */
  readonly pins = computed(() => this.sheet()?.pins);

  protected readonly levelClassLine = computed(() => {
    const sheet = this.sheet();
    if (!sheet || sheet.classes.length === 0) return '';
    return sheet.classes.map((c) => `${this.resolveName(c.classId)} ${c.level}`).join(' · ');
  });

  protected readonly abilityRows = computed<AbilityRow[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    return ABILITY_ORDER.filter((id) => id in sheet.abilities).map((id) => {
      const block: AbilityBlock = sheet.abilities[id];
      return {
        id,
        label: this.abilityName(id, index, localizer),
        score: block.score.value,
        mod: block.mod,
        save: block.save.value,
        saveProficient: block.saveProficient,
      };
    });
  });

  protected readonly skillRows = computed<SkillRow[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    const index = this.engineFacade.index();
    const localizer = this.engineFacade.localizer();
    return Object.entries(sheet.skills)
      .map(([id, block]) => ({
        id,
        label: this.skillName(id, index, localizer),
        total: block.total.value,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  protected readonly speedRows = computed<{ mode: string; value: number }[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    return Object.entries(sheet.speed).map(([mode, value]) => ({ mode, value: value.value }));
  });

  protected readonly conditions = computed<{ id: string; name: string; level?: number }[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    return sheet.conditions.map((c) => ({
      id: c.conditionId,
      name: this.resolveName(c.conditionId),
      level: c.level,
    }));
  });

  /** The leaf's HP baseline. The live subscribed `Sheet` has `hp.currentWasMax` (unlike the party
   * card's 'overview' mode), so damage/heal composed here resolves the long-rest sentinel first
   * when needed (`dm-effects.ts`). `undefined` until a sheet exists. */
  protected readonly hpSnapshot = computed<HpSnapshot | undefined>(() => {
    const sheet = this.sheet();
    if (!sheet) return undefined;
    return {
      current: sheet.hp.current,
      max: sheet.hp.max.value,
      temp: sheet.hp.temp,
      currentWasMax: sheet.hp.currentWasMax,
    };
  });

  protected readonly conditionIds = computed<readonly string[]>(
    () => this.sheet()?.conditions.map((c) => c.conditionId) ?? [],
  );

  protected readonly hpWidth = computed(() => {
    const sheet = this.sheet();
    if (!sheet) return 0;
    return percent(sheet.hp.current, sheet.hp.max.value + sheet.hp.temp);
  });
  protected readonly tempWidth = computed(() => {
    const sheet = this.sheet();
    if (!sheet) return 0;
    return Math.min(
      100 - this.hpWidth(),
      percent(sheet.hp.temp, sheet.hp.max.value + sheet.hp.temp),
    );
  });

  protected readonly spellBlocks = computed<
    (SpellcastingBlock & { knownSpells: SpellRow[]; preparedSpells: SpellRow[] })[]
  >(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    return sheet.spellcasting.map((block) => ({
      ...block,
      knownSpells: block.known.map((id) => this.spellRow(id)),
      preparedSpells: block.prepared.map((id) => this.spellRow(id)),
    }));
  });

  protected readonly resources = computed(() => this.sheet()?.resources ?? []);

  protected readonly inventoryRows = computed<{ name: string; qty: number }[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    return sheet.inventory.map((row) => ({ name: this.itemName(row), qty: row.qty }));
  });

  constructor() {
    // The drawer closing itself (Close, Escape, a press outside, a navigation) reports once.
    effect(() => {
      if (!this.open()) untracked(() => this.closed.emit());
    });
    // The member's custom item icons are blobs only the relay can fetch.
    effect(() => {
      const hashes = customIconBlobHashes(this.sheet()?.inventory);
      if (hashes.length > 0) {
        untracked(() => void this.blobTransferService.requestHashes(this.campaignId(), hashes));
      }
    });
  }

  ngOnInit(): void {
    const session = new ForeignCharacterSession({
      campaignId: this.campaignId(),
      characterId: this.characterId(),
      sync: this.syncService,
      packStore: { corePack: () => this.packStore.corePack(), packs: () => this.packStore.packs() },
      engineFacade: { indexFor: (pins) => this.engineFacade.indexFor(pins) },
      // Task 12, ruling 1 ("DM drill-in should reflect the same house rules"): the session reads the
      // SAME campaign's settings document through the narrow `byStream` port it expects.
      campaignEvents: { byStream: (streamId) => this.eventsRepository.byStream(streamId) },
    });
    session.start();
    this.session.set(session);

    const prefix = `/g/${this.campaignId()}`;
    const routerSub = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => {
        const url = this.router.url;
        if (url !== prefix && !url.startsWith(`${prefix}/`)) this.open.set(false);
      });

    this.destroyRef.onDestroy(() => {
      routerSub.unsubscribe();
      session.close();
    });
  }

  protected resolveName(id: string): string {
    const index = this.engineFacade.index();
    return index.has(id) ? this.engineFacade.localizer().name(id) : id;
  }

  // `ResourceView.name` (`derive/resources.ts`) is a baked-at-build-time ENGLISH string, never
  // routed through the Localizer: resolve through the index via `.source`, fall back to the raw
  // baked value (i18n is structural, CLAUDE.md rule 2).
  protected resourceLabel(view: Sheet['resources'][number]): string {
    const index = this.engineFacade.index();
    return index.has(view.source) ? this.engineFacade.localizer().name(view.source) : view.name;
  }

  private abilityName(key: string, index: ContentIndex, localizer: Localizer): string {
    const entity = index
      .byType('ability')
      .find((e) => e.type === 'ability' && e.abbreviation === key);
    return entity ? localizer.name(entity.id) : key.toUpperCase();
  }

  private skillName(slug: string, index: ContentIndex, localizer: Localizer): string {
    const packId = parseEntityId(index.system().id)?.packId;
    const skillId = packId ? makeEntityId(packId, 'skill', slug) : undefined;
    return skillId && index.has(skillId) ? localizer.name(skillId) : slug;
  }

  private spellRow(id: string): SpellRow {
    const entity = this.engineFacade.index().get(id);
    const spell = entity?.type === 'spell' ? entity : undefined;
    return { id, name: this.resolveName(id), level: spell?.level ?? 0 };
  }

  private itemName(entry: Sheet['inventory'][number]): string {
    return entry.itemId ? this.resolveName(entry.itemId) : (entry.name ?? entry.instanceId);
  }
}

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}
