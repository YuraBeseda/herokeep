import { Component, computed, inject, signal } from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ToastService } from '@shared/components/toast/toast.service';
import {
  CampaignStore,
  CampaignStoreNotAuthenticatedError,
  CampaignStoreNotLeaderError,
} from '@shared/stores/campaign.store';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { HkTooltipDirective } from '../../../ui/tooltip/tooltip.directive';

/**
 * The encounter plate (boards C06 party header, C09 table session strip; plan 18 task 2): "No
 * encounter" or "Encounter 2 · Round 3". The DM gets Start / Advance round / End; a player only
 * reads it. Provides its own `campaigns` transloco scope.
 */
@Component({
  selector: 'app-encounter-plate',
  imports: [TranslocoDirective, HkButtonComponent, HkTooltipDirective],
  providers: [provideTranslocoScope('campaigns')],
  template: `
    <div
      class="encounter-plate"
      role="group"
      *transloco="let t; read: 'campaigns.encounter'"
      [attr.aria-label]="t('label')"
    >
      <span class="encounter-plate__reading" role="status">
        @if (encounter(); as e) {
          {{ t('running', { number: e.number, round: e.round }) }}
        } @else {
          {{ t('none') }}
        }
      </span>
      @if (isDm()) {
        @if (encounter()) {
          <button hk-button type="button" [loading]="busy()" (click)="run('advance')">
            {{ t('advance') }}
          </button>
          <button
            hk-button
            type="button"
            [variant]="'ghost-leather'"
            [hkTooltip]="t('endHint')"
            [disabled]="busy()"
            (click)="run('end')"
          >
            {{ t('end') }}
          </button>
        } @else {
          <button hk-button type="button" [loading]="busy()" (click)="run('start')">
            {{ t('start') }}
          </button>
        }
      } @else if (encounter()) {
        <span class="encounter-plate__hint">{{ t('dmOnly') }}</span>
      }
    </div>
  `,
  styles: `
    .encounter-plate {
      display: flex;
      flex-wrap: wrap;
      gap: var(--hk-space-2, 8px);
      align-items: center;
    }

    .encounter-plate__reading {
      font-weight: 600;
    }

    .encounter-plate__hint {
      font-size: 0.875em;
      opacity: 0.8;
    }
  `,
})
export class EncounterPlateComponent {
  private readonly campaignStore = inject(CampaignStore);
  private readonly toastService = inject(ToastService);

  protected readonly encounter = this.campaignStore.encounter;
  protected readonly isDm = computed(() => this.campaignStore.role() === 'dm');
  protected readonly busy = signal(false);

  protected async run(action: 'start' | 'advance' | 'end'): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      if (action === 'start') await this.campaignStore.startEncounter();
      else if (action === 'advance') await this.campaignStore.advanceRound();
      else await this.campaignStore.endEncounter();
    } catch (err) {
      this.toastService.show(
        err instanceof CampaignStoreNotLeaderError ||
          err instanceof CampaignStoreNotAuthenticatedError
          ? err.code
          : 'campaigns.encounter.error',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
