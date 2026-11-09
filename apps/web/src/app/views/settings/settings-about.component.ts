import { Component, computed, inject } from '@angular/core';
import { ATTRIBUTION } from '@hk/content/attribution';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { APP_RELEASE_DATE, APP_VERSION } from '@app/version';
import { LocaleService } from '@shared/services/i18n/locale.service';
// Static asset (also served at `/assets/icons/authors.json`), imported directly as a TS module —
// same `resolveJsonModule` pattern as `@hk/content/icons` in engine.facade.ts — because the
// author list is small, non-localized, and needed synchronously for the composed credit line.
import authorsJson from '../../../assets/icons/authors.json';
import { HkLeafComponent } from '../../ui/leaf/leaf.component';
import { HkTagChipComponent } from '../../ui/tag-chip/tag-chip.component';
import { HkTooltipDirective } from '../../ui/tooltip/tooltip.directive';

function humanizeAuthor(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Settings, About & licences (board ST01): the former `/about` screen, folded in. The SRD
 * attribution, the Open5e credit, the icon authors from `assets/icons/authors.json`, the fonts, and
 * the version and release date. `/about` redirects here (`#about`).
 */
@Component({
  selector: 'app-settings-about',
  imports: [TranslocoDirective, HkLeafComponent, HkTagChipComponent, HkTooltipDirective],
  providers: [provideTranslocoScope('settings')],
  templateUrl: './settings-about.component.html',
  styleUrl: './settings-about.component.scss',
})
export class SettingsAboutComponent {
  private readonly localeService = inject(LocaleService);

  protected readonly appVersion = APP_VERSION;
  // Rendered verbatim from its imported source value — never copied into a translation string —
  // per the CC-BY-4.0 attribution requirement (docs/04-reference/legal-attribution.md).
  protected readonly attribution = ATTRIBUTION;
  // Always English (a legal statement — see the `about.icons-credit` key), regardless of the
  // active UI locale: the author list itself is joined with the English list-format ('and'), not
  // the current locale's.
  protected readonly authorsList = new Intl.ListFormat('en').format(
    (authorsJson as readonly string[]).map(humanizeAuthor),
  );
  protected readonly releaseDate = computed(() =>
    new Intl.DateTimeFormat(this.localeService.locale(), {
      dateStyle: 'long',
      timeZone: 'UTC',
    }).format(new Date(APP_RELEASE_DATE)),
  );
  protected readonly installed =
    typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
}
