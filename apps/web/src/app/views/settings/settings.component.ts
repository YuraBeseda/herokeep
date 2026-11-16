import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  resource,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import type { Pack } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { DIALOG_DATA, DialogRef, DialogService } from '@app/ui/dialog/dialog.service';
import { ToastService } from '@shared/components/toast/toast.service';
import { formatBytes, type FormattedBytes } from '@shared/helpers/format-bytes';
import { formatRelativeTime } from '@shared/helpers/format-relative-time';
import { apiJson } from '@shared/services/api/api-fetch';
import { AuthService } from '@shared/services/auth/auth.service';
import {
  CACHE_CAP_MAX_BYTES,
  CACHE_CAP_MIN_BYTES,
  CacheManagerService,
} from '@shared/services/blob-transfer/cache-manager.service';
import { PackLoader } from '@shared/services/engine/pack-loader';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { ExportAllHeroesService } from '@shared/services/export/export-all-heroes.service';
import { updatesFor } from '@shared/services/packs/pack-updates';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import type { CharacterRow } from '@shared/services/storage/dexie.db';
import { SyncService } from '@shared/services/sync/sync.service';
import { PackStore } from '@shared/stores/pack.store';
import { IconComponent } from '../../shared/icons/icon.component';
import { ActionStrapService } from '../../ui/action-strap/action-strap.service';
import { HkButtonComponent } from '../../ui/button/button.component';
import { HkLeafComponent } from '../../ui/leaf/leaf.component';
import { HkSelectComponent, type SelectOption } from '../../ui/select/select.component';
import { TopBarService } from '../../ui/shell/top-bar.service';
import { HkTagChipComponent } from '../../ui/tag-chip/tag-chip.component';
import { SettingsAboutComponent } from './settings-about.component';
import { RecoveryCodesDialogComponent } from './recovery-codes-dialog.component';
import { SettingsAppearanceComponent } from './settings-appearance.component';
import { HkTooltipDirective } from '../../ui/tooltip/tooltip.directive';
import { openHelpDialog } from '../help-dialog/help-dialog.component';
import { packBytesOf } from '../packs/pack-summary';
import { PackUsageService } from '../packs/pack-usage.service';
import { translated } from '../translated';
import { buildSettingsStrap } from './settings-strap';

/** The sections the left index lists, in order; each is an `id` on its leaf. */
const SECTIONS = [
  { id: 'account', icon: 'ui:account' },
  { id: 'appearance', icon: 'ui:appearance' },
  { id: 'storage', icon: 'ui:storage' },
  { id: 'packs', icon: 'ui:packs' },
  { id: 'about', icon: 'ui:details' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const BYTES_PER_MB = 1024 * 1024;
const MB_PER_GB = 1024;
/** The cache limits the select offers; a cap stored by the old slider is added to the list. */
const CACHE_LIMITS_MB: readonly number[] = [
  Math.round(CACHE_CAP_MIN_BYTES / BYTES_PER_MB),
  250,
  500,
  1000,
  Math.round(CACHE_CAP_MAX_BYTES / BYTES_PER_MB),
];
/** task-9-brief.md: "a warning style at >= 80%". */
const QUOTA_WARNING_THRESHOLD = 0.8;

/** The save picker's file-type label; held in a constant (the key checker reads literals in
 * `translate()` calls against the unscoped file, and this key lives in the `settings` scope). */
const PICKER_DESCRIPTION_KEY = 'settings.export.pickerDescription';

/** The paragraphs of Settings' Help dialog (`settings.help.<topic>`). */
const HELP_TOPICS = ['appearance', 'storage', 'account'] as const;

/** A translate function as the template's `*transloco` hands it out. */
export type Translate = (key: string, params?: Record<string, unknown>) => string;

function isSection(value: string | null): value is SectionId {
  return SECTIONS.some((section) => section.id === value);
}

/** The Devices list's row shape — mirrors `apps/api/src/core/auth/sessions.ts`'s `DeviceRow`
 * wire DTO exactly (`GET /api/me/sessions`'s response), duplicated here rather than imported
 * since `apps/web` has no dependency on `apps/api`'s source (same reasoning `auth.service.ts`'s
 * header comment gives for its own copied `USERNAME_PATTERN`). */
interface DeviceRow {
  readonly id: string | null;
  readonly deviceLabel: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly current: boolean;
}

/** `devicesResource`'s resolved value: a discriminated success/failure result rather than relying
 * on `resource()`'s own `.error()` signal — keeps the Devices list's loading/error/success states
 * driven by one plain value the template (and this spec) can pattern-match directly. */
type DevicesLoad =
  { readonly ok: true; readonly rows: readonly DeviceRow[] } | { readonly ok: false };

/** One quota row, already formatted for the template — `known: false` is the "no quota data
 * yet" (offline / stream never synced) state task-9-brief.md calls for an em-dash on. */
interface QuotaRowVm {
  readonly id: string;
  readonly name: string;
  readonly known: boolean;
  readonly used?: FormattedBytes;
  readonly max?: FormattedBytes;
  readonly bytesUsed: number;
  readonly bytesMax: number;
  readonly warning: boolean;
}

/**
 * `DialogService.open()` content component for the Account section's "log out everywhere" confirm
 * (task-9-brief.md: "confirm dialog per existing dialog conventions — logoutAll is
 * destructive-ish"). Rendered under a NEW injector rooted at the app's root, so it reads the global
 * (unscoped) `*transloco` lookup rather than `SettingsComponent`'s own
 * `provideTranslocoScope('settings')` — safe because the `settings` scope is already loaded by the
 * time this dialog can open (its only caller loaded it first).
 */
@Component({
  selector: 'app-settings-logout-all-confirm',
  imports: [TranslocoDirective, HkButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="settings-logout-all-confirm__title" data-dialog-title>
        {{ t('settings.account.logoutAllConfirm.title') }}
      </h2>
      <p class="settings-logout-all-confirm__body">
        {{ t('settings.account.logoutAllConfirm.body') }}
      </p>
      <div class="settings-logout-all-confirm__actions" data-dialog-actions>
        <button
          hk-button
          [variant]="'ghost-leather'"
          type="button"
          class="settings-logout-all-confirm__cancel"
          (click)="cancel()"
        >
          {{ t('settings.account.logoutAllConfirm.cancel') }}
        </button>
        <button
          hk-button
          [variant]="'ember'"
          type="button"
          class="settings-logout-all-confirm__confirm"
          (click)="confirm()"
        >
          {{ t('settings.account.logoutAllConfirm.confirm') }}
        </button>
      </div>
    </ng-container>
  `,
})
export class SettingsLogoutAllConfirmComponent {
  private readonly dialogRef = inject(DialogRef);

  protected confirm(): void {
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}

/** Same pattern as `SettingsLogoutAllConfirmComponent` above, for a single device's revoke. */
@Component({
  selector: 'app-settings-revoke-device-confirm',
  imports: [TranslocoDirective, HkButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="settings-revoke-device-confirm__title" data-dialog-title>
        {{ t('settings.devices.revokeConfirm.title', { deviceLabel: data.deviceLabel }) }}
      </h2>
      <p class="settings-revoke-device-confirm__body">
        {{ t('settings.devices.revokeConfirm.body') }}
      </p>
      <div class="settings-revoke-device-confirm__actions" data-dialog-actions>
        <button
          hk-button
          [variant]="'ghost-leather'"
          type="button"
          class="settings-revoke-device-confirm__cancel"
          (click)="cancel()"
        >
          {{ t('settings.devices.revokeConfirm.cancel') }}
        </button>
        <button
          hk-button
          [variant]="'ember'"
          type="button"
          class="settings-revoke-device-confirm__confirm"
          (click)="confirm()"
        >
          {{ t('settings.devices.revokeConfirm.confirm') }}
        </button>
      </div>
    </ng-container>
  `,
})
export class SettingsRevokeDeviceConfirmComponent {
  protected readonly data = inject<{ deviceLabel: string }>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);

  protected confirm(): void {
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}

/**
 * `/settings` (board ST01): a left index and five leaves — Account (identity, devices, account
 * storage), Appearance (theme cards, density, motion, language), Storage (this device's usage, keep
 * data, the campaign image cache limit), Content packs, and About & licences (the former `/about`
 * screen, folded in; `/about` redirects to `#about`).
 *
 * Everything applies at once; nothing here is a form with a Save, so nothing can be left dirty.
 * The strap carries Manage packs, Export all heroes and Help; on a phone the top bar's action jumps
 * to Account.
 */
@Component({
  selector: 'app-settings',
  imports: [
    TranslocoDirective,
    RouterLink,
    HkButtonComponent,
    HkLeafComponent,
    HkSelectComponent,
    HkTagChipComponent,
    HkTooltipDirective,
    IconComponent,
    SettingsAboutComponent,
    SettingsAppearanceComponent,
  ],
  providers: [provideTranslocoScope('settings')],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly localeService = inject(LocaleService);
  private readonly packStore = inject(PackStore);
  private readonly packLoader = inject(PackLoader);
  private readonly packUsage = inject(PackUsageService);
  private readonly toastService = inject(ToastService);
  private readonly storagePersistService = inject(StoragePersistService);
  private readonly cacheManagerService = inject(CacheManagerService);
  protected readonly authService = inject(AuthService);
  private readonly syncService = inject(SyncService);
  private readonly charactersRepository = inject(CharactersRepository);
  private readonly dialogService = inject(DialogService);
  private readonly exportAllHeroes = inject(ExportAllHeroesService);
  private readonly strap = inject(ActionStrapService);
  private readonly topBar = inject(TopBarService);

  // --- Index and sections ---------------------------------------------------------------------------

  protected readonly sections = SECTIONS;
  private readonly fragment = toSignal(this.route.fragment, { initialValue: null });
  /** The section the URL names (`#about`), or the first one. */
  protected readonly activeSection = computed<SectionId>(() => {
    const fragment = this.fragment();
    return isSection(fragment) ? fragment : 'account';
  });

  // --- Account --------------------------------------------------------------------------------------

  protected readonly authed = computed(() => this.authService.status() === 'authed');

  // --- Content packs --------------------------------------------------------------------------------

  protected readonly translationPacks = this.packStore.translationPacks;
  protected readonly corePackName = computed(() => this.packStore.corePack()?.name ?? null);
  protected readonly corePackKey = `${PACK_ID}@${PACK_VERSION}`;
  protected readonly corePackVersion = PACK_VERSION;
  protected readonly contentPackCount = computed(() => this.packStore.installedContent().length);
  protected readonly importing = signal(false);

  /** Every stored hero's pins, read once (installing a pack recomputes the update count). */
  private readonly heroPins = resource({ loader: () => this.packUsage.heroPins() });
  /** How many installed pack versions some hero could update to (the packs list counts the same way). */
  protected readonly updateCount = computed(() => {
    const heroes = this.heroPins.hasValue() ? this.heroPins.value() : [];
    const installed = this.packStore.installedContent();
    const targets = new Set<string>();
    for (const hero of heroes) {
      for (const update of updatesFor(hero.pins, installed, {
        id: PACK_ID,
        version: PACK_VERSION,
      })) {
        targets.add(`${update.packId}@${update.to}`);
      }
    }
    return targets.size;
  });

  // --- Storage --------------------------------------------------------------------------------------

  protected readonly storageSupported = this.storagePersistService.supported;
  protected readonly persisted = this.storagePersistService.persisted;
  protected readonly storageUsed = computed(() =>
    this.bytesOf(this.storagePersistService.estimate()?.usage),
  );
  protected readonly storageQuota = computed(() =>
    this.bytesOf(this.storagePersistService.estimate()?.quota),
  );
  /** Device usage split into cached images, installed packs and the rest (usage minus those two). */
  protected readonly storageParts = computed(() => {
    const estimate = this.storagePersistService.estimate();
    if (estimate?.usage === undefined || !estimate.quota) return null;
    const images = this.cacheBytes.hasValue() ? this.cacheBytes.value() : 0;
    const core = this.packStore.corePack();
    const packs = packBytesOf(
      core ? [core, ...this.packStore.installedContent()] : this.packStore.installedContent(),
    );
    const other = Math.max(0, estimate.usage - images - packs);
    const quota = estimate.quota;
    const share = (bytes: number): number => Math.min(100, (bytes / quota) * 100);
    return [
      { id: 'images', bytes: images, percent: share(images) },
      { id: 'packs', bytes: packs, percent: share(packs) },
      { id: 'other', bytes: other, percent: share(other) },
    ].map((part) => ({ ...part, size: formatBytes(part.bytes, this.localeService.locale()) }));
  });

  /** The share of this device's storage in use, 0–100, for the bar. */
  protected readonly storagePercent = computed(() => {
    const estimate = this.storagePersistService.estimate();
    if (!estimate?.usage || !estimate.quota) return 0;
    return Math.min(100, Math.round((estimate.usage / estimate.quota) * 100));
  });

  // --- Campaign image cache -----------------------------------------------------------------------

  protected readonly cacheCapMb = computed(() =>
    Math.round(this.cacheManagerService.capBytes() / BYTES_PER_MB),
  );
  /** The select works in strings; this is the stored cap in MB as the option value. */
  protected readonly cacheCapValue = computed(() => String(this.cacheCapMb()));
  /** What the image cache itself holds (its own blob sizes), measured again after a limit change. */
  private readonly cacheBytes = resource({ loader: () => this.cacheManagerService.cacheBytes() });
  protected readonly cacheInUse = computed(() =>
    this.cacheBytes.hasValue() ? this.bytesOf(this.cacheBytes.value()) : undefined,
  );

  // --- Devices ------------------------------------------------------------------------------------------

  // `params: authService.status()` — reruns the loader whenever auth state changes (login/logout
  // toggles the section's very presence), not just once at construction; a non-authed status never
  // hits the network. Errors are caught INSIDE the loader (see `DevicesLoad`'s doc comment) rather
  // than left to `resource()`'s own error channel, so the template only ever pattern-matches one
  // value.
  private readonly devicesResource = resource({
    params: () => this.authService.status(),
    loader: async ({ params: status }): Promise<DevicesLoad> => {
      if (status !== 'authed') return { ok: true, rows: [] };
      try {
        const rows = await apiJson<DeviceRow[]>('/api/me/sessions');
        return { ok: true, rows };
      } catch {
        return { ok: false };
      }
    },
  });

  protected readonly devicesLoading = this.devicesResource.isLoading;
  protected readonly devices = computed<readonly DeviceRow[]>(() => {
    const value = this.devicesResource.value();
    return value?.ok ? value.rows : [];
  });
  protected readonly devicesError = computed(() => this.devicesResource.value()?.ok === false);
  private readonly devicesKnown = computed(
    () => !this.devicesLoading() && this.devicesResource.value()?.ok === true,
  );

  // --- Account storage (quota) ----------------------------------------------------------------------

  // One-shot load, same convention as `characters-list.component.ts`'s own `charactersResource`
  // — re-triggered explicitly (never a reactive `params`), since the Library index rarely changes
  // while Settings is open.
  private readonly charactersResource = resource({
    loader: () => this.charactersRepository.list(),
  });

  protected readonly quotaRows = computed<QuotaRowVm[]>(() => {
    const rows = this.charactersResource.value() ?? [];
    return rows.map((row) => this.toQuotaRow(row));
  });
  /** The account total across the heroes that report quota: one bar and one line. */
  protected readonly quotaTotal = computed(() => {
    const known = this.quotaRows().filter((row) => row.known);
    if (known.length === 0) return null;
    const used = known.reduce((sum, row) => sum + row.bytesUsed, 0);
    const max = known.reduce((sum, row) => sum + row.bytesMax, 0);
    const locale = this.localeService.locale();
    return {
      used: formatBytes(used, locale),
      max: formatBytes(max, locale),
      perHero: formatBytes(Math.max(...known.map((row) => row.bytesMax)), locale),
      heroes: known.length,
      percent: Math.min(100, Math.round((used / max) * 100)),
    };
  });
  protected readonly heroCount = computed(() => this.charactersResource.value()?.length ?? 0);
  /** Heroes Export all would write: the ones that are not archived. */
  private readonly exportableCount = computed(
    () => (this.charactersResource.value() ?? []).filter((row) => !row.archived).length,
  );
  /** The account sentence needs both counts; until the device list loads it says nothing. */
  protected readonly accountSummary = computed(() =>
    this.devicesKnown() ? { heroes: this.heroCount(), devices: this.devices().length } : null,
  );

  // --- Strap and top bar ----------------------------------------------------------------------------

  private readonly strapNote = translated(this.transloco, 'settings.strap-note');

  constructor() {
    // The strap: Manage packs, Export all heroes (drawn disabled with its reason while there is no
    // hero or a run is saving), Help.
    effect(() => {
      const exportReason = this.exportAllHeroes.exporting()
        ? 'shell.strap.packs-export-busy'
        : this.exportableCount() === 0
          ? 'shell.strap.settings-export-none'
          : null;
      this.strap.set(
        buildSettingsStrap({
          managePacks: () => void this.router.navigateByUrl('/packs'),
          exportAll: () =>
            void this.exportAllHeroes.run(this.transloco.translate(PICKER_DESCRIPTION_KEY)),
          help: () => openHelpDialog(this.dialogService, this.transloco, 'settings', HELP_TOPICS),
          exportReason,
          note: this.strapNote(),
        }),
      );
    });
    // Phone: the top bar's one action jumps to the Account section.
    this.topBar.set({
      action: {
        id: 'account',
        label: 'shell.icon.account',
        icon: 'account',
        run: () => void this.router.navigate([], { fragment: 'account' }),
      },
    });
    inject(DestroyRef).onDestroy(() => {
      this.strap.clear();
      this.topBar.clear();
    });

    // A fragment (`#about`) names the section to bring into view, on arrival and on each change.
    afterRenderEffect(() => {
      const fragment = this.fragment();
      if (isSection(fragment)) this.reveal(fragment);
    });
  }

  /** Scrolls a section into view and moves focus to its heading, so a keyboard or screen-reader user lands there too. */
  private reveal(id: SectionId): void {
    const target = this.host.querySelector<HTMLElement>(`#${id}`);
    if (!target) return;
    if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
    const heading = target.querySelector<HTMLElement>('h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }

  /** The index link of the section already named by the URL: the router ignores the same address, so scroll again here. */
  protected onIndexClick(id: SectionId): void {
    if (this.fragment() === id) this.reveal(id);
  }

  // --- Storage --------------------------------------------------------------------------------------

  protected async requestPersist(): Promise<void> {
    await this.storagePersistService.requestPersist();
  }

  /** The limits the select offers: the standard steps plus whatever cap is stored now. */
  protected cacheOptions(t: Translate): SelectOption[] {
    const current = this.cacheCapMb();
    const steps = CACHE_LIMITS_MB.includes(current)
      ? CACHE_LIMITS_MB
      : [...CACHE_LIMITS_MB, current];
    return [...steps]
      .sort((a, b) => a - b)
      .map((mb) => ({
        value: String(mb),
        label:
          mb >= MB_PER_GB && mb % MB_PER_GB === 0
            ? t('storage.cache.option-gb', { value: mb / MB_PER_GB })
            : t('storage.cache.option-mb', { value: mb }),
      }));
  }

  /** The select's `change`: `value` is the chosen limit in MB; `CacheManagerService.setCapBytes`
   * clamps to `[CACHE_CAP_MIN_BYTES, CACHE_CAP_MAX_BYTES]` and immediately re-runs the LRU sweep
   * against the new cap. A non-numeric value is silently ignored. */
  protected onCacheCap(value: string | null): void {
    const mb = Number(value);
    if (value === null || !Number.isFinite(mb)) return;
    void this.cacheManagerService
      .setCapBytes(mb * BYTES_PER_MB)
      .then(() => this.cacheBytes.reload());
  }

  // --- Content packs --------------------------------------------------------------------------------

  protected async removePack(pack: Pack): Promise<void> {
    await this.packStore.removeTranslation(`${pack.id}@${pack.version}`);
  }

  // I/O boundary: fetches the bundled ru demo pack asset and hands it to `PackStore` for
  // validation. A rejected fetch (network failure, bad JSON, failed pack-schema parse — see
  // `PackLoader.loadDemoRu`) is treated the same as a validation-diagnostics rejection: both
  // toast `packs.import-invalid` and neither ever leaves an unhandled promise rejection.
  protected async importDemo(): Promise<void> {
    this.importing.set(true);
    try {
      const pack = await this.packLoader.loadDemoRu();
      const diagnostics = await this.packStore.importTranslation(pack);
      this.toastService.show(
        diagnostics === null ? 'settings.packs.import-success' : 'settings.packs.import-invalid',
      );
    } catch {
      this.toastService.show('settings.packs.import-invalid');
    } finally {
      this.importing.set(false);
    }
  }

  // --- Account --------------------------------------------------------------------------------------

  protected async logout(): Promise<void> {
    await this.authService.logout();
  }

  protected openRecoveryCodes(): void {
    this.dialogService.open(RecoveryCodesDialogComponent);
  }

  protected async logoutAll(): Promise<void> {
    const handle = this.dialogService.open(SettingsLogoutAllConfirmComponent);
    const confirmed = await handle.closed;
    if (confirmed !== true) return;
    await this.authService.logoutAll();
  }

  // --- Devices ------------------------------------------------------------------------------------------

  protected refreshDevices(): void {
    this.devicesResource.reload();
  }

  protected relativeTime(timestampMs: number): string {
    return formatRelativeTime(timestampMs, this.localeService.locale());
  }

  /** A phone, tablet or laptop glyph, guessed from the device name (`Safari on iPhone`, `Pixel 8`). */
  protected deviceIcon(label: string): string {
    if (/ipad|tablet|tab\b/i.test(label)) return 'ui:tablet';
    if (/iphone|android|pixel|phone|mobile/i.test(label)) return 'ui:phone';
    return 'ui:laptop';
  }

  // `@for` track fn: `DeviceRow.id` is `string | null` server-side (`apps/api/src/core/auth/sessions.ts`'s
  // own `DeviceRow` — see its doc comment: the sessions table's PK is a token hash, never exposed
  // over HTTP, so `id` names the ADDITIVE `0001` migration column instead, which existing
  // pre-migration rows never got and so read `null`). `track device.id` alone would collapse every
  // null-id row onto the SAME tracked identity — wrong diffing. `deviceLabel:createdAt` is a
  // reasonable fallback identity for those rows: two sessions from the same device created at the
  // exact same millisecond are vanishingly unlikely, and even a collision only costs a suboptimal
  // re-render, never a wrong revoke target (that's `device` itself, passed by value).
  protected trackDevice(device: DeviceRow): string {
    return device.id ?? `${device.deviceLabel}:${device.createdAt}`;
  }

  // A `null` id can never be revoked (there is no `DELETE /api/me/sessions/null` — the route 404s,
  // and even if it didn't, "null" is not this row's identity). The template hides the revoke button
  // whenever this is `false`; this guard also short-circuits `revokeDevice` itself.
  protected canRevoke(device: DeviceRow): boolean {
    return !device.current && device.id !== null;
  }

  protected async revokeDevice(device: DeviceRow): Promise<void> {
    if (device.id === null) return;
    const id = device.id;

    const handle = this.dialogService.open(SettingsRevokeDeviceConfirmComponent, {
      data: { deviceLabel: device.deviceLabel },
    });
    const confirmed = await handle.closed;
    if (confirmed !== true) return;

    try {
      await apiJson<void>(`/api/me/sessions/${id}`, { method: 'DELETE' });
      this.devicesResource.reload();
    } catch {
      this.toastService.show('settings.devices.toast.revoke-failed');
    }
  }

  // --- Helpers ------------------------------------------------------------------------------------------

  /** Account storage unit text (`quota.unit.<code>`), keyed by the unit `formatBytes` chose. */
  protected unitKey(bytes: FormattedBytes): string {
    return `quota.unit.${bytes.unit}`;
  }

  private bytesOf(bytes: number | undefined): FormattedBytes | undefined {
    return bytes === undefined ? undefined : formatBytes(bytes, this.localeService.locale());
  }

  private toQuotaRow(row: CharacterRow): QuotaRowVm {
    const quota = this.syncService.quotaFor(row.id)();
    if (!quota || quota.bytesMax <= 0) {
      return {
        id: row.id,
        name: row.name,
        known: false,
        bytesUsed: 0,
        bytesMax: 0,
        warning: false,
      };
    }

    const locale = this.localeService.locale();
    return {
      id: row.id,
      name: row.name,
      known: true,
      used: formatBytes(quota.bytesUsed, locale),
      max: formatBytes(quota.bytesMax, locale),
      bytesUsed: quota.bytesUsed,
      bytesMax: quota.bytesMax,
      warning: quota.bytesUsed / quota.bytesMax >= QUOTA_WARNING_THRESHOLD,
    };
  }
}
