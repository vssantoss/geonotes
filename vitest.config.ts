import { defineConfig } from 'vitest/config'

/**
 * Two projects, split by cost rather than by runtime.
 *
 * `unit` is the fast suite: the frontend and the Worker's pure helpers, plus
 * router.test.ts driving the Hono app in-process.
 *
 * `integration` boots a real local Worker from wrangler.toml, so it can test the
 * static-assets router that sits in front of the Worker. That router is
 * configuration, not code, and is invisible to the unit suite: a request
 * matching a built file never enters the Worker at all. Getting that wrong once
 * already silently disabled the non-production renaming while everything was
 * green. It needs a current dist/ and takes a few seconds to start.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: './vite.config.ts',
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}', 'worker/**/*.test.ts'],
          exclude: ['worker/**/*.integration.test.ts'],
        },
      },
      {
        extends: './vite.config.ts',
        test: {
          name: 'integration',
          include: ['worker/**/*.integration.test.ts'],
          // Booting the dev worker is slow enough to trip the default timeout on
          // a cold start.
          testTimeout: 30_000,
        },
      },
    ],
  },
})
