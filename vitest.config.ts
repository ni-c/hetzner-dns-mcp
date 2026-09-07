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
      // below the measured baseline at the time of the bump. Raised with the
      // 0.6.0 security review, which added the boundary, hardening, shape and
      // linear-time suites: 97.35 / 92.83 / 100 / 97.88 measured.
      thresholds: {
        statements: 96,
        branches: 91,
        functions: 99,
        lines: 97,
      },
    },
  },
});
