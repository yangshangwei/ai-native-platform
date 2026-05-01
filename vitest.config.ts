import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@ainp/shared': new URL('./packages/shared/src/index.ts', import.meta.url).pathname,
    },
  },
});
