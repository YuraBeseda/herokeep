/**
 * drizzle-kit config — used by `pnpm db:generate` (drizzle-kit generate) to turn
 * `src/core/db/schema.ts` into the SQL migrations committed under `src/core/db/migrations/`
 * (doc-10: applied by wrangler on Cloudflare D1, at startup on the Node adapter). `generate`
 * (the only drizzle-kit command this project runs) never touches a live database — the
 * `dbCredentials` block below is required by drizzle-kit's config schema but is unused by it.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/core/db/schema.ts',
  out: './src/core/db/migrations',
  dbCredentials: { url: './.drizzle-generate-placeholder.sqlite' },
});
