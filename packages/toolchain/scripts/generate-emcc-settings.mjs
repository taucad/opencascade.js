#!/usr/bin/env node
/**
 * Emit `generated/emcc-settings.d.ts` (the `EmccSettings` and
 * `VariantEmccSettings` types) and `generated/emcc-settings.meta.json` (the
 * serialisation manifest the renderer consumes instead of a hand-maintained
 * allowlist), from the `settings.js` of the *image's* emsdk.
 *
 * The two emitted types carry the same field names and the same doc comments;
 * the variant one widens every value with `| null` (the unset marker). They are
 * emitted twice rather than related by a mapped type because a mapped type
 * erases per-property documentation in editor quick-info — see the doc comment
 * on `VariantEmccSettings` below, and `test/quick-info.test.ts` which pins it.
 *
 * Value-grammar rules (blueprint "Value-grammar typing"), applied in this order:
 *
 * | Rule | Applies to | Type |
 * | --- | --- | --- |
 * | memory size (by name) | `INITIAL_MEMORY`, `MAXIMUM_MEMORY`, `STACK_SIZE` and every legacy alias of them (`TOTAL_MEMORY`, `TOTAL_STACK`, `WASM_MEM_MAX`, `BINARYEN_MEM_MAX`) | `MemorySize` |
 * | environment list (by name) | `ENVIRONMENT` | `readonly EmccEnvironment[]`, values read from its own doc comment |
 * | thread pool (by name) | `PTHREAD_POOL_SIZE` | `number \| 'navigator.hardwareConcurrency'` |
 * | boolean default | `var X = true/false` | `boolean` |
 * | 0/1 integer default | `var X = 0` / `= 1` | `boolean \| number` |
 * | other numeric default | `var X = 85` | `number` |
 * | string default | `var X = 'quiet'` | `string` |
 * | array default | `var X = []` | `readonly string[]` |
 *
 * Bool-int detection rule: settings.js declares flags with boolean semantics
 * either as JS booleans or as ints defaulting to 0/1, and the two are not
 * distinguishable from the declaration alone (`EVAL_CTORS` defaults to 0 but
 * accepts 2). Rather than sniff prose, every 0/1-defaulted integer accepts
 * **both** `boolean` and `number`; the renderer serialises `true`/`false` to
 * `1`/`0`. No setting loses expressiveness and none is mistyped.
 */
import { readImageFacts } from './lib/image.mjs';
import { parseEnvironments, parseSettingsJs } from './lib/settings-parser.mjs';
import { writeGenerated } from './lib/symbols.mjs';

const MEMORY_SIZE_SETTINGS = new Set(['INITIAL_MEMORY', 'MAXIMUM_MEMORY', 'STACK_SIZE']);

const facts = readImageFacts();
const parsed = parseSettingsJs(facts.settingsJs);
const environments = parseEnvironments(
  parsed.find((setting) => setting.name === 'ENVIRONMENT') ??
    (() => {
      throw new Error('settings.js declares no ENVIRONMENT setting; the renderer grammar assumes it.');
    })(),
);

const deprecated = new Set(facts.deprecatedSettings);
/** Serialisation buckets, consumed by `src/config/render.ts` and by W3's assemble step. */
const meta = { memorySizes: [], commaLists: [], bracketLists: [], boolInts: [] };

/** @type {Map<string, {type: string, doc: string[]}>} */
const fields = new Map();

const declare = (name, type, doc) => {
  fields.set(name, { type, doc: deprecated.has(name) ? [...doc, '@deprecated'] : doc });
};

for (const setting of parsed) {
  const { name, kind, value, doc } = setting;
  if (MEMORY_SIZE_SETTINGS.has(name)) {
    meta.memorySizes.push(name);
    declare(name, 'MemorySize', doc);
    continue;
  }
  if (name === 'ENVIRONMENT') {
    meta.commaLists.push(name);
    declare(name, 'readonly EmccEnvironment[]', doc);
    continue;
  }
  if (name === 'PTHREAD_POOL_SIZE') {
    declare(name, "number | 'navigator.hardwareConcurrency'", doc);
    continue;
  }
  if (kind === 'boolean') {
    declare(name, 'boolean', doc);
    continue;
  }
  if (kind === 'number') {
    if (value === 0 || value === 1) meta.boolInts.push(name);
    declare(name, value === 0 || value === 1 ? 'boolean | number' : 'number', doc);
    continue;
  }
  if (kind === 'string') {
    declare(name, 'string', doc);
    continue;
  }
  meta.bracketLists.push(name);
  declare(name, 'readonly string[]', doc);
}

const literal = (value) => {
  if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.length === 0) return 'readonly []';
  throw new Error(
    `tools/settings.py: unmodelled legacy value ${JSON.stringify(value)}. Extend the generator ` +
      'rather than widening the setting to a bare type.',
  );
};

// Legacy settings are still accepted by emcc — `USE_PTHREADS` is how both
// reference builds request pthreads — so they belong in the type, carrying
// exactly the values `tools/settings.py` still allows.
for (const [name, replacement] of facts.legacySettings) {
  if (fields.has(name)) continue;
  if (typeof replacement === 'string') {
    const target = fields.get(replacement);
    if (!target) continue;
    for (const bucket of Object.values(meta)) {
      if (bucket.includes(replacement)) bucket.push(name);
    }
    declare(name, target.type, [`Legacy alias of \`${replacement}\`.`, `@deprecated`]);
    continue;
  }
  const values = replacement.map(literal);
  const numeric = replacement.every((entry) => entry === 0 || entry === 1);
  declare(name, [...(numeric ? ['boolean'] : []), ...values].join(' | '), [
    'Legacy setting: emcc still accepts these values for backwards compatibility.',
    '@deprecated',
  ]);
}

const renderDoc = (doc) => {
  const lines = doc.map((line) => line.replace(/\*\//g, '*\\/')).join('\n');
  if (lines.trim() === '') return '';
  return `  /**\n${lines
    .split('\n')
    .map((line) => `   *${line === '' ? '' : ` ${line}`}`)
    .join('\n')}\n   */\n`;
};

const names = [...fields.keys()].sort();
const contents = `// GENERATED by packages/toolchain/scripts/generate-emcc-settings.mjs from emsdk ${facts.emscriptenVersion} \
src/settings.js + tools/settings.py (the toolchain image's emsdk) — do not edit.
//
// Every field's documentation below is reproduced verbatim from Emscripten's
// src/settings.js. Emscripten is available under the MIT license and the
// University of Illinois/NCSA Open Source License:
//
//   Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in
//   all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
//   THE SOFTWARE.
//
// See this package's NOTICE file. The full text of both Emscripten licenses is
// at https://github.com/emscripten-core/emscripten/blob/main/LICENSE.

/**
 * A memory size: a byte count, or a suffixed size emcc parses itself.
 *
 * The suffix is case-sensitive — \`'100mb'\` and \`'100 MB'\` are silent
 * misparses on the emcc command line, and compile errors here.
 */
export type MemorySize = number | \`\${number}KB\` | \`\${number}MB\` | \`\${number}GB\`;

/** A JS environment \`-sENVIRONMENT\` accepts; serialised to the comma list. */
export type EmccEnvironment = ${environments.map((environment) => `'${environment}'`).join(' | ')};

/**
 * Every emcc \`-s\` setting of the pinned emsdk, with the value grammar
 * settings.js declares. Unknown names are compile errors — that is the point.
 */
export type EmccSettings = {
${names
  .map((name) => {
    const field = fields.get(name);
    return `${renderDoc(field.doc)}  readonly ${name}?: ${field.type};`;
  })
  .join('\n')}
};

/**
 * The same settings as {@link EmccSettings}, for a build variant's own
 * \`settings\` block: each value widened with \`| null\`.
 *
 * A variant value replaces the base value wholesale. \`null\` **unsets** the
 * inherited base key, so the setting reaches emcc for the other variants and
 * not for this one; unsetting a key the base never declared is a config error.
 *
 * Spelled out field by field rather than derived from {@link EmccSettings} as a
 * mapped type on purpose: TypeScript's quick-info does not carry property
 * documentation through a value-rewriting mapped type, so the mapped form left
 * every variant setting undocumented in the editor while the identical base
 * setting was fully documented. This file is generated, so parity costs nothing
 * but bytes.
 */
export type VariantEmccSettings = {
${names
  .map((name) => {
    const field = fields.get(name);
    return `${renderDoc(field.doc)}  readonly ${name}?: ${field.type} | null;`;
  })
  .join('\n')}
};
`;

writeGenerated('emcc-settings.d.ts', contents);

writeGenerated(
  'emcc-settings.meta.json',
  `${JSON.stringify(
    {
      $generatedBy: `packages/toolchain/scripts/generate-emcc-settings.mjs from emsdk ${facts.emscriptenVersion} (the toolchain image's emsdk) — do not edit.`,
      emsdkVersion: facts.emscriptenVersion,
      ...Object.fromEntries(
        Object.entries(meta).map(([bucket, entries]) => [bucket, [...entries].sort()]),
      ),
    },
    undefined,
    2,
  )}\n`,
);
process.stdout.write(`  ${names.length} settings (emsdk ${facts.emscriptenVersion})\n`);
