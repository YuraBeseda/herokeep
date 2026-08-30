import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  resolve: { alias: { '@hk/protocol': src('../protocol/src/index.ts'), '@hk/engine': src('../engine/src/index.ts') } },
  test: { name: 'pack-tools', include: ['test/**/*.test.ts'], environment: 'node' },
});
