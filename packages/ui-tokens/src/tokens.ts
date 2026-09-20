export interface ThemeTokens {
  shared: Record<string, string>;
  light: Record<string, string>;
  dark: Record<string, string>;
}

export const TOKENS: ThemeTokens = {
  shared: {
    'font-body': "'Inter', system-ui, sans-serif",
    'font-display': "'Philosopher', 'Inter', serif",
    'font-scale': '1',
    'radius-s': '6px',
    'radius-m': '10px',
    'radius-l': '16px',
    'space-1': '4px',
    'space-2': '8px',
    'space-3': '12px',
    'space-4': '16px',
    'space-5': '24px',
    'space-6': '32px',
    'touch-target': '44px',
    'shadow-1': '0 1px 3px rgb(0 0 0 / 0.25)',
    'shadow-2': '0 4px 12px rgb(0 0 0 / 0.35)',
    'accent-h': '268',
    'accent-s': '60%',
    motion: '1',
    'duration-s': '120ms',
    'duration-m': '240ms',
    'focus-ring': '2px solid hsl(var(--accent-h) var(--accent-s) 62%)',
  },
  light: {
    'surface-0': 'hsl(40 30% 97%)',
    'surface-1': 'hsl(40 25% 93%)',
    'surface-2': 'hsl(40 20% 88%)',
    'surface-3': 'hsl(40 16% 82%)',
    'text-1': 'hsl(240 10% 12%)',
    'text-2': 'hsl(240 6% 32%)',
    'text-3': 'hsl(240 5% 48%)',
    accent: 'hsl(var(--accent-h) var(--accent-s) 42%)',
    // Same lightness as `accent` above: light theme's base `--accent` already clears 4.5:1 against
    // every `surface-*` it's used as text on (surface-1 alone measures ~7.27:1) — this token only
    // needs its OWN value in dark theme (see that block's comment). Kept as a distinct token
    // (rather than component SCSS reaching for `--accent` directly) so both themes stay resolvable
    // purely from `var(--accent-strong)`, no `[data-theme=...]` branching in component styles.
    'accent-strong': 'hsl(var(--accent-h) var(--accent-s) 42%)',
    'accent-contrast': 'hsl(40 30% 97%)',
    'border-1': 'hsl(40 12% 74%)',
    danger: 'hsl(0 62% 44%)',
    success: 'hsl(140 45% 34%)',
    warning: 'hsl(38 85% 38%)',
    overlay: 'rgb(20 20 24 / 0.4)',
  },
  dark: {
    'surface-0': 'hsl(240 6% 7%)',
    'surface-1': 'hsl(240 6% 11%)',
    'surface-2': 'hsl(240 6% 15%)',
    'surface-3': 'hsl(240 6% 20%)',
    'text-1': 'hsl(40 20% 96%)',
    'text-2': 'hsl(40 8% 72%)',
    // 52% lightness measured 4.32:1 against `surface-2` (hsl(240 6% 15%)) — under WCAG AA's
    // 4.5:1 minimum for normal text (axe `color-contrast`, caught on `.hk-stat-tile__sub` by
    // task-15-brief.md's new sheet-play-tab a11y check, the first axe scan to ever cover a
    // character screen). 54% clears it at ~4.61:1 while staying the same muted hue/saturation.
    'text-3': 'hsl(40 6% 54%)',
    accent: 'hsl(var(--accent-h) var(--accent-s) 62%)',
    // `accent`'s own 62% lightness measures only ~4.29:1 against `surface-1` (`hk-card`'s body
    // background) — under WCAG AA's 4.5:1 minimum for normal text (axe `color-contrast`, caught on
    // `.settings__login-link`/`.settings__register-link`, which sit inside a card unlike the auth
    // screens' own `--accent` links on the darker `surface-0` page background, which already clear
    // it there). 64% clears surface-1 at ~4.67:1 on the same hue/saturation. NOT applied to the
    // base `accent` token itself: bumping that broke an already-passing check elsewhere (`accent`
    // used as a BACKGROUND with light foreground text, e.g. `hk-button--ghost`'s label, whose
    // contrast only gets WORSE as `accent` lightens) — confirmed by running the full a11y suite
    // before landing this as a separate token instead.
    'accent-strong': 'hsl(var(--accent-h) var(--accent-s) 64%)',
    'accent-contrast': 'hsl(240 6% 7%)',
    'border-1': 'hsl(240 6% 26%)',
    danger: 'hsl(0 62% 58%)',
    success: 'hsl(140 42% 48%)',
    warning: 'hsl(40 80% 55%)',
    overlay: 'rgb(0 0 0 / 0.55)',
  },
} as const satisfies ThemeTokens;
