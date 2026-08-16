import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // The CLI entry point only wires stdio together and exits the process;
      // it is exercised manually, not unit-tested.
      exclude: ['src/index.ts'],
      // Vitest 4 measures AST-based (stricter than v3); thresholds sit just
      // below the measured baseline at the time of the bump.
      thresholds: {
        statements: 92,
        branches: 85,
        functions: 82,
        lines: 92,
      },
    },
  },
});
