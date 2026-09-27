import { Component, input } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import type { CampaignEditLockMode } from '@shared/services/campaigns/campaign-edit-lock';

/**
 * Plan-10 task-14-brief.md, ruling 7: the explanatory banner a member's play/build tab shows while
 * `editLocked` (see `CampaignEditLockService`). Its OWN `provideTranslocoScope('campaigns')` +
 * `*transloco="let t; read: 'campaigns'"` — the SAME "small standalone component, own scope"
 * pattern `CampaignChipComponent` (task-7) already establishes for embedding a `campaigns`-scoped
 * snippet inside a `characters`-scoped host template (task-14-brief.md's own i18n-scope ruling:
 * "keep keys in campaigns scope, the sheet components can read cross-scope via [this pattern]").
 *
 * Renders nothing when `mode()` is `undefined` (not locked) — every mutating-action host still
 * unconditionally embeds `<app-campaign-edit-lock-banner [mode]="editLock().mode" />`, so the
 * DM-exempt/solo/free/session-active cases (where `editLock().locked` is `false`) simply show no
 * banner, no `@if` needed at the call site.
 */
@Component({
  selector: 'app-campaign-edit-lock-banner',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './campaign-edit-lock-banner.component.html',
  styleUrl: './campaign-edit-lock-banner.component.scss',
})
export class CampaignEditLockBannerComponent {
  readonly mode = input<CampaignEditLockMode | undefined>(undefined);
}
