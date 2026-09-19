import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@hk/protocol': fileURLToPath(new URL('../../packages/protocol/src/index.ts', import.meta.url)) },
  },
  test: { name: 'api', include: ['test/**/*.test.ts'], environment: 'node' },
});
