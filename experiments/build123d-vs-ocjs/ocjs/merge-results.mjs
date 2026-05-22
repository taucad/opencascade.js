/**
 * Merge N benchmark JSON files (any combination of build123d / ocjs / native-lto / native-nolto)
 * into a side-by-side comparison.
 *
 * Each input file is expected to have:
 *   { engine: string, samples: { <name>: { medianMs, ... }, ... }, ...meta }
 *
 * Engine name is auto-shortened for the output column key:
 *   build123d-python-ocp-native     -> "build123d"
 *   opencascade.js-node-wasm        -> "ocjs"
 *   native-cpp-occt-lto             -> "native-lto"
 *   native-cpp-occt-nolto           -> "native-nolto"
 *
 * Pairwise ratios in the output answer the F1/F2/F8 questions from the research doc:
 *   - native-nolto / native-lto  → pure LTO uplift (forensic finding F1, measured)
 *   - ocjs / native-nolto        → pure WASM penalty (allocator + SIMD + EH), LTO disparity removed
 *   - ocjs / native-lto          → total OCJS gap vs build123d's underlying engine
 *   - build123d / native-lto     → pybind11 wrapper overhead in isolation
 *   - ocjs / build123d           → original 2-engine ratio (reproduces previous comparison)
 *
 * Usage:
 *   node ocjs/merge-results.mjs <a.json> <b.json> [<c.json> ...] --out <comparison.json>
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ENGINE_ALIASES = {
  'build123d-python-ocp-native': 'build123d',
  'opencascade.js-node-wasm': 'ocjs',
  'native-cpp-occt-lto': 'native-lto',
  'native-cpp-occt-nolto': 'native-nolto',
};

const args = process.argv.slice(2);
let out = '';
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out' && args[i + 1]) out = args[++i];
  else if (args[i].endsWith('.json')) files.push(args[i]);
}

if (files.length < 1) {
  console.error('Usage: merge-results.mjs <file1.json> [<file2.json> ...] --out <comparison.json>');
  process.exit(1);
}

const datasets = files.map((p) => {
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const engine = data.engine ?? path.basename(p);
  const alias = ENGINE_ALIASES[engine] ?? engine;
  return { path: p, engine, alias, data };
});

const aliasOrder = ['build123d', 'native-lto', 'native-nolto', 'ocjs'];
datasets.sort((a, b) => {
  const ia = aliasOrder.indexOf(a.alias);
  const ib = aliasOrder.indexOf(b.alias);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
});

const allNames = new Set();
for (const d of datasets) {
  for (const n of Object.keys(d.data.samples ?? {})) allNames.add(n);
}
const sampleNames = [...allNames].sort();

const ratioPairs = [
  { num: 'native-nolto', den: 'native-lto', label: 'pure LTO uplift (F1 measurement)' },
  { num: 'ocjs', den: 'native-nolto', label: 'pure WASM penalty (allocator + SIMD + EH)' },
  { num: 'ocjs', den: 'native-lto', label: 'total OCJS gap vs build123d engine' },
  { num: 'build123d', den: 'native-lto', label: 'pybind11 wrapper overhead' },
  { num: 'ocjs', den: 'build123d', label: 'original 2-engine ratio' },
];

const rows = sampleNames.map((name) => {
  const medians = {};
  for (const d of datasets) {
    const s = d.data.samples?.[name];
    medians[d.alias] = s?.medianMs ?? null;
  }
  const ratios = {};
  for (const { num, den } of ratioPairs) {
    const n = medians[num];
    const dn = medians[den];
    ratios[`${num}/${den}`] = n != null && dn != null && dn > 0 ? n / dn : null;
  }
  return { name, medians, ratios };
});

const meta = {};
for (const d of datasets) {
  meta[d.alias] = {
    engine: d.engine,
    file: d.path,
    warmup: d.data.warmup,
    iterations: d.data.iterations,
    occtVersion: d.data.occtVersion,
    ltoEnabled: d.data.ltoEnabled,
    importSeconds: d.data.importSeconds,
    ocjsLoadMs: d.data.ocjsLoadMs,
    wasmSize: d.data.wasmSize,
  };
}

const comparison = {
  generatedAt: new Date().toISOString(),
  engines: datasets.map((d) => d.alias),
  meta,
  ratioPairs,
  rows,
};

const outPath = out || 'results/comparison.json';
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(comparison, null, 2));
console.log(JSON.stringify(comparison, null, 2));
