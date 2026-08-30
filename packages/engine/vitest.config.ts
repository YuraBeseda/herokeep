import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@hk/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)) } },
  test: { name: 'engine', include: ['test/**/*.test.ts'], environment: 'node' },
});
