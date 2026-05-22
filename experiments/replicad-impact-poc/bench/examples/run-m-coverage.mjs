// M-coverage bench harness (Phase 5).
//
// Drives all seven blueprint models (M1–M7) through the full per-model
// strategy matrix and writes the consolidated result to
// reports/m-coverage-benches.json.
//
// Strategy plan (per blueprint OQ-A/B/E/F):
//   M1 (high-NbPoles synthetic): A vs naive-D vs split-API-D × {30, 100,
//     300, 1000, 3000} NbPoles values (5 cohorts × 3 strategies = 15 runs).
//   M2/M3/M4/M5: A vs F mesh-extract comparison (status quo NCollection mesh
//     extraction vs zero-copy adapter).
//   M6/M7: A vs F mesh comparison (load cost amortised across iterations
//     since the STEP file is staged once on harness setup).
//
// Iteration counts are per-model-tuned so each model spends roughly 10–60s
// of wall clock. Heavier models (M3 motor housing, M6/M7 STEP) get fewer
// iterations; the cheap ones (M1, M4) get more for tighter confidence.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { loadOC } from '../../replicad-equivalent/setup.mjs';
import { bench, printResult, verdict, round } from '../harness.mjs';

import { runM1HighNbPoles, defaultParams as m1Defaults } from '../../replicad-equivalent/examples/m1-high-nbpoles.mjs';
import { runWateringCan } from '../../replicad-equivalent/examples/m2-watering-can.mjs';
import { runMotorHousing } from '../../replicad-equivalent/examples/m3-motor-housing.mjs';
import { runLegoBrick } from '../../replicad-equivalent/examples/m4-lego-brick.mjs';
import { runThreadedScrew } from '../../replicad-equivalent/examples/m5-threaded-screw.mjs';
import { runStepSingle, prewarmStepFile } from '../../replicad-equivalent/examples/m6-step-single.mjs';
import { runStepMulti } from '../../replicad-equivalent/examples/m7-step-multi.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '../../reports');
await fs.mkdir(REPORTS_DIR, { recursive: true });

// Each invocation runs ONE phase so that we start with a clean wasm linear
// memory each time. Even with mimalloc, the cumulative footprint of all M1–M7
// models in one process exceeds the 4 GB cap (M2 alone allocates ~750 MB/run,
// M3 ~530 MB/run, etc. — OCCT's per-iteration BOP/sweep allocations rarely
// return pages even under mimalloc). Phase ∈ {'m1', 'm2', 'm3', 'm4', 'm5',
// 'm6', 'm7', 'all'}; each phase writes a per-phase JSON shard that
// `run-m-coverage-all.sh` then merges into `m-coverage-benches.json`.
const PHASE = process.env.M_COVERAGE_PHASE ?? 'all';
const PHASE_SET = new Set(PHASE === 'all'
  ? ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']
  : PHASE.split(',').map((s) => s.trim().toLowerCase()));
console.log(`Phase: ${PHASE}  (active: ${[...PHASE_SET].sort().join(',')})`);

const oc = await loadOC();
if (PHASE_SET.has('m6') || PHASE_SET.has('m7')) prewarmStepFile(oc);

function hashMesh(mesh) {
  let h = 0n;
  const verts = mesh.vertices;
  const tris = mesh.triangles;
  for (let i = 0; i < verts.length; i++) {
    // Coerce NaN/Inf to a sentinel so the hash is well-defined even when a
    // boolean op produced a degenerate vertex (e.g., M4 LEGO can briefly
    // produce NaN coordinates on some iterations of the LEGO fuse loop).
    const v = verts[i];
    const q = Number.isFinite(v) ? Math.round(v * 1000) : 2147483647;
    h = (h * 1315423911n + BigInt(q)) & 0xffffffffffffffffn;
  }
  for (let i = 0; i < tris.length; i++) {
    h = (h * 1315423911n + BigInt(tris[i])) & 0xffffffffffffffffn;
  }
  return h.toString(16);
}

function meshStats(mesh) {
  return {
    vertexCount: mesh.vertices.length / 3,
    triangleCount: mesh.triangles.length / 3,
    faceGroupCount: mesh.faceGroups?.length ?? 0,
    meta: mesh.meta ?? null,
  };
}

const results = {};

// ── M1: high-NbPoles Pattern 2 sweep ─────────────────────────────────────
if (PHASE_SET.has('m1')) {
console.log('\n=== M1 high-NbPoles sweep (A vs naive-D vs split-API-D × NbPoles) ===');
const m1NbPolesValues = [30, 100, 300, 1000, 3000];
const m1Strategies = ['A', 'naive-D', 'split-API-D'];
const m1Iters = 200;
results.M1 = { iterations: m1Iters, cohorts: {} };

for (const N of m1NbPolesValues) {
  console.log(`\n  NbPoles cohort N=${N}`);
  const cohort = { params: { ...m1Defaults, nbInputPoints: N }, runs: {}, parity: {} };

  for (const strategy of m1Strategies) {
    const probe = runM1HighNbPoles(oc, { strategy, params: cohort.params });
    cohort.parity[strategy] = hashMesh(probe);
    cohort.srcPoles = probe.meta.nbPolesSrc;
    cohort.segPoles = probe.meta.nbPolesSeg;
  }
  console.log(`    src=${cohort.srcPoles} seg=${cohort.segPoles}  parity=${JSON.stringify(cohort.parity)}`);

  for (const strategy of m1Strategies) {
    const r = await bench(`M1 N=${N} ${strategy}`, oc, m1Iters, () =>
      runM1HighNbPoles(oc, { strategy, params: cohort.params }),
    );
    printResult(r);
    cohort.runs[strategy] = r;
  }
  const vNaive = verdict('A→naive-D', cohort.runs['A'], cohort.runs['naive-D']);
  const vSplit = verdict('A→split-API-D', cohort.runs['A'], cohort.runs['split-API-D']);
  console.log(`    → ${vNaive.label}: ${vNaive.changePct} (${vNaive.assessment})`);
  console.log(`    → ${vSplit.label}: ${vSplit.changePct} (${vSplit.assessment})`);
  cohort.verdicts = { naiveD: vNaive, splitD: vSplit };
  results.M1.cohorts[N] = cohort;
}
} // end PHASE_SET.has('m1')

// ── M2–M7: A vs F per model ──────────────────────────────────────────────
// Iteration counts tuned for the 4 GB wasm linear memory cap. OCCT (dlmalloc)
// fragments aggressively across boolean/sweep ops and rarely returns pages,
// so each model contributes wasm growth proportional to its iteration count
// × per-iter footprint. Empirically:
//   M2 ~15 MB/iter, M3 ~35 MB/iter, M5 ~10 MB/iter, M6/M7 ~20 MB/iter.
// At these rates the budgets below keep aggregate wasm growth under ~3 GB,
// leaving 1 GB margin for transient peaks.
const mPlan = [
  ['M2', 'watering-can', runWateringCan, 30],
  ['M3', 'motor-housing', runMotorHousing, 15],
  ['M4', 'lego-brick', runLegoBrick, 40],
  ['M5', 'threaded-screw', runThreadedScrew, 30],
  ['M6', 'step-single', runStepSingle, 15],
  ['M7', 'step-multi', runStepMulti, 15],
];

for (const [key, label, runFn, iters] of mPlan) {
  if (!PHASE_SET.has(key.toLowerCase())) continue;
  console.log(`\n=== ${key} ${label} (${iters} iterations, A vs F) ===`);

  const parityHashes = {};
  let stats = null;
  for (const combo of ['A', 'F']) {
    const meshStrategy = combo === 'F' ? 'F' : 'naive';
    const m = runFn(oc, { mesh: meshStrategy });
    parityHashes[combo] = hashMesh(m);
    if (combo === 'F') stats = meshStats(m);
  }
  console.log('  Parity hashes:', parityHashes);
  console.log('  Mesh stats:', stats);

  const slot = { iterations: iters, parity: parityHashes, meshStats: stats, runs: {} };

  for (const combo of ['A', 'F']) {
    const meshStrategy = combo === 'F' ? 'F' : 'naive';
    const r = await bench(`combo ${combo}`, oc, iters, () => runFn(oc, { mesh: meshStrategy }));
    printResult(r);
    slot.runs[combo] = r;
  }
  const v = verdict('A→F', slot.runs['A'], slot.runs['F']);
  console.log(`  → ${v.label}: ${v.changePct} (${v.assessment})`);
  slot.verdict = v;
  results[key] = slot;
}

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  phase: PHASE,
  models: results,
  notes: {
    m1: 'Pattern 2 (pass-through .Segment) sweep across NbPoles ∈ {30,100,300,1000,3000}, comparing status-quo A vs naive-D (materialise via adapter) vs split-API-D (single C++ call).',
    m2_m7: 'Build + mesh full pipeline; A = naive per-element mesh extraction, F = zero-copy ReplicadAdapters.extractMesh.',
    m6_m7: 'STEP file (3.1 MB, AP242, 21 sub-solids) is pre-staged into wasm virtual FS during harness setup; per-iteration cost excludes disk I/O.',
    allocator: 'mimalloc (Emscripten -sMALLOC=mimalloc); per-phase processes still required because each model contributes 250 MB – 1.3 GB of wasm linear-memory growth that mimalloc retains.',
  },
};

// Each phase writes its own shard so a top-level merge step can produce the
// canonical `m-coverage-benches.json`. Running with PHASE=all (single-process)
// still writes the full file directly.
const shardName = PHASE === 'all' ? 'm-coverage-benches.json' : `m-coverage-benches.${PHASE}.json`;
const outPath = path.join(REPORTS_DIR, shardName);
await fs.writeFile(outPath, JSON.stringify(report, null, 2));
console.log(`\nReport written: ${outPath}`);

void round;
