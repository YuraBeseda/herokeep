import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { AuthService } from '@shared/services/auth/auth.service';
import { IconComponent } from '../../shared/icons/icon.component';
import { HkThemeMenuComponent } from '../theme-menu/theme-menu.component';
import { HkTooltipDirective } from '../tooltip/tooltip.directive';
import { ShellCampaignContext } from './campaign-context.service';
import { currentSection } from './current-section';
import { SECTIONS, sectionNameKey } from './sections';

/**
 * `hk-nav-rail` — the top brass rail on tablet and desktop (design-system NavRail, spec §2.2):
 * the wordmark (the mark alone below 1024 px), the six section links as brass icon buttons with
 * hints, then on the right the campaign chip (when a campaign is open or the open hero is linked),
 * the theme menu and the account button (Settings when signed in, Log in when not). The rail never
 * wraps. Render it only on tablet/desktop; the phone has the top bar and drawer instead.
 *
 * About stays a link here until the About section moves into Settings (B12).
 */
@Component({
  selector: 'hk-nav-rail',
  imports: [
    RouterLink,
    RouterLinkActive,
    TranslocoDirective,
    IconComponent,
    HkTooltipDirective,
    HkThemeMenuComponent,
  ],
  providers: [provideTranslocoScope('shell')],
  templateUrl: './nav-rail.component.html',
  styleUrl: './nav-rail.component.scss',
})
export class HkNavRailComponent {
  protected readonly auth = inject(AuthService);
  protected readonly campaign = inject(ShellCampaignContext).current;

  protected readonly current = currentSection();
  protected readonly sections = SECTIONS;
  protected readonly nameKey = sectionNameKey;
}
