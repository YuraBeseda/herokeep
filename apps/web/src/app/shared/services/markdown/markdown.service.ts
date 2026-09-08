import { inject, Injectable } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import type { Localizer } from '@hk/engine';
import type { Marked, Token } from 'marked';
import type { DOMPurify as DOMPurifyInstance } from 'dompurify';
import { EngineFacade } from '../engine/engine.facade';

// Matches `[[<anything but "]">]]` cross-reference tokens in pack-authored markdown. The
// captured text is treated as an entity id and resolved via the localizer below — see
// `resolveCrossLinks`.
const CROSS_LINK_RE = /\[\[([^\]]+)\]\]/g;

// Sanitizer allowlist — exact per the task brief. Nothing else is safe against pack- or
// translation-pack-authored markdown becoming a script/style/event-handler injection vector.
const ALLOWED_TAGS = [
  'p',
  'br',
  'em',
  'strong',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'code',
  'pre',
  'a',
];
const ALLOWED_ATTR = ['href', 'data-entity-id'];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Replaces every `[[<entity-id>]]` token in `markdown` with a raw `<a data-entity-id="…">` anchor
 * BEFORE `marked` ever sees the text. `marked` passes inline HTML through unmodified (no
 * "sanitize" option since v1 — that responsibility moved to the consumer), and DOMPurify running
 * after it is what actually makes the injected markup safe. A recognized id gets its localized
 * name as link text; an id the localizer doesn't know keeps the raw id as its own text (so a
 * stale cross-reference is visibly a stale reference in the rendered page, not a silent no-op),
 * but is still linkified with the same `data-entity-id` attribute either way.
 */
function resolveCrossLinks(markdown: string, localizer: Localizer): string {
  return markdown.replace(CROSS_LINK_RE, (_match, id: string) => {
    const name = localizer.name(id);
    const text = escapeHtml(name.length > 0 ? name : id);
    return `<a data-entity-id="${escapeHtml(id)}">${text}</a>`;
  });
}

/**
 * `marked`'s `walkTokens` hook, used to shift every heading level down by one (h1 → h2, h2 → h3,
 * …) so pack-authored markdown can never render an h1 inside the page's own heading outline. A
 * source heading past h5 shifts to an h6+ tag that isn't in `ALLOWED_TAGS`; DOMPurify then drops
 * the tag but keeps its text (its default behavior for a disallowed, non-dangerous element).
 */
function shiftHeadings(token: Token): void {
  if (token.type === 'heading') token.depth += 1;
}

/**
 * Post-sanitize DOM pass (runs after DOMPurify, per the task brief): every external `http(s)`
 * link gets `rel="noopener noreferrer" target="_blank"`; every entity cross-link anchor
 * (`data-entity-id`) is stripped of any `href` — navigation for those is handled entirely by the
 * detail component's delegated click listener, never by native anchor navigation.
 */
function postProcessLinks(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const anchor of doc.querySelectorAll('a[href^="http"]')) {
    anchor.setAttribute('rel', 'noopener noreferrer');
    anchor.setAttribute('target', '_blank');
  }
  for (const anchor of doc.querySelectorAll('a[data-entity-id]')) {
    anchor.removeAttribute('href');
  }
  return doc.body.innerHTML;
}

/**
 * Renders pack-authored markdown (entity `description`/`higherLevels`/… fields) into sanitized,
 * `SafeHtml` ready for `[innerHTML]`. `marked` and `dompurify` are dynamically imported on first
 * use and cached on the instance — this keeps both libraries out of the app's initial bundle;
 * they load only once a library detail page actually renders a description (see
 * task-12-report.md for the built lazy-chunk evidence).
 */
@Injectable({ providedIn: 'root' })
export class MarkdownService {
  private readonly domSanitizer = inject(DomSanitizer);
  private readonly engineFacade = inject(EngineFacade);

  private markedPromise?: Promise<Marked>;
  private dompurifyPromise?: Promise<DOMPurifyInstance>;

  async render(markdown: string): Promise<SafeHtml> {
    const [marked, DOMPurify] = await Promise.all([this.loadMarked(), this.loadDompurify()]);

    const withCrossLinks = resolveCrossLinks(markdown, this.engineFacade.localizer());
    const rawHtml = await marked.parse(withCrossLinks);
    const sanitized = DOMPurify.sanitize(rawHtml, { ALLOWED_TAGS, ALLOWED_ATTR });
    const finalHtml = postProcessLinks(sanitized);
    return this.domSanitizer.bypassSecurityTrustHtml(finalHtml);
  }

  private loadMarked(): Promise<Marked> {
    this.markedPromise ??= import('marked').then(
      ({ Marked }) => new Marked({ gfm: true, breaks: false, walkTokens: shiftHeadings }),
    );
    return this.markedPromise;
  }

  private loadDompurify(): Promise<DOMPurifyInstance> {
    this.dompurifyPromise ??= import('dompurify').then((module) => module.default);
    return this.dompurifyPromise;
  }
}
