import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { BlobUrlPipe } from '@shared/pipes/blob-url.pipe';
import { EngineFacade } from '@shared/services/engine/engine.facade';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { PlaceholderService } from '@shared/services/images/placeholder.service';
import type { CharacterRow } from '@shared/services/storage/dexie.db';
import { IconComponent } from '@shared/icons/icon.component';
import { HkButtonComponent } from '../../../ui/button/button.component';
import { coarsePointer } from '../../../ui/coarse-pointer';
import { HkPortraitFrameComponent } from '../../../ui/portrait-frame/portrait-frame.component';
import { HkTagChipComponent } from '../../../ui/tag-chip/tag-chip.component';
import { HkTooltipDirective } from '../../../ui/tooltip/tooltip.directive';
import { heroClassLine } from '../hero-class-line';
import type { HeroSummary } from '../hero-summary.service';

export type HeroSyncBucket = 'synced' | 'pending' | 'connecting' | 'offline';

const SYNC_TONE = {
  synced: 'moss',
  pending: 'warning',
  connecting: 'neutral',
  offline: 'neutral',
} as const;

type ScopedT = (key: string, params?: Record<string, unknown>) => string;

/**
 * A hero as a card (board H01 / Home): portrait, name, class line, campaign chip, sync chip,
 * when it was last played, and Open. The whole card opens the hero (the Open button's hit area is
 * stretched over it) so a card is one big target; the "more" menu (heroes list only) sits above
 * it. Pure presentation: the screen owns the data (`HeroSummaryService`, `SyncService`) and what
 * Open and Delete do.
 */
@Component({
  selector: 'app-hero-card',
  imports: [
    TranslocoDirective,
    BlobUrlPipe,
    IconComponent,
    HkButtonComponent,
    HkPortraitFrameComponent,
    HkTagChipComponent,
    HkTooltipDirective,
  ],
  providers: [provideTranslocoScope('characters')],
  templateUrl: './hero-card.component.html',
  styleUrl: './hero-card.component.scss',
  host: {
    '(document:pointerdown)': 'onDocumentPress($event)',
    '(keydown.escape)': 'closeMenu(true)',
  },
})
export class HeroCardComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly engineFacade = inject(EngineFacade);
  private readonly localeService = inject(LocaleService);
  private readonly placeholderService = inject(PlaceholderService);

  // Inputs
  readonly row = input.required<CharacterRow>();
  readonly summary = input<HeroSummary | undefined>(undefined);
  readonly sync = input<{ bucket: HeroSyncBucket; count: number } | null>(null);
  /** Offers the "more" menu (the heroes list only). */
  readonly menu = input(false);
  /** The screen is busy (an import is running): Delete is unavailable. */
  readonly busy = input(false);

  // Outputs
  readonly opened = output<void>();
  readonly deleteRequested = output<void>();

  protected readonly touch = coarsePointer();
  protected readonly menuOpen = signal(false);
  private readonly moreButton = viewChild<ElementRef<HTMLButtonElement>>('more');
  private readonly firstItem = viewChild<ElementRef<HTMLButtonElement>>('firstItem');

  protected readonly initials = computed(
    () => this.placeholderService.monogram(this.row().name, this.row().id).initials,
  );

  protected readonly playedDate = computed(() =>
    new Intl.DateTimeFormat(this.localeService.locale(), { dateStyle: 'medium' }).format(
      this.row().updatedAt,
    ),
  );

  protected classLine(t: ScopedT): string {
    return heroClassLine(this.summary(), this.row().system, this.engineFacade.localizer(), t);
  }

  /** The Open button's accessible name: the hero plus every value the card shows. */
  protected openLabel(t: ScopedT): string {
    const details = [this.classLine(t), this.summary()?.campaign?.name]
      .filter((part): part is string => !!part)
      .join(', ');
    return t('list.card.openLabel', { name: this.row().name, details });
  }

  protected syncLabel(t: ScopedT): string {
    const state = this.sync();
    return state ? t(`list.sync.tooltip.${state.bucket}`, { count: state.count }) : '';
  }

  protected syncTone(): (typeof SYNC_TONE)[HeroSyncBucket] {
    return SYNC_TONE[this.sync()?.bucket ?? 'offline'];
  }

  protected toggleMenu(): void {
    if (this.menuOpen()) {
      this.closeMenu(false);
      return;
    }
    this.menuOpen.set(true);
    afterNextRender(() => this.firstItem()?.nativeElement.focus(), { injector: this.injector });
  }

  protected closeMenu(restoreFocus: boolean): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    if (restoreFocus) this.moreButton()?.nativeElement.focus();
  }

  protected onDocumentPress(event: Event): void {
    if (this.menuOpen() && !this.host.nativeElement.contains(event.target as Node)) {
      this.closeMenu(false);
    }
  }

  protected requestDelete(): void {
    if (this.busy()) return;
    this.closeMenu(false);
    this.deleteRequested.emit();
  }
}
