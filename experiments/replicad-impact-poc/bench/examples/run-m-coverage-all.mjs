// Driver: run each M-coverage phase in its own Node process (so wasm linear
// memory resets between heavy models even with mimalloc retaining pages),
// then merge the per-phase shards into the canonical m-coverage-benches.json.
//
// Usage:  node bench/examples/run-m-coverage-all.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '../../reports');
const HARNESS = path.join(__dirname, 'run-m-coverage.mjs');

const PHASES = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];

await fs.mkdir(REPORTS_DIR, { recursive: true });

for (const phase of PHASES) {
  console.log(`\n────── Phase ${phase} ──────`);
  const t0 = Date.now();
  const res = spawnSync(process.execPath, ['--expose-gc', HARNESS], {
    stdio: 'inherit',
    env: { ...process.env, M_COVERAGE_PHASE: phase },
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.status !== 0) {
    console.error(`Phase ${phase} failed (exit ${res.status}) after ${dt}s`);
    process.exit(res.status ?? 1);
  }
  console.log(`Phase ${phase} OK (${dt}s)`);
}

console.log('\n────── Merging shards ──────');
const merged = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  phase: 'merged',
  models: {},
  notes: {},
  phases: {},
};

for (const phase of PHASES) {
  const shardPath = path.join(REPORTS_DIR, `m-coverage-benches.${phase}.json`);
  const shard = JSON.parse(await fs.readFile(shardPath, 'utf8'));
  merged.phases[phase] = { generatedAt: shard.generatedAt, node: shard.node };
  Object.assign(merged.models, shard.models);
  Object.assign(merged.notes, shard.notes);
}

const outPath = path.join(REPORTS_DIR, 'm-coverage-benches.json');
await fs.writeFile(outPath, JSON.stringify(merged, null, 2));
console.log(`\nMerged report written: ${outPath}`);
console.log(`Models included: ${Object.keys(merged.models).sort().join(', ')}`);
