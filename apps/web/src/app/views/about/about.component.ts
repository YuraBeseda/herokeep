import { Component } from '@angular/core';
import { ATTRIBUTION } from '@hk/content/attribution';
import { provideTranslocoScope, TranslocoDirective } from '@jsverse/transloco';
import { CardComponent } from '@shared/components/card/card.component';
// Static asset (also served at `/assets/icons/authors.json`), imported directly as a TS module —
// same `resolveJsonModule` pattern as `@hk/content/icons` in engine.facade.ts — because the
// author list is small, non-localized, and needed synchronously for the composed credit line.
import authorsJson from '../../../assets/icons/authors.json';

// Mirrors the app's own release version (see MEMORY.md / the `v0.1.0-plan1` tag and the content
// pack's own `PACK_VERSION`) — `apps/web/package.json`'s `version` field is still the Angular CLI
// scaffold default ("0.0.0") and is not (yet) wired to any release process, so it is not a
// reliable source for this; this constant is the one to bump when that changes.
const APP_VERSION = '0.1.0';

function humanizeAuthor(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

@Component({
  selector: 'app-about',
  imports: [TranslocoDirective, CardComponent],
  providers: [provideTranslocoScope('shell'), provideTranslocoScope('about')],
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss',
})
export class AboutComponent {
  // Template-facing state
  protected readonly appVersion = APP_VERSION;
  // Rendered verbatim from its imported source value — never copied into a translation string —
  // per the CC-BY-4.0 attribution requirement (docs/04-reference/legal-attribution.md).
  protected readonly attribution = ATTRIBUTION;
  // Always English (a legal statement — see about/en.json's `icons.credit`), regardless of the
  // active UI locale: the author list itself is joined with the English list-format ('and'), not
  // the current locale's.
  protected readonly authorsList = new Intl.ListFormat('en').format(
    (authorsJson as readonly string[]).map(humanizeAuthor),
  );
}
