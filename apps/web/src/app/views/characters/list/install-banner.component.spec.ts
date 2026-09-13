import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTransloco, type TranslocoLoader } from '@jsverse/transloco';
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';
import { of } from 'rxjs';
import { InstallPromptService } from '@shared/services/pwa/install-prompt.service';
import { HkDb } from '@shared/services/storage/dexie.db';
import { SettingsRepository } from '@shared/services/storage/settings.repository';
import charactersEn from '../../../../assets/i18n/characters/en.json';
import { InstallBannerComponent } from './install-banner.component';

const DISMISSED_KEY = 'install-banner-dismissed';

class StubLoader implements TranslocoLoader {
  getTranslation(langPath: string) {
    return langPath === 'characters/en' ? of(charactersEn) : of({});
  }
}

/** Configures the TestBed with a stubbed `InstallPromptService` (its OWN real behavior —
 * `beforeinstallprompt` capture, iOS UA sniffing — is fully covered by
 * `install-prompt.service.spec.ts`; this spec only asserts `InstallBannerComponent`'s reaction to
 * `canInstall`/`showIosHint`/`prompt()`) plus the real `SettingsRepository`/`HkDb`
 * (fake-indexeddb) — dismissal persistence is this component's own contract, so that part stays
 * real, matching `characters-list.component.spec.ts`'s own "stub the collaborator whose behavior
 * is tested elsewhere, keep storage real" split. */
function configure(overrides: { canInstall?: boolean; showIosHint?: boolean } = {}): {
  promptFn: ReturnType<typeof vi.fn>;
} {
  const promptFn = vi.fn().mockResolvedValue(true);
  TestBed.configureTestingModule({
    providers: [
      provideTransloco({
        config: { availableLangs: ['en'], defaultLang: 'en', prodMode: true },
        loader: StubLoader,
      }),
      provideTranslocoMessageformat(),
      {
        provide: InstallPromptService,
        useValue: {
          canInstall: signal(overrides.canInstall ?? false),
          showIosHint: signal(overrides.showIosHint ?? false),
          prompt: promptFn,
        },
      },
    ],
  });
  return { promptFn };
}

describe('InstallBannerComponent', () => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
    TestBed.inject(HkDb).close();
  });

  it('renders nothing when neither canInstall nor showIosHint is true', async () => {
    configure({ canInstall: false, showIosHint: false });
    await TestBed.inject(HkDb).settings.clear();

    const fixture = TestBed.createComponent(InstallBannerComponent);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('.install-banner')).toBeNull();
  });

  it('shows the Install button when canInstall, and clicking it calls InstallPromptService.prompt()', async () => {
    const { promptFn } = configure({ canInstall: true });
    await TestBed.inject(HkDb).settings.clear();

    const fixture = TestBed.createComponent(InstallBannerComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.install-banner')).not.toBeNull();
    const installButton = compiled.querySelector<HTMLButtonElement>('.install-banner__install')!;
    expect(installButton.textContent?.trim()).toBe(charactersEn.list.installBanner.install);

    installButton.click();

    expect(promptFn).toHaveBeenCalledTimes(1);
  });

  it('shows a "how to install" button when showIosHint, opening the iOS sheet with the 7-day storage text', async () => {
    configure({ canInstall: false, showIosHint: true });
    await TestBed.inject(HkDb).settings.clear();

    const fixture = TestBed.createComponent(InstallBannerComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('.install-banner__install')).toBeNull();
    const iosButton = compiled.querySelector<HTMLButtonElement>('.install-banner__ios')!;
    expect(iosButton.textContent?.trim()).toBe(charactersEn.list.installBanner.howToInstall);

    iosButton.click();
    TestBed.tick();

    const sheetTitle = document.querySelector('.ios-install-sheet__title');
    expect(sheetTitle?.textContent?.trim()).toBe(charactersEn.list.installBanner.iosSheet.title);
    const storageWarning = document.querySelector('.ios-install-sheet__storage-warning');
    expect(storageWarning?.textContent?.trim()).toBe(
      charactersEn.list.installBanner.iosSheet.storageWarning,
    );
  });

  it('dismissing (×) hides the banner immediately and persists the key via SettingsRepository', async () => {
    configure({ canInstall: true });
    const db = TestBed.inject(HkDb);
    await db.settings.clear();
    const settingsRepository = TestBed.inject(SettingsRepository);

    const fixture = TestBed.createComponent(InstallBannerComponent);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.install-banner')).not.toBeNull();

    compiled.querySelector<HTMLButtonElement>('.install-banner__dismiss')?.click();
    await fixture.whenStable();

    expect(compiled.querySelector('.install-banner')).toBeNull();
    expect(await settingsRepository.get(DISMISSED_KEY)).toBe(true);
  });

  it('dismissal persists across a fresh TestBed/component instance (fake-indexeddb-backed)', async () => {
    configure({ canInstall: true });
    const db = TestBed.inject(HkDb);
    await db.settings.clear();

    const firstFixture = TestBed.createComponent(InstallBannerComponent);
    await firstFixture.whenStable();
    (firstFixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.install-banner__dismiss')
      ?.click();
    await firstFixture.whenStable();
    db.close();

    // A brand-new TestBed/injector — same "new tab/session" shape task-11-brief.md's own
    // "dismissal persists across TestBed re-creation" spec calls for. `resetTestingModule` tears
    // down the whole environment injector (a fresh `HkDb`/`SettingsRepository` on next inject),
    // but the underlying fake-indexeddb backing store is a global, module-level singleton — it
    // survives the reset, which is exactly what makes this assertion meaningful. Deliberately does
    // NOT clear `db.settings` afterward: the whole point is that the row written above is still
    // there.
    TestBed.resetTestingModule();
    configure({ canInstall: true });
    const secondFixture = TestBed.createComponent(InstallBannerComponent);
    await secondFixture.whenStable();

    expect(
      (secondFixture.nativeElement as HTMLElement).querySelector('.install-banner'),
    ).toBeNull();
  });
});
