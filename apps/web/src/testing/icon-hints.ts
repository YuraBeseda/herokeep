/**
 * The hint rule (plan 17, design-system README "Iconography"): every icon-only control has an
 * accessible name and a tooltip. This lint reads Angular templates and reports
 *  - an `hk-icon-button` without a `hint` input (the `ui/icon-button` API, which turns the hint
 *    into both `aria-label` and tooltip), and
 *  - a `<button>` whose only child is an `<hk-icon>` and which has no `aria-label`.
 */
export interface HintViolation {
  rule: 'icon-button-needs-hint' | 'icon-only-button-needs-aria-label';
  snippet: string;
}

const BUTTON_OPEN_RE = /<(?:button|hk-icon-button)\b([^>]*)>/g;
const ICON_ONLY_BUTTON_RE =
  /<button\b([^>]*)>\s*<hk-icon\b[^>]*?(?:\/>|>\s*<\/hk-icon>)\s*<\/button>/g;
const HK_ICON_BUTTON_ATTR_RE = /(?:^|\s)hk-icon-button(?=[\s=/]|$)/;
const HINT_ATTR_RE = /(?:^|\s)\[?hint\]?\s*=/;
const ARIA_LABEL_ATTR_RE = /(?:^|\s)(?:aria-label|\[attr\.aria-label\]|\[aria-label\])\s*=/;

export function findHintViolations(template: string): HintViolation[] {
  const violations: HintViolation[] = [];

  for (const match of template.matchAll(BUTTON_OPEN_RE)) {
    const attrs = match[1];
    const isIconButton =
      match[0].startsWith('<hk-icon-button') || HK_ICON_BUTTON_ATTR_RE.test(attrs);
    if (isIconButton && !HINT_ATTR_RE.test(attrs)) {
      violations.push({ rule: 'icon-button-needs-hint', snippet: match[0] });
    }
  }

  for (const match of template.matchAll(ICON_ONLY_BUTTON_RE)) {
    if (!ARIA_LABEL_ATTR_RE.test(match[1])) {
      violations.push({ rule: 'icon-only-button-needs-aria-label', snippet: match[0] });
    }
  }

  return violations;
}
