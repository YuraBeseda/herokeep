// A pure leaf module (no imports, no Node APIs): the browser build imports it directly through the
// `@hk/ui-tokens/themes` alias, the same way it reaches `@hk/content/attribution`, so the token
// JSON and the Node-only build script stay out of the app bundle.
export const THEME_IDS = ['tavern', 'scroll', 'plain'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
