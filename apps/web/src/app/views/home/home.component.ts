import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  resource,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { BlobUrlPipe } from '@shared/pipes/blob-url.pipe';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { PlaceholderService } from '@shared/services/images/placeholder.service';
import { CampaignsRepository } from '@shared/services/storage/campaigns.repository';
import { CharactersRepository } from '@shared/services/storage/characters.repository';
import { SettingsRepository } from '@shared/services/storage/settings.repository';
import { ActionStrapService } from '../../ui/action-strap/action-strap.service';
import { HkButtonComponent } from '../../ui/button/button.component';
import { HkLeafComponent } from '../../ui/leaf/leaf.component';
import { HkPortraitFrameComponent } from '../../ui/portrait-frame/portrait-frame.component';
import { HkTagChipComponent } from '../../ui/tag-chip/tag-chip.component';
import { HkTooltipDirective } from '../../ui/tooltip/tooltip.directive';
import { HeroCardComponent } from '../characters/hero-card/hero-card.component';
import { heroClassLine } from '../characters/hero-class-line';
import { HERO_IMPORT_ACCEPT, HeroImportFlow } from '../characters/hero-import.flow';
import { HeroSummaryService, type HeroSummary } from '../characters/hero-summary.service';

/** The heroes row shows this many cards; the rest are one press away on the heroes list. */
const HEROES_ROW_LIMIT = 4;

type ScopedT = (key: string, params?: Record<string, unknown>) => string;

/**
 * Home (spec §10, boards IA-Home-*): a "Continue" leaf for the hero opened last (or the newest hero
 * when none was opened yet), a heroes row, a campaigns row and the Library quick action. First run
 * (no heroes) swaps Continue for an invitation. The strap's zone 2 carries New hero, Import and
 * Join by code; Import opens this screen's hidden `.hero` file input and hands the file to the
 * shared `HeroImportFlow`.
 *
 * What Home does not show: the "Tonight" slip for a campaign with a live session. No cheap,
 * read-only signal for it exists outside an OPEN campaign (`CampaignStore` holds one campaign at a
 * time), and this task adds no sync features — the slot is left out until one exists.
 */
@Component({
  selector: 'app-home',
  imports: [
    TranslocoDirective,
    BlobUrlPipe,
    HkButtonComponent,
    HkLeafComponent,
    HkPortraitFrameComponent,
    HkTagChipComponent,
    HkTooltipDirective,
    HeroCardComponent,
  ],
  providers: [provideTranslocoScope('shell'), provideTranslocoScope('characters')],
  styleUrl: './home.component.scss',
  templateUrl: './home.component.html',
})
export class HomeComponent {
  private readonly router = inject(Router);
  private readonly actionStrap = inject(ActionStrapService);
  private readonly charactersRepository = inject(CharactersRepository);
  private readonly campaignsRepository = inject(CampaignsRepository);
  private readonly settingsRepository = inject(SettingsRepository);
  private readonly heroSummaryService = inject(HeroSummaryService);
  private readonly heroImportFlow = inject(HeroImportFlow);
  private readonly engineFacade = inject(EngineFacade);
  private readonly localeService = inject(LocaleService);
  private readonly placeholderService = inject(PlaceholderService);

  private readonly heroesResource = resource({ loader: () => this.charactersRepository.list() });
  private readonly lastOpenedResource = resource({
    loader: () => this.settingsRepository.getLastOpened(),
  });
  private readonly campaignsResource = resource({
    loader: () => this.campaignsRepository.list(),
  });

  /** Every hero, newest first (the repository's own order). */
  protected readonly heroes = computed(() => this.heroesResource.value() ?? []);
  protected readonly campaigns = computed(() => this.campaignsResource.value() ?? []);
  /** Nothing is decided (invitation vs Continue) until both reads have settled. */
  protected readonly ready = computed(
    () => !this.heroesResource.isLoading() && !this.lastOpenedResource.isLoading(),
  );

  /**
   * The hero Continue offers. The hero opened last when it still exists; when one was opened but
   * has since been deleted, nothing (Continue hides rather than guessing); when none was ever
   * opened, the most recently changed hero.
   */
  protected readonly continueHero = computed(() => {
    const heroes = this.heroes();
    const last = this.lastOpenedResource.value();
    if (last) return heroes.find((hero) => hero.id === last.id);
    return heroes[0];
  });

  protected readonly rowHeroes = computed(() => this.heroes().slice(0, HEROES_ROW_LIMIT));

  private readonly summaryResource = resource({
    params: () => this.heroes().map((hero) => hero.id),
    loader: ({ params }) => this.heroSummaryService.summarize(params),
  });
  protected readonly summaries = computed(
    () => this.summaryResource.value() ?? new Map<string, HeroSummary>(),
  );

  protected readonly continueSummary = computed(() => {
    const hero = this.continueHero();
    return hero ? this.summaries().get(hero.id) : undefined;
  });
  protected readonly continueInitials = computed(() => {
    const hero = this.continueHero();
    return hero ? this.placeholderService.monogram(hero.name, hero.id).initials : '';
  });
  protected readonly continuePlayed = computed(() => {
    const hero = this.continueHero();
    return hero
      ? new Intl.DateTimeFormat(this.localeService.locale(), { dateStyle: 'medium' }).format(
          hero.updatedAt,
        )
      : '';
  });

  protected readonly importAccept = HERO_IMPORT_ACCEPT;
  private readonly importInput = viewChild<ElementRef<HTMLInputElement>>('importInput');
  protected readonly importing = this.heroImportFlow.importing;

  constructor() {
    // Zone 2: New hero · Import · Join by code (spec §3 and §10). Re-set when `importing`
    // changes; Home has no zone 3. No `scope`: the strap leaves with the path.
    effect(() => {
      const importing = this.importing();
      this.actionStrap.set({
        primary: [
          {
            id: 'new-hero',
            label: 'shell.strap.new-hero',
            icon: 'add',
            kind: 'primary',
            run: () => this.go(['/characters/new']),
          },
          {
            id: 'import',
            label: 'shell.strap.import',
            icon: 'import',
            kind: 'parchment',
            disabled: importing,
            run: () => this.importInput()?.nativeElement.click(),
          },
          {
            id: 'join-code',
            label: 'shell.strap.join-code',
            icon: 'join',
            kind: 'parchment',
            run: () => this.go(['/join']),
          },
        ],
      });
    });
    inject(DestroyRef).onDestroy(() => this.actionStrap.clear());
  }

  protected go(commands: string[]): void {
    void this.router.navigate(commands);
  }

  protected openHero(id: string): void {
    void this.router.navigate(['/c', id]);
  }

  protected classLine(t: ScopedT): string {
    const hero = this.continueHero();
    if (!hero) return '';
    return heroClassLine(this.continueSummary(), hero.system, this.engineFacade.localizer(), t);
  }

  /** The Open button's accessible name: the hero plus every value the leaf shows. */
  protected openLabel(t: ScopedT): string {
    const hero = this.continueHero();
    if (!hero) return '';
    const details = [this.classLine(t), this.continueSummary()?.campaign?.name]
      .filter((part): part is string => !!part)
      .join(', ');
    return t('list.card.openLabel', { name: hero.name, details });
  }

  protected async onImportFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so picking the same file again still fires `change`.
    input.value = '';
    if (!file) return;
    const result = await this.heroImportFlow.importFile(file);
    if (result) {
      this.heroesResource.reload();
      this.lastOpenedResource.reload();
    }
  }
}
