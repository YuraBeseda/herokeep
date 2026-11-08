import { CdkTrapFocus } from '@angular/cdk/a11y';
import { Component, inject, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { AuthService } from '@shared/services/auth/auth.service';
import { LocaleService, type Locale } from '@shared/services/i18n/locale.service';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkThemeMenuComponent } from '../theme-menu/theme-menu.component';
import { currentSection } from './current-section';
import { SECTIONS, sectionNameKey } from './sections';

const LOCALES: readonly Locale[] = ['en', 'ru', 'uk'];

/**
 * `hk-app-drawer` — the phone's app drawer (design-system NavRail, board IA-Phone-Drawer): the
 * six sections, About, the account row, the theme and the language. It is the panel only; the top
 * bar owns opening it and the dismissal (Escape, press outside, the folio button), because those
 * need the button that opened it. Following a link emits `navigated` so the owner can close it.
 */
@Component({
  selector: 'hk-app-drawer',
  imports: [RouterLink, TranslocoDirective, CdkTrapFocus, IconComponent, HkThemeMenuComponent],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './app-drawer.component.html',
  styleUrl: './app-drawer.component.scss',
})
export class HkAppDrawerComponent {
  private readonly localeService = inject(LocaleService);

  protected readonly auth = inject(AuthService);
  protected readonly current = currentSection();
  protected readonly sections = SECTIONS;
  protected readonly nameKey = sectionNameKey;
  protected readonly locales = LOCALES;
  protected readonly locale = this.localeService.locale;

  // Outputs
  readonly navigated = output<void>();

  protected setLocale(locale: Locale): void {
    this.localeService.setLocale(locale);
  }
}
