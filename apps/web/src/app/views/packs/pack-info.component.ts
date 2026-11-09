import { Component, computed, inject, input, resource, ViewEncapsulation } from '@angular/core';
import type { Diagnostic } from '@hk/engine';
import type { Pack } from '@hk/protocol';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import semver from 'semver';
import { formatBytes } from '@shared/helpers/format-bytes';
import { LocaleService } from '@shared/services/i18n/locale.service';
import { MarkdownService } from '@shared/services/markdown/markdown.service';
import { PackStore } from '@shared/stores/pack.store';
import { HkTagChipComponent } from '../../ui/tag-chip/tag-chip.component';
import { entityCountRows, type PackSummary } from './pack-summary';

/** A dependency row: the required pack, its range, and the installed version that satisfies it. */
interface DependencyView {
  readonly id: string;
  readonly name: string;
  readonly range: string;
  readonly installed: string | null;
}

/**
 * The ADR-008 "enable screen" facts about one pack (:107-109 — declared overrides, asset count
 * and size, attribution — plus name/version/authors/license, entities by type, dependencies and
 * validation warnings), as the PK02/PK03 boards lay them out: a key/value block, a tile grid of
 * entities by type, the overrides line, the attribution. Shared by the trust dialog (an import
 * preview) and the detail screen (an installed pack), so both always show the same information.
 *
 * Pack-authored values (name, authors, license, ids, diagnostic codes/messages) are DATA from the
 * pack or the validator, rendered as-is; every label around them is a `packs` scope key. The
 * attribution goes through the sanitizing `MarkdownService` (ADR-008: no raw HTML).
 *
 * `ViewEncapsulation.None`: the attribution's links are `[innerHTML]` content, which emulated
 * encapsulation cannot style (the repo uses no `::ng-deep`); every selector in the stylesheet is
 * prefixed by `app-pack-info` / `pack-info__`, so nothing leaks.
 */
@Component({
  selector: 'app-pack-info',
  imports: [TranslocoDirective, HkTagChipComponent],
  providers: [provideTranslocoScope('packs')],
  templateUrl: './pack-info.component.html',
  styleUrl: './pack-info.component.scss',
  encapsulation: ViewEncapsulation.None,
})
export class PackInfoComponent {
  private readonly localeService = inject(LocaleService);
  private readonly markdownService = inject(MarkdownService);
  private readonly packStore = inject(PackStore);

  readonly pack = input.required<Pack>();
  readonly summary = input.required<PackSummary>();
  readonly diagnostics = input<readonly Diagnostic[]>([]);
  /** The trust dialog's file facts (name and bytes); absent for an installed pack. */
  readonly file = input<{ readonly name: string; readonly size: number } | null>(null);

  protected readonly countRows = computed(() => entityCountRows(this.summary().entityCounts));
  protected readonly entryTotal = computed(() =>
    this.countRows().reduce((sum, row) => sum + row.count, 0),
  );
  protected readonly assetSize = computed(() =>
    formatBytes(this.summary().assetBytes, this.localeService.locale()),
  );
  protected readonly fileSize = computed(() => {
    const file = this.file();
    return file ? formatBytes(file.size, this.localeService.locale()) : null;
  });
  protected readonly warnings = computed(() =>
    this.diagnostics().filter((d) => d.severity !== 'error'),
  );

  protected readonly dependencies = computed<readonly DependencyView[]>(() => {
    const core = this.packStore.corePack();
    const installed = core ? [core, ...this.packStore.installedContent()] : [];
    return this.summary().dependencies.map((dep) => {
      const range = semver.validRange(dep.range);
      const matches = installed
        .filter((p) => p.id === dep.id && range !== null && semver.satisfies(p.version, range))
        .sort((a, b) => semver.rcompare(a.version, b.version));
      return {
        id: dep.id,
        name: installed.find((p) => p.id === dep.id)?.name ?? dep.id,
        range: dep.range,
        installed: matches[0]?.version ?? null,
      };
    });
  });

  protected readonly attributionHtml = resource({
    params: () => this.pack().attribution,
    loader: ({ params }) => this.markdownService.render(params),
  });
}
