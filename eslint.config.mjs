/**
 * ESLint flat config for the OCJS tests.
 *
 * Wires the type-aware `tau-lint/require-using-on-disposable` rule so
 * every embind-managed handle / RBV container in the test suite must be
 * captured by `using` (or forwarded via `return` / `stack.use(...)`).
 * Without this guard the bindings silently leak WASM memory.
 *
 * The `@taucad/oxlint` plugin lives in the parent Tau monorepo. OCJS is
 * a standalone repo (cloned via `repos.yaml`), so the plugin is imported
 * via a direct relative path. If/when OCJS joins the Tau workspace this
 * can collapse into a regular package import.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import tseslint from 'typescript-eslint';

const PARENT_TAU_ROOT = path.resolve(import.meta.dirname, '..', '..');
const TAU_LINT_URL = pathToFileURL(
  path.join(PARENT_TAU_ROOT, 'libs', 'oxlint', 'src', 'tau-lint.js'),
).href;

/** @type {import('eslint').ESLint.Plugin} */
const tauLintPlugin = (await import(TAU_LINT_URL)).default;

export default tseslint.config(
  {
    ignores: ['build/**', 'build-configs/*.d.ts', 'dist/**', 'deps/**', 'node_modules/**'],
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
      'tau-lint': tauLintPlugin,
      // Register `@typescript-eslint` so pre-existing
      // `/* eslint-disable @typescript-eslint/... */` directives in the
      // test sources resolve to real rule names (otherwise ESLint 9
      // surfaces them as "Definition for rule was not found" errors).
      // All TS rules stay off — we only consume the
      // `tau-lint/require-using-on-disposable` checker here.
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
      'tau-lint/require-using-on-disposable': 'error',
    },
  },
);
