/**
 * Local ESLint plugin: `ocjs-lint`
 *
 * Vendored from the upstream tau-lint workspace plugin to keep
 * `libcascade` self-contained — the published source repository must not
 * carry a hard reference to a sibling `libs/oxlint/` checkout.
 *
 * Today the only rule we ship is `require-using-on-disposable`, the
 * type-aware guard that forces every embind-managed handle and RBV
 * container to be captured by a `using` declaration (see the rule's own
 * header for the full ownership model).
 *
 * @typedef {import('eslint').ESLint.Plugin} Plugin
 */

import { requireUsingOnDisposableRule } from './require-using-on-disposable.js';

/** @type {Plugin} */
const plugin = {
  meta: {
    name: 'ocjs-lint',
    version: '1.0.0',
  },
  rules: {
    'require-using-on-disposable': requireUsingOnDisposableRule,
  },
};

export default plugin;
