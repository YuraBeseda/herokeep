/** The first path segment of an app URL, mapped to the section the login notice names. */
const SECTION_BY_SEGMENT: Readonly<Record<string, string>> = {
  g: 'campaigns',
  campaigns: 'campaigns',
  c: 'heroes',
  characters: 'heroes',
  library: 'library',
  packs: 'packs',
  settings: 'settings',
};

/**
 * Whether `?returnUrl=` is a same-app path (it starts with one slash; a protocol-relative
 * `//host/…` is not), the only kind login will ever navigate to.
 */
export function isSameAppPath(url: string | null): url is string {
  return !!url && url.startsWith('/') && !url.startsWith('//');
}

/**
 * Which section the person was sent from when `authGuard` redirected them to log in, as the key
 * the notice's `select` uses (`campaigns`, `heroes`, `library`, `packs`, `settings`), or `other`
 * for any other same-app page. `null` when there is no usable return URL (a plain visit).
 */
export function returnSection(url: string | null): string | null {
  if (!isSameAppPath(url)) return null;
  const segment = url.split(/[/?#]/)[1] ?? '';
  return SECTION_BY_SEGMENT[segment] ?? 'other';
}
