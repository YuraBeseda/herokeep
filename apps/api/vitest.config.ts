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
    // `test/conformance/cloudflare.conformance.test.ts` (task 9) is the one file outside
    // `test/adapters/cloudflare/` that also imports it — excluded here for the same reason, and
    // included instead by `test/adapters/cloudflare/vitest.config.ts`'s own `include`.
    exclude: ['**/node_modules/**', 'test/adapters/cloudflare/**', 'test/conformance/cloudflare.conformance.test.ts'],
    environment: 'node',
  },
});
