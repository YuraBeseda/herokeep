import { Component, inject } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { LocaleService, type Locale } from '@shared/services/i18n/locale.service';
import { DisplayPrefsService, type Density } from '@shared/services/theme/display-prefs.service';
import { ThemeService, type Theme } from '@shared/services/theme/theme.service';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkLeafComponent } from '../../ui/leaf/leaf.component';
import { HkSelectComponent, type SelectOption } from '../../ui/select/select.component';
import { HkToggleComponent } from '../../ui/toggle/toggle.component';
import { HkWaxSealComponent } from '../../ui/wax-seal/wax-seal.component';

const LOCALES: readonly Locale[] = ['en', 'ru', 'uk'];
const THEMES: readonly { readonly id: Theme; readonly icon: string }[] = [
  { id: 'tavern', icon: 'ui:theme-tavern' },
  { id: 'scroll', icon: 'ui:theme-scroll' },
  { id: 'plain', icon: 'ui:theme-plain' },
];
const DENSITIES: readonly Density[] = ['compact', 'comfortable'];

/** A translate function as the template's `*transloco` hands it out. */
type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * Settings, Appearance (board ST01): three theme cards, the row density, motion on or off, and the
 * language. Each choice applies at once through its service (`ThemeService`,
 * `DisplayPrefsService`, `LocaleService`) and is remembered on this device.
 */
@Component({
  selector: 'app-settings-appearance',
  imports: [
    TranslocoDirective,
    HkLeafComponent,
    HkSelectComponent,
    HkToggleComponent,
    HkWaxSealComponent,
    IconComponent,
  ],
  providers: [provideTranslocoScope('settings')],
  templateUrl: './settings-appearance.component.html',
  styleUrl: './settings-appearance.component.scss',
})
export class SettingsAppearanceComponent {
  private readonly localeService = inject(LocaleService);
  private readonly themeService = inject(ThemeService);
  private readonly displayPrefs = inject(DisplayPrefsService);

  protected readonly themes = THEMES;
  protected readonly densities = DENSITIES;
  private readonly themeIds = THEMES.map((option) => option.id);
  protected readonly locale = this.localeService.locale;
  protected readonly theme = this.themeService.theme;
  protected readonly density = this.displayPrefs.density;
  protected readonly motion = this.displayPrefs.motion;

  protected selectTheme(theme: Theme): void {
    this.themeService.setTheme(theme);
  }

  protected selectDensity(density: Density): void {
    this.displayPrefs.setDensity(density);
  }

  protected setMotion(on: boolean): void {
    this.displayPrefs.setMotion(on);
  }

  // Live locale switch — `LocaleService.setLocale` itself activates Transloco's active lang
  // and re-renders with no page reload (see its own doc comment); nothing further is needed here.
  protected selectLocale(locale: string | null): void {
    if (LOCALES.includes(locale as Locale)) this.localeService.setLocale(locale as Locale);
  }

  protected languageOptions(t: Translate): SelectOption[] {
    return LOCALES.map((value) => ({ value, label: t(`language.${value}`) }));
  }

  protected onThemeKey(event: KeyboardEvent): void {
    this.moveRadio(event, this.themeIds, this.theme(), (theme) => this.selectTheme(theme));
  }

  protected onDensityKey(event: KeyboardEvent): void {
    this.moveRadio(event, DENSITIES, this.density(), (density) => this.selectDensity(density));
  }

  /**
   * Arrow keys move a radio group's selection the way a native group does: right and down go to
   * the next option, left and up to the previous, wrapping. The group's selected option is its one
   * tab stop (`tabindex`), so Tab leaves the group.
   */
  private moveRadio<T>(
    event: KeyboardEvent,
    options: readonly T[],
    current: T,
    pick: (value: T) => void,
  ): void {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !back) return;
    event.preventDefault();
    const at = options.indexOf(current);
    const next = options[(at + (forward ? 1 : -1) + options.length) % options.length];
    pick(next);
    const group = (event.currentTarget as HTMLElement | null)?.parentElement;
    queueMicrotask(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  }
}
