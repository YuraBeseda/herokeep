import { UI_ICONS, type UiIconName } from '../icons/vocabulary';

export interface ShellSection {
  readonly id: string;
  readonly icon: UiIconName;
  readonly route: string;
  /** Matches only the exact route (Home would otherwise match everything). */
  readonly exact: boolean;
  /** Route prefixes that belong to the section, for the phone top bar's title. */
  readonly owns: readonly string[];
}

/** The six sections of the app map (spec §2.1), in rail and drawer order. */
export const SECTIONS: readonly ShellSection[] = [
  { id: 'home', icon: 'home', route: '/', exact: true, owns: [] },
  { id: 'heroes', icon: 'heroes', route: '/characters', exact: false, owns: ['/characters', '/c'] },
  {
    id: 'campaigns',
    icon: 'campaigns',
    route: '/campaigns',
    exact: false,
    owns: ['/campaigns', '/g'],
  },
  { id: 'library', icon: 'library', route: '/library', exact: false, owns: ['/library'] },
  { id: 'packs', icon: 'packs', route: '/packs', exact: false, owns: ['/packs'] },
  {
    id: 'settings',
    icon: 'settings',
    route: '/settings',
    exact: false,
    owns: ['/settings', '/about'],
  },
];

/** Key of a section's name, read in the `shell` scope (the icon vocabulary's hint). */
export function sectionNameKey(section: ShellSection): string {
  return UI_ICONS[section.icon].hint.slice('shell.'.length);
}

/** The section a path belongs to, or `null` (the account screens, unknown paths). */
export function sectionOfPath(path: string): ShellSection | null {
  if (path === '/') return SECTIONS[0];
  return (
    SECTIONS.find((s) =>
      s.owns.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
    ) ?? null
  );
}
