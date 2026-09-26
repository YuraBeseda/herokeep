import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ApiError } from '@shared/services/api/api-fetch';
import {
  CampaignStore,
  CampaignStoreNotAuthenticatedError,
  CampaignStoreNotLeaderError,
} from '@shared/stores/campaign.store';

// Scope-RELATIVE keys (no `campaigns.` prefix) — the template renders every static string under
// `*transloco="let t; read: 'campaigns'"`, which already prepends that prefix itself; a
// fully-qualified key rendered through the SAME `t()` would be double-prefixed
// (`campaigns.campaigns.join...`). `CampaignStoreNotLeaderError`/`NotAuthenticatedError`'s own
// `.code` (fully-qualified, shared with `ToastService.show` elsewhere, which always resolves
// GLOBAL keys) are stripped of that same prefix in `toErrorKey` below for the identical reason.
const JOIN_ERROR_KEYS: Readonly<Partial<Record<string, string>>> = {
  not_found: 'join.errors.invalidCode',
  forbidden: 'join.errors.closed',
  limit_exceeded: 'join.errors.full',
  network_error: 'join.errors.network',
};

const CAMPAIGNS_SCOPE_PREFIX = /^campaigns\./;

function toBareId(streamId: string): string {
  return streamId.startsWith('camp:') ? streamId.slice('camp:'.length) : streamId;
}

/**
 * `/join` and `/join/:code` (plan-10 task-6-brief.md, ruling 10): the "join screen" the join-code
 * QR/link ultimately points at. Handles BOTH entry points with one component — a route param
 * (`/join/:code`, the QR/link target) pre-fills the code field; the bare `/join` route (reached
 * from `CampaignsListComponent`'s own "Join campaign" button) starts blank. Reads sloppy input
 * (whitespace, lowercase, a dash the user typed or that a copy-pasted grouped display included) —
 * "the join form should accept sloppy input and let the server normalize" (task-6-brief.md's
 * binding "Plan facts"): only trims before sending, never re-implements the server's own
 * uppercase/dash-strip normalization.
 *
 * A dedicated ROUTE rather than a dialog (unlike `CreateCampaignDialogComponent`) — the brief's
 * "deep link `/join/:code` ... pre-filling the join screen" needs a real navigable URL a QR
 * code/shared link can point at without first landing on `/campaigns` and imperatively opening an
 * overlay.
 */
@Component({
  selector: 'app-join',
  imports: [TranslocoDirective, ButtonComponent, RouterLink],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './join.component.html',
  styleUrl: './join.component.scss',
})
export class JoinComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly campaignStore = inject(CampaignStore);

  protected readonly code = signal(
    this.route.snapshot.paramMap.get('code') ?? this.route.snapshot.queryParamMap.get('code') ?? '',
  );
  protected readonly displayName = signal('');
  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | undefined>(undefined);

  protected readonly canSubmit = computed(
    () => this.code().trim().length > 0 && !this.submitting(),
  );

  protected onCodeChange(value: string): void {
    this.code.set(value);
  }

  protected onDisplayNameChange(value: string): void {
    this.displayName.set(value);
  }

  protected async confirm(): Promise<void> {
    if (!this.canSubmit()) return;
    const code = this.code().trim();
    const displayName = this.displayName().trim();

    this.errorKey.set(undefined);
    this.submitting.set(true);
    try {
      const streamId = await this.campaignStore.join(code, displayName || undefined);
      await this.router.navigate(['/g', toBareId(streamId), 'lobby']);
    } catch (err) {
      this.errorKey.set(this.toErrorKey(err));
    } finally {
      this.submitting.set(false);
    }
  }

  private toErrorKey(err: unknown): string {
    if (
      err instanceof CampaignStoreNotLeaderError ||
      err instanceof CampaignStoreNotAuthenticatedError
    ) {
      return err.code.replace(CAMPAIGNS_SCOPE_PREFIX, '');
    }
    if (err instanceof ApiError) {
      return JOIN_ERROR_KEYS[err.code ?? ''] ?? 'join.errors.generic';
    }
    return 'join.errors.generic';
  }
}
