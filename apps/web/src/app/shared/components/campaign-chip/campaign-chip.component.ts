import { Component, computed, inject, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { ButtonComponent } from '@shared/components/button/button.component';
import { DialogService } from '@shared/components/dialog/dialog.service';
import { campaignIdOfCharacter } from '@shared/services/campaigns/character-campaign-link';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CharacterStore } from '@shared/stores/character.store';
import { LeaveCampaignDialogComponent } from './leave-campaign-dialog.component';

/**
 * Plan-10 task-7-brief.md: "character sheet header shows the campaign chip ... leave action lives
 * in the chip menu or sheet (your call, document)". Embedded directly in
 * `SheetShellComponent`'s header (`<app-campaign-chip />`, no inputs) — it reads the app-wide
 * `CharacterStore` singleton straight off its own injector, the SAME "currently loaded stream"
 * convention `SheetShellComponent` itself already uses for `sheet`/`facts`/`streamId` — safe here
 * because this component is only ever rendered while a character sheet route (`characterResolver`)
 * has already loaded that exact character.
 *
 * Renders NOTHING (`ng-container`, no host markup at all) when `campaignIdOfCharacter` reads
 * `undefined` — a solo/never-joined character's sheet looks exactly as it did before this task.
 *
 * Judgment call: leave lives as a plain inline button next to the chip text, not a dropdown menu —
 * this repo has no existing menu/popover component to reach for, and a single action doesn't
 * justify building one just for this. `LeaveCampaignDialogComponent` (this same folder) does the
 * actual reverse ruling-4 sequence with its own per-step retry UI.
 */
@Component({
  selector: 'app-campaign-chip',
  imports: [TranslocoDirective, RouterLink, ButtonComponent],
  providers: [provideTranslocoScope('campaigns')],
  templateUrl: './campaign-chip.component.html',
  styleUrl: './campaign-chip.component.scss',
})
export class CampaignChipComponent {
  private readonly characterStore = inject(CharacterStore);
  private readonly campaignsRepository = inject(CampaignsRepository);
  private readonly dialogService = inject(DialogService);

  /** `undefined` for a solo/never-joined character, or one whose last relevant event was a
   * `campaign_left` — including, reactively, the MOMENT `LeaveCampaignDialogComponent`'s own
   * ruling-4 step (a) commits (this chip disappears before step (b) even finishes; see that
   * component's own class doc for why that's the correct, doc-03-faithful moment to do so). */
  protected readonly campaignId = computed(() =>
    campaignIdOfCharacter(this.characterStore.events()),
  );

  private readonly campaignRowResource = resource({
    params: () => this.campaignId(),
    loader: ({ params: id }) =>
      id ? this.campaignsRepository.get(id) : Promise.resolve(undefined),
  });

  protected readonly campaignName = computed(() => this.campaignRowResource.value()?.name);

  protected async leave(): Promise<void> {
    const campaignId = this.campaignId();
    const characterId = this.characterStore.streamId();
    const characterName = this.characterStore.facts()?.name;
    if (!campaignId || !characterId || characterName === undefined) return;

    const handle = this.dialogService.open(LeaveCampaignDialogComponent, {
      data: { campaignId, characterId, characterName },
    });
    await handle.closed;
  }
}
