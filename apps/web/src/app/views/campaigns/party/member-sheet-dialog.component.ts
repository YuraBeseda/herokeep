import { Component, DestroyRef, computed, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { DEATH_SAVE_MAX, type ContentIndex, type Localizer, type Sheet } from '@hk/engine';
import { makeEntityId, parseEntityId } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { filter } from 'rxjs';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { ChipComponent } from '@shared/components/chip/chip.component';
import { DIALOG_DATA, DialogRef } from '@shared/components/dialog/dialog.service';
import { HpBarComponent } from '@shared/components/hp-bar/hp-bar.component';
import { PipsComponent } from '@shared/components/pips/pips.component';
import { SheetSectionComponent } from '@shared/components/sheet-section/sheet-section.component';
import { StatTileComponent } from '@shared/components/stat-tile/stat-tile.component';
import { ForeignCharacterSession } from '@shared/services/campaigns/foreign-character-session';
import type { HpSnapshot } from '@shared/services/campaigns/dm-effects';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { SyncService } from '@shared/services/sync/sync.service';
import { PackStore } from '@shared/stores/pack.store';
import { DmEffectsPanelComponent } from './dm-effects-panel.component';

export interface MemberSheetDialogData {
  /** Bare campaign uuid (no `camp:` prefix). */
  readonly campaignId: string;
  /** Bare character uuid (no `char:` prefix). */
  readonly characterId: string;
  /** Pre-resolved (the party card already has it — `state.roster`) so this dialog never needs its
   * own name-resolving read before a `Sheet` exists. */
  readonly name: string;
}

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
 * `MemberSheetDialogComponent` — plan-10 task-9-brief.md: the DM party-sheet drill-in. Opened by
 * `PartyTabComponent` via `DialogService.open()` (DM + `partySheets: 'full'` only — that gate lives
 * entirely in the OPENER; this component trusts it was only ever opened for an authorized viewer,
 * same "the caller already checked" posture every other play-tab dialog has toward its own opener).
 *
 * ## Read-only rendering (task-9-brief.md's binding instruction)
 *
 * Renders via the SAME presentational atoms the character's own play tab uses
 * (`hk-hp-bar`/`hk-stat-tile`/`hk-chip`/`hk-card`/`hk-sheet-section`/`hk-pips`) — reused through
 * their existing `@Input()`s, never a forked copy of `play-tab.component.html`'s own markup. Only
 * `hk-pips` needed a refactor at all (this task added its own `readonly` input, `pips.component.ts`)
 * — every other atom here was already purely presentational with no mutating affordance to disable.
 * No `propose.*`/`appendTx` call exists anywhere in this file: there is nothing here for a DM to
 * accidentally mutate on a character they don't own.
 *
 * ## Viewer session lifecycle
 *
 * Owns one `ForeignCharacterSession` (this task's own new module) for exactly as long as this
 * dialog is open: `start()` in the constructor, `close()` from BOTH `DestroyRef.onDestroy` (covers
 * every ordinary dialog-close path — the Close button, ESC, backdrop click) AND a `Router.events`
 * subscription that self-closes the dialog the moment navigation leaves this campaign's own
 * `/g/<campaignId>` prefix (covers the brief's OTHER teardown trigger — "campaign navigation away"
 * — since `DialogService`'s CDK overlay is not itself torn down by routing; nothing else in this
 * codebase does that for any dialog today, so this dialog handles it itself rather than depending on
 * a mechanism that doesn't exist).
 *
 * ## T11 effects panel
 *
 * `DmEffectsPanelComponent` mounts here (this task's own doc previously only reserved the seam;
 * plan-10 Task 11 now fills it), reading `data.characterId` directly and the live `sheet()`'s HP/
 * conditions as its own `hp`/`activeConditionIds` inputs — unlike the party card's 'overview' mode
 * (only `PartyOverview.hp/hpMax/temp`, no `currentWasMax`), THIS mode has the full subscribed
 * `Sheet`, so `hpSnapshot` below also supplies `currentWasMax` (`dm-effects.ts`'s own sentinel-
 * resolution finding). The panel writes via `CampaignStore.gatewayAppend` directly (injected by
 * itself, not through this dialog) — the existing doc-03 gateway-forwarding path, unaffected by
 * this dialog's own read-only `ForeignCharacterSession` viewer.
 */
@Component({
  selector: 'app-member-sheet-dialog',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    CardComponent,
    ChipComponent,
    DmEffectsPanelComponent,
    HpBarComponent,
    PipsComponent,
    SheetSectionComponent,
    StatTileComponent,
  ],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './member-sheet-dialog.component.html',
  styleUrl: './member-sheet-dialog.component.scss',
})
export class MemberSheetDialogComponent {
  protected readonly data = inject<MemberSheetDialogData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly syncService = inject(SyncService);
  private readonly packStore = inject(PackStore);
  private readonly engineFacade = inject(EngineFacade);

  private readonly session = new ForeignCharacterSession({
    campaignId: this.data.campaignId,
    characterId: this.data.characterId,
    sync: this.syncService,
    packStore: { corePack: () => this.packStore.corePack() },
    engineFacade: { index: () => this.engineFacade.index() },
  });

  protected readonly status = this.session.status;
  protected readonly sheet = this.session.sheet;
  protected readonly maxDeathSaves = DEATH_SAVE_MAX;

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

  /** [plan-10 Task 11] `DmEffectsPanelComponent`'s HP baseline — the live subscribed `Sheet`'s own
   * `hp.currentWasMax` flag is available here (unlike the party card's 'overview' mode), so damage/
   * heal composed through this mount correctly resolves the long-rest sentinel first when needed
   * (`dm-effects.ts`'s own finding). `undefined` while the sheet hasn't loaded yet (`'loading'`/
   * `'unauthorized'`/`'error'` status) — the panel renders its own "no baseline" hint then. */
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
    this.session.start();

    const prefix = `/g/${this.data.campaignId}`;
    const routerSub = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => {
        const url = this.router.url;
        if (url !== prefix && !url.startsWith(`${prefix}/`)) {
          this.dialogRef.close();
        }
      });

    this.destroyRef.onDestroy(() => {
      routerSub.unsubscribe();
      this.session.close();
    });
  }

  protected close(): void {
    this.dialogRef.close();
  }

  protected resolveName(id: string): string {
    const index = this.engineFacade.index();
    return index.has(id) ? this.engineFacade.localizer().name(id) : id;
  }

  // `ResourceView.name` (`derive/resources.ts`) is a baked-at-build-time ENGLISH string, never
  // routed through the Localizer — same "resolve through the index via .source, fall back to the
  // raw baked value" convention `play-tab.component.ts`'s own `resourceLabel` documents (i18n is
  // structural, CLAUDE.md rule 2 — this file must not render that raw baked string directly).
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
