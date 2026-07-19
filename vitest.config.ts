import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Known-gap cases are documented and runnable, but are not part of the
    // pass/fail contract — run them on demand with `pnpm test:gaps`.
    exclude: [...configDefaults.exclude, 'test/known-gaps.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/data/**'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
