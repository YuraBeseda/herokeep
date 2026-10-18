import { Component, computed, inject, input, resource } from '@angular/core';
import type { Diagnostic } from '@hk/engine';
import type { Pack } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { formatBytes } from '@shared/helpers/format-bytes';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { entityCountRows, type PackSummary } from './pack-summary';

/**
 * The ADR-008 "enable screen" facts about one pack (:107-109 — declared overrides, asset count
 * and size, attribution — plus name/version/authors/license, entities by type, dependencies and
 * validation warnings). Shared by the trust dialog (an import preview) and the detail screen (an
 * installed pack), so both always show the same information.
 *
 * Pack-authored values (name, authors, license, ids, diagnostic codes/messages) are DATA from the
 * pack or the validator, rendered as-is; every label around them is a `packs` scope key. The
 * attribution goes through the sanitizing `MarkdownService` (ADR-008: no raw HTML).
 */
@Component({
  selector: 'app-pack-info',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('packs')],
  templateUrl: './pack-info.component.html',
  styleUrl: './pack-info.component.scss',
})
export class PackInfoComponent {
  private readonly localeService = inject(LocaleService);
  private readonly markdownService = inject(MarkdownService);

  readonly pack = input.required<Pack>();
  readonly summary = input.required<PackSummary>();
  readonly diagnostics = input<readonly Diagnostic[]>([]);

  protected readonly countRows = computed(() => entityCountRows(this.summary().entityCounts));
  protected readonly assetSize = computed(() =>
    formatBytes(this.summary().assetBytes, this.localeService.locale()),
  );
  protected readonly warnings = computed(() =>
    this.diagnostics().filter((d) => d.severity !== 'error'),
  );

  protected readonly attributionHtml = resource({
    params: () => this.pack().attribution,
    loader: ({ params }) => this.markdownService.render(params),
  });
}
