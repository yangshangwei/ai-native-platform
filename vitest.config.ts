import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      // Keep the more specific subpath first: string aliases also match as
      // `<find>/` prefixes, so '@ainp/shared' would otherwise swallow it.
      '@ainp/shared/node': new URL('./packages/shared/src/node/index.ts', import.meta.url).pathname,
      '@ainp/shared': new URL('./packages/shared/src/index.ts', import.meta.url).pathname,
    },
  },
});
