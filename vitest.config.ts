import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test-d.ts',
      'starter-templates/*/tests/**/*.test.ts',
    ],
    typecheck: {
      enabled: true,
      include: ['tests/**/*.test-d.ts'],
      tsconfig: './tests/tsconfig.json',
    },
    testTimeout: 30_000,
  },
});
