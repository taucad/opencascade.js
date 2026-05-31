/**
 * ESLint flat config for the OCJS tests.
 *
 * Wires the type-aware `ocjs-lint/require-using-on-disposable` rule so
 * every embind-managed handle / RBV container in the test suite must be
 * captured by `using` (or forwarded via `return` / `stack.use(...)`).
 * Without this guard the bindings silently leak WASM memory.
 *
 * The rule is vendored locally under `tools/eslint-plugin/` so this
 * repository builds and lints without depending on the parent tau
 * workspace (`libs/oxlint`).
 */

import tseslint from 'typescript-eslint';
import ocjsLintPlugin from './tools/eslint-plugin/index.js';

export default tseslint.config(
  {
    ignores: [
      'build/**',
      'build-configs/*.d.ts',
      'dist/**',
      'deps/**',
      'node_modules/**',
      // Per-test Docker build-flow artifacts (gitignored): the custom `link`
      // builds emit `.d.ts`/`.js` modules here that aren't part of the test
      // tsconfig project and must not be type-aware linted.
      'tests/docker/.work/**',
      'tests/docker/.trial/**',
    ],
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tests/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'ocjs-lint': ocjsLintPlugin,
      // Register `@typescript-eslint` so pre-existing
      // `/* eslint-disable @typescript-eslint/... */` directives in the
      // test sources resolve to real rule names (otherwise ESLint 9
      // surfaces them as "Definition for rule was not found" errors).
      // All TS rules stay off — we only consume the
      // `ocjs-lint/require-using-on-disposable` checker here.
      '@typescript-eslint': tseslint.plugin,
    },
    linterOptions: {
      // Pre-existing test files carry oxlint-style `eslint-disable`
      // comments that don't always match an enabled ESLint rule;
      // suppress the bookkeeping noise so we can focus on the real
      // leak diagnostics.
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      'ocjs-lint/require-using-on-disposable': 'error',
    },
  },
);
