import { Component, computed, inject, resource, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { CardComponent } from '@shared/components/card/card.component';
import { DialogRef, DialogService } from '@shared/components/dialog/dialog.service';
import { InstallPromptService } from '@shared/services/pwa/install-prompt.service';
import { SettingsRepository } from '@shared/services/storage/settings.repository';

/** `SettingsRepository` key the banner's dismissed state is persisted under (task-11-brief.md). */
const DISMISSED_KEY = 'install-banner-dismissed';

/**
 * The iOS "Add to Home Screen" instructions sheet (task-11-brief.md) — `InstallBannerComponent`
 * opens this via `DialogService.open({ sheet: true })` when `InstallPromptService.showIosHint()`
 * is true (iOS Safari never fires `beforeinstallprompt`, so there is no programmatic prompt to
 * call — this dialog is the ENTIRE iOS install affordance). Same "own injector, no inherited
 * `provideTranslocoScope('characters')`, full unscoped keys through its own `*transloco`"
 * convention as every other play-tab/list dialog opened via `DialogService.open()`
 * (`CharactersDeleteConfirmComponent`, `NoteDialogComponent`, …) — `DialogService.open()` attaches
 * its content under a NEW injector rooted at the app's root, not this component's own caller.
 *
 * Carries the spec's 7-day storage-eviction explanation (Global Constraints / task-11-brief.md):
 * iOS Safari evicts a non-installed web app's storage after 7 days of disuse — installing to the
 * Home Screen prevents that, which is exactly why this sheet exists rather than just being a
 * "nice to have" nag.
 */
@Component({
  selector: 'app-ios-install-sheet',
  imports: [TranslocoDirective, ButtonComponent],
  template: `
    <ng-container *transloco="let t">
      <h2 class="ios-install-sheet__title" data-dialog-title>
        {{ t('characters.list.installBanner.iosSheet.title') }}
      </h2>
      <p class="ios-install-sheet__intro">
        {{ t('characters.list.installBanner.iosSheet.intro') }}
      </p>
      <ol class="ios-install-sheet__steps">
        <li>{{ t('characters.list.installBanner.iosSheet.step1') }}</li>
        <li>{{ t('characters.list.installBanner.iosSheet.step2') }}</li>
        <li>{{ t('characters.list.installBanner.iosSheet.step3') }}</li>
      </ol>
      <p class="ios-install-sheet__storage-warning">
        {{ t('characters.list.installBanner.iosSheet.storageWarning') }}
      </p>
      <div class="ios-install-sheet__actions">
        <button hk-button type="button" (click)="close()">
          {{ t('characters.list.installBanner.iosSheet.close') }}
        </button>
      </div>
    </ng-container>
  `,
})
export class IosInstallSheetComponent {
  private readonly dialogRef = inject(DialogRef);

  protected close(): void {
    this.dialogRef.close();
  }
}

/**
 * The install nag banner (task-11-brief.md) — rendered on `CharactersListComponent` whenever
 * installing is offered and the player hasn't dismissed it: `InstallPromptService.canInstall()`
 * true (Chromium — an "Install" button calls `prompt()` directly, from this click, satisfying the
 * browser's own user-activation requirement for replaying the captured `beforeinstallprompt`
 * event) or `.showIosHint()` true (iOS Safari — a "How to install" button opens
 * `IosInstallSheetComponent` instead, since there's no programmatic prompt to call there).
 *
 * Dismissal persists via `SettingsRepository` under `DISMISSED_KEY` (plan-3's key/value store,
 * Dexie-backed) — `dismissedResource` reads it once per component instance; `dismissedOverride`
 * flips the banner hidden INSTANTLY on click (no flash of the banner while the write is still in
 * flight), while the real write happens in the background. A fresh `SettingsRepository` instance
 * (a new component, a new tab, a reloaded page) reads the SAME persisted row, so the dismissal
 * survives across instances — never re-shown just because the component was re-created.
 */
@Component({
  selector: 'app-install-banner',
  imports: [TranslocoDirective, ButtonComponent, CardComponent],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './install-banner.component.html',
  styleUrl: './install-banner.component.scss',
})
export class InstallBannerComponent {
  private readonly installPromptService = inject(InstallPromptService);
  private readonly settingsRepository = inject(SettingsRepository);
  private readonly dialogService = inject(DialogService);

  protected readonly canInstall = this.installPromptService.canInstall;
  protected readonly showIosHint = this.installPromptService.showIosHint;

  private readonly dismissedResource = resource({
    loader: () => this.settingsRepository.get<boolean>(DISMISSED_KEY),
  });

  // Optimistic local override (see class doc) — `undefined` until `onDismiss()` is clicked, at
  // which point it wins over whatever `dismissedResource` has (or later resolves to).
  private readonly dismissedOverride = signal<boolean | undefined>(undefined);

  private readonly dismissed = computed(
    () => this.dismissedOverride() ?? this.dismissedResource.value() === true,
  );

  // Never shows anything while the persisted dismissal is still loading — avoids a one-frame
  // flash of the banner (or of the wrong platform's affordance) before `dismissedResource`
  // settles, same "wait for the real read before deciding" caution `CharactersListComponent`'s own
  // `loading()`-gated skeleton follows for its row list.
  protected readonly visible = computed(
    () =>
      !this.dismissedResource.isLoading() &&
      !this.dismissed() &&
      (this.canInstall() || this.showIosHint()),
  );

  protected async onInstallClick(): Promise<void> {
    await this.installPromptService.prompt();
  }

  protected onShowIosInstructions(): void {
    this.dialogService.open(IosInstallSheetComponent, { sheet: true });
  }

  protected async onDismiss(): Promise<void> {
    this.dismissedOverride.set(true);
    await this.settingsRepository.set(DISMISSED_KEY, true);
  }
}
