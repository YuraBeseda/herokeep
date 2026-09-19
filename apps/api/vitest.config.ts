import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@hk/protocol': fileURLToPath(new URL('../../packages/protocol/src/index.ts', import.meta.url)) },
  },
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    // The Cloudflare pool-workers suite gets its own vitest project/invocation
    // (`test/adapters/cloudflare/vitest.config.ts`, run via `pnpm --filter api test:cloudflare`)
    // — its test files import `cloudflare:test`, which does not resolve under plain Node Vitest.
    exclude: ['**/node_modules/**', 'test/adapters/cloudflare/**'],
    environment: 'node',
  },
});
