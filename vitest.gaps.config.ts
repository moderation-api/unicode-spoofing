import { defineConfig } from 'vitest/config';

// Runs ONLY the documented known-gap suite (see test/known-gaps.test.ts).
// Invoked via `pnpm test:gaps`; kept out of the default `pnpm test` run.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/known-gaps.test.ts'],
  },
});
