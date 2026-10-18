import { Component, computed, inject, input, signal } from '@angular/core';
import {
  planRebase,
  propose,
  selectPackVersions,
  type ContentIndex,
  type Diagnostic,
  type Pins,
} from '@hk/engine';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DialogService } from '@shared/components/dialog/dialog.service';
import {
  RebaseReportDialogComponent,
  type RebaseReportDialogData,
} from '@shared/components/rebase-report-dialog/rebase-report-dialog.component';
import { SheetSectionComponent } from '@shared/components/sheet-section/sheet-section.component';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { updatesFor, type PackUpdate } from '@shared/services/packs/pack-updates';
import { CharacterStore } from '@shared/stores/character.store';
import { PackStore } from '@shared/stores/pack.store';

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

export interface PackRow {
  readonly id: string;
  /** The installed version this row pins when turned on (or the pinned version, if not installed). */
  readonly version: string;
  /** Pack-authored display name (data, not UI text); the id when the pack is not installed. */
  readonly name: string;
  readonly core: boolean;
  readonly installed: boolean;
  /** The character pins this pack id (at any version). */
  readonly enabled: boolean;
  /** The pinned version, when it differs from `version` (that exact version is not installed). */
  readonly pinnedVersion?: string;
  /** A newer version this character can move to (`updatesFor`). */
  readonly update?: PackUpdate;
}

/** Errors that stopped the last change, and which change it was (picks the heading). */
interface Blocked {
  readonly change: 'disable' | 'update';
  readonly diagnostics: readonly Diagnostic[];
}

const diagnosticKey = (d: Diagnostic): string => `${d.code}\u0000${d.message}`;

/** The error diagnostics of `next` that `current` does not already have. */
function introducedErrors(current: ContentIndex, next: ContentIndex): Diagnostic[] {
  const before = new Set(current.diagnostics.map(diagnosticKey));
  return next.diagnostics.filter((d) => d.severity === 'error' && !before.has(diagnosticKey(d)));
}

/**
 * Plan 15 Task 4 — the Build tab's "Content packs" section: which packs this character uses
 * (doc-04 §Versioning: characters pin exact pack versions).
 *
 * One row per installed content pack id (the pinned version when that one is installed, else the
 * highest installed), plus a row for every pinned pack that is NOT installed here, so it can still
 * be dropped. The core row is always on; its toggle is disabled with a described reason.
 *
 * - ON drafts `propose.pinPack` and appends it as one transaction.
 * - OFF plans the unpin with `planRebase(facts, current index, next index, nextPins, rules)` and
 *   opens the rebase report; Confirm appends `plan.events` as ONE transaction, Cancel appends
 *   nothing. When the next index has errors the current one does not (an unresolved dependency),
 *   the diagnostics are shown instead of a plan.
 * - Update (plan 15 Task 5): a row whose pinned version has a newer installed one (`updatesFor`)
 *   shows "Update available" and an Update button. The plan moves that one pin
 *   (`planRebase(facts, current, indexFor(nextPins), nextPins, rules)`) and the same report opens;
 *   Confirm appends `plan.events` as ONE transaction, Cancel nothing. The core update (plan ruling
 *   6) is validation-only: the current index already resolves the shipped core (the old one is not
 *   on this device), so the plan's only sheet change is the pin itself and the report says so.
 */
@Component({
  selector: 'app-build-packs-section',
  imports: [TranslocoDirective, ButtonComponent, SheetSectionComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './build-packs-section.component.html',
  styleUrl: './build-packs-section.component.scss',
})
export class BuildPacksSectionComponent {
  private readonly characterStore = inject(CharacterStore);
  private readonly packStore = inject(PackStore);
  private readonly engineFacade = inject(EngineFacade);
  private readonly dialogService = inject(DialogService);

  // Inputs
  /** The campaign edit lock (`BuildTabComponent.editLocked`): every toggle is disabled. */
  readonly disabled = input(false);

  protected readonly coreReasonId = 'build-packs-core-reason';
  protected readonly busy = signal(false);
  /** Errors that blocked the last OFF toggle or Update (shown instead of a rebase report). */
  protected readonly blocked = signal<Blocked | undefined>(undefined);

  /** Available updates by pack id, for the character's pins. */
  private readonly updates = computed<ReadonlyMap<string, PackUpdate>>(() => {
    const pins = this.characterStore.facts()?.pins ?? {};
    const packs = this.packStore.packs();
    const core = packs.find((p) => p.kind === 'core');
    if (!core) return new Map();
    return new Map(updatesFor(pins, packs, core).map((u) => [u.packId, u]));
  });

  protected readonly rows = computed<PackRow[]>(() => {
    const pins = this.characterStore.facts()?.pins ?? {};
    const packs = this.packStore.packs();
    const rows: PackRow[] = [];

    const core = packs.find((p) => p.kind === 'core');
    if (core) {
      rows.push({
        id: core.id,
        version: core.version,
        name: core.name,
        core: true,
        installed: true,
        enabled: true,
      });
    }

    const content = packs.filter((p) => p.kind === 'content');
    const exact = (id: string) => content.find((p) => p.id === id && p.version === pins[id]);
    const { selected: highest } = selectPackVersions(content);
    const ids = [...new Set(content.map((p) => p.id))].sort();
    for (const id of ids) {
      const pack = exact(id) ?? highest.get(id)!;
      const pinned = pins[id];
      rows.push({
        id,
        version: pack.version,
        name: pack.name,
        core: false,
        installed: true,
        enabled: pinned !== undefined,
        ...(pinned !== undefined && pinned !== pack.version ? { pinnedVersion: pinned } : {}),
      });
    }

    for (const id of Object.keys(pins).sort()) {
      if (id === core?.id || ids.includes(id)) continue;
      rows.push({
        id,
        version: pins[id],
        name: id,
        core: false,
        installed: false,
        enabled: true,
      });
    }
    const updates = this.updates();
    return rows.map((row) => {
      const update = updates.get(row.id);
      return update ? { ...row, update } : row;
    });
  });

  protected async onToggle(row: PackRow, event: Event, t: TranslateFn): Promise<void> {
    // Keep the control on the MODEL's value: it only moves once a commit lands (and stays put on
    // Cancel or a refusal), instead of drifting from what the character actually pins.
    const control = event.target as HTMLInputElement;
    control.checked = row.enabled;
    if (row.core || this.disabled() || this.busy()) return;

    this.blocked.set(undefined);
    this.busy.set(true);
    try {
      if (row.enabled) await this.disable(row, t);
      else await this.enable(row);
    } finally {
      this.busy.set(false);
    }
  }

  protected async onUpdate(row: PackRow, t: TranslateFn): Promise<void> {
    const update = row.update;
    if (!update || this.disabled() || this.busy()) return;

    this.blocked.set(undefined);
    this.busy.set(true);
    try {
      await this.applyUpdate(row, update, t);
    } finally {
      this.busy.set(false);
    }
  }

  private async enable(row: PackRow): Promise<void> {
    const sheet = this.characterStore.sheet();
    if (!sheet) return;
    const drafts = propose.pinPack(sheet, { packId: row.id, version: row.version });
    if (drafts.length > 0) await this.characterStore.appendTx(drafts);
  }

  private async disable(row: PackRow, t: TranslateFn): Promise<void> {
    const facts = this.characterStore.facts();
    const current = this.characterStore.index();
    if (!facts || !current) return;

    const nextPins: Pins = { ...facts.pins };
    delete nextPins[row.id];
    const next = this.engineFacade.indexFor(nextPins);

    // Only errors this change introduces block it — a pin that was already unresolved stays so.
    const introduced = introducedErrors(current, next);
    if (introduced.length > 0) {
      this.blocked.set({ change: 'disable', diagnostics: introduced });
      return;
    }

    const plan = planRebase(facts, current, next, nextPins, this.characterStore.systemRules());
    await this.report({
      plan,
      title: t('sheet.build.packs.disable-title', { name: row.name }),
      nextIndex: next,
      currentIndex: current,
    });
  }

  private async applyUpdate(row: PackRow, update: PackUpdate, t: TranslateFn): Promise<void> {
    const facts = this.characterStore.facts();
    const current = this.characterStore.index();
    if (!facts || !current) return;

    const nextPins: Pins = { ...facts.pins, [update.packId]: update.to };
    const next = this.engineFacade.indexFor(nextPins);

    // Same rule as turning a pack off: an error the update introduces (a dependency it breaks, a
    // pin it cannot resolve) is shown instead of a plan.
    const introduced = introducedErrors(current, next);
    if (introduced.length > 0) {
      this.blocked.set({ change: 'update', diagnostics: introduced });
      return;
    }

    const plan = planRebase(facts, current, next, nextPins, this.characterStore.systemRules());
    await this.report({
      plan,
      title: t('sheet.build.packs.update-title', {
        name: row.name,
        from: update.from,
        to: update.to,
      }),
      nextIndex: next,
      currentIndex: current,
      validationOnly: update.kind === 'core',
    });
  }

  /** Opens the rebase report; only Confirm (`true`) appends `plan.events`, as ONE transaction. */
  private async report(data: RebaseReportDialogData): Promise<void> {
    const confirmed = await this.dialogService.open(RebaseReportDialogComponent, { data }).closed;
    if (confirmed === true && data.plan.events.length > 0) {
      await this.characterStore.appendTx(data.plan.events);
    }
  }
}
