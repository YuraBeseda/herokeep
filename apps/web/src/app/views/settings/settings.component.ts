import { Component, computed, inject, signal } from '@angular/core';
import { PACK_ID, PACK_VERSION } from '@hk/content/version';
import type { Pack } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { ChipComponent } from '@shared/components/chip/chip.component';
import { ToastService } from '@shared/components/toast/toast.service';
import { PackLoader } from '@shared/services/engine/pack-loader';
import { LocaleService, type Locale } from '@shared/services/i18n/locale.service';
import { StoragePersistService } from '@shared/services/pwa/storage-persist.service';
import { ThemeService, type Theme } from '@shared/services/theme/theme.service';
import { PackStore } from '@shared/stores/pack.store';

const LOCALES: readonly Locale[] = ['en', 'ru', 'uk'];
const THEMES: readonly Theme[] = ['dark', 'light'];
const BYTES_PER_MB = 1024 * 1024;

function packKey(pack: Pack): string {
  return `${pack.id}@${pack.version}`;
}

@Component({
  selector: 'app-settings',
  imports: [TranslocoDirective, ButtonComponent, CardComponent, ChipComponent],
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
}
