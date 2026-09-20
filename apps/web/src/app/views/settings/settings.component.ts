import { Component, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import type { Pack } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { ChipComponent } from '@shared/components/chip/chip.component';
import { DIALOG_DATA, DialogRef, DialogService } from '@shared/components/dialog/dialog.service';
import { SkeletonComponent } from '@shared/components/skeleton/skeleton.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { formatBytes, type ByteUnit } from '@shared/helpers/format-bytes';
import { formatRelativeTime } from '@shared/helpers/format-relative-time';
import { apiJson } from '@shared/services/api/api-fetch';
import { AuthService } from '@shared/services/auth/auth.service';
import { PackLoader } from '@shared/services/engine/pack-loader';
import { LocaleService, type Locale } from '@shared/services/i18n/locale.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import type { CharacterRow } from '@shared/services/storage/dexie.db';
import { SyncService } from '@shared/services/sync/sync.service';
import { ThemeService, type Theme } from '@shared/services/theme/theme.service';
import { PackStore } from '@shared/stores/pack.store';

const LOCALES: readonly Locale[] = ['en', 'ru', 'uk'];
const THEMES: readonly Theme[] = ['dark', 'light'];
const BYTES_PER_MB = 1024 * 1024;
/** task-9-brief.md: "a warning style at >= 80%". */
const QUOTA_WARNING_THRESHOLD = 0.8;

function packKey(pack: Pack): string {
  return `${pack.id}@${pack.version}`;
}

/** The Devices card's row shape — mirrors `apps/api/src/core/auth/sessions.ts`'s `DeviceRow`
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
 * on `resource()`'s own `.error()` signal — keeps the Devices card's loading/error/success states
 * driven by one plain value the template (and this spec) can pattern-match directly. */
type DevicesLoad =
  { readonly ok: true; readonly rows: readonly DeviceRow[] } | { readonly ok: false };

/** One Quota card row, already formatted for the template — `known: false` is the "no quota data
 * yet" (offline / stream never synced) state task-9-brief.md calls for an em-dash on. */
interface QuotaRowVm {
  readonly id: string;
  readonly name: string;
  readonly known: boolean;
  readonly usedAmount?: string;
  readonly usedUnit?: ByteUnit;
  readonly maxAmount?: string;
  readonly maxUnit?: ByteUnit;
  readonly warning: boolean;
}

/**
 * `DialogService.open()` content component for the Account card's "log out everywhere" confirm
 * (task-9-brief.md: "confirm dialog per existing dialog conventions — logoutAll is
 * destructive-ish"). Same standalone-content-component pattern as
 * `characters-list.component.ts`'s own `CharactersDeleteConfirmComponent`: rendered under a NEW
 * injector rooted at the app's root, so it reads the global (unscoped) `*transloco` lookup rather
 * than relying on `SettingsComponent`'s own `provideTranslocoScope('settings')` — safe because the
 * `settings` scope is already loaded by the time this dialog can open (its only caller loaded it
 * first).
 */
@Component({
  selector: 'app-settings-logout-all-confirm',
  imports: [TranslocoDirective, ButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="settings-logout-all-confirm__title" data-dialog-title>
        {{ t('settings.account.logoutAllConfirm.title') }}
      </h2>
      <p class="settings-logout-all-confirm__body">
        {{ t('settings.account.logoutAllConfirm.body') }}
      </p>
      <div class="settings-logout-all-confirm__actions">
        <button
          hk-button
          [variant]="'ghost'"
          type="button"
          class="settings-logout-all-confirm__cancel"
          (click)="cancel()"
        >
          {{ t('settings.account.logoutAllConfirm.cancel') }}
        </button>
        <button
          hk-button
          [variant]="'danger'"
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
  imports: [TranslocoDirective, ButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="settings-revoke-device-confirm__title" data-dialog-title>
        {{ t('settings.devices.revokeConfirm.title', { deviceLabel: data.deviceLabel }) }}
      </h2>
      <p class="settings-revoke-device-confirm__body">
        {{ t('settings.devices.revokeConfirm.body') }}
      </p>
      <div class="settings-revoke-device-confirm__actions">
        <button
          hk-button
          [variant]="'ghost'"
          type="button"
          class="settings-revoke-device-confirm__cancel"
          (click)="cancel()"
        >
          {{ t('settings.devices.revokeConfirm.cancel') }}
        </button>
        <button
          hk-button
          [variant]="'danger'"
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

@Component({
  selector: 'app-settings',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    CardComponent,
    ChipComponent,
    SkeletonComponent,
    RouterLink,
  ],
  providers: [provideTranslocoScope('settings')],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private readonly localeService = inject(LocaleService);
  private readonly themeService = inject(ThemeService);
  private readonly packStore = inject(PackStore);
  private readonly packLoader = inject(PackLoader);
  private readonly toastService = inject(ToastService);
  private readonly storagePersistService = inject(StoragePersistService);
  protected readonly authService = inject(AuthService);
  private readonly syncService = inject(SyncService);
  private readonly charactersRepository = inject(CharactersRepository);
  private readonly dialogService = inject(DialogService);

  // Template-facing state
  protected readonly locales = LOCALES;
  protected readonly themes = THEMES;
  protected readonly locale = this.localeService.locale;
  protected readonly theme = this.themeService.theme;
  protected readonly translationPacks = this.packStore.translationPacks;
  protected readonly corePackLabel = `${PACK_ID}@${PACK_VERSION}`;
  protected readonly importing = signal(false);

  protected readonly storageSupported = this.storagePersistService.supported;
  protected readonly persisted = this.storagePersistService.persisted;
  protected readonly usedMb = computed(() =>
    this.formatMb(this.storagePersistService.estimate()?.usage),
  );
  protected readonly quotaMb = computed(() =>
    this.formatMb(this.storagePersistService.estimate()?.quota),
  );

  // --- Devices card (task-9-brief.md) ---------------------------------------------------------

  // `params: authService.status()` — reruns the loader whenever auth state changes (login/logout
  // toggles the card's very presence), not just once at construction; a non-authed status never
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

  // --- Quota card (task-9-brief.md) -----------------------------------------------------------

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

  // Methods
  // Live locale switch — `LocaleService.setLocale` itself activates Transloco's active lang
  // and re-renders with no page reload (see its own doc comment); nothing further is needed here.
  protected selectLocale(locale: Locale): void {
    this.localeService.setLocale(locale);
  }

  protected selectTheme(theme: Theme): void {
    this.themeService.setTheme(theme);
  }

  protected async requestPersist(): Promise<void> {
    await this.storagePersistService.requestPersist();
  }

  protected async removePack(pack: Pack): Promise<void> {
    await this.packStore.removeTranslation(packKey(pack));
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

  private formatMb(bytes: number | undefined): string | undefined {
    if (bytes === undefined) return undefined;
    return new Intl.NumberFormat(this.localeService.locale(), {
      maximumFractionDigits: 1,
    }).format(bytes / BYTES_PER_MB);
  }

  // --- Account card ----------------------------------------------------------------------------

  protected async logout(): Promise<void> {
    await this.authService.logout();
  }

  protected async logoutAll(): Promise<void> {
    const handle = this.dialogService.open(SettingsLogoutAllConfirmComponent);
    const confirmed = await handle.closed;
    if (confirmed !== true) return;
    await this.authService.logoutAll();
  }

  // --- Devices card ------------------------------------------------------------------------------

  protected refreshDevices(): void {
    this.devicesResource.reload();
  }

  protected relativeTime(timestampMs: number): string {
    return formatRelativeTime(timestampMs, this.localeService.locale());
  }

  protected async revokeDevice(device: DeviceRow): Promise<void> {
    const handle = this.dialogService.open(SettingsRevokeDeviceConfirmComponent, {
      data: { deviceLabel: device.deviceLabel },
    });
    const confirmed = await handle.closed;
    if (confirmed !== true) return;

    try {
      await apiJson<void>(`/api/me/sessions/${device.id}`, { method: 'DELETE' });
      this.devicesResource.reload();
    } catch {
      this.toastService.show('settings.devices.toast.revoke-failed');
    }
  }

  // --- Quota card --------------------------------------------------------------------------------

  private toQuotaRow(row: CharacterRow): QuotaRowVm {
    const quota = this.syncService.quotaFor(row.id)();
    if (!quota || quota.bytesMax <= 0) {
      return { id: row.id, name: row.name, known: false, warning: false };
    }

    const locale = this.localeService.locale();
    const used = formatBytes(quota.bytesUsed, locale);
    const max = formatBytes(quota.bytesMax, locale);
    const pct = quota.bytesUsed / quota.bytesMax;

    return {
      id: row.id,
      name: row.name,
      known: true,
      usedAmount: used.amount,
      usedUnit: used.unit,
      maxAmount: max.amount,
      maxUnit: max.unit,
      warning: pct >= QUOTA_WARNING_THRESHOLD,
    };
  }
}
