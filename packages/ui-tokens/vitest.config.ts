import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'ui-tokens', include: ['test/**/*.test.ts'], environment: 'node' },
});
