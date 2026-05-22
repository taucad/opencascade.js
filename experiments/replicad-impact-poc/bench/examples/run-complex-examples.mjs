// Complex-model end-to-end bench (Phase 5b).
//
// Runs rao-nozzle, helical-gear, wavy-vase with 2 strategy combos × N iterations.
// Strategies:
//   A    — status quo (naive per-element mesh extraction)
//   F    — Strategy F mesh extractor (zero-copy via PocMeshData)
//
// Strategy D is not exercised here: none of these models use the
// `GeomAPI_PointsToBSpline` Pattern 1 input loop (they use direct
// Geom_BezierCurve / GC_MakeArcOfCircle constructors). Strategy D would only
// shift the workload if we ALSO ported a non-trivial B-spline-approximation
// step (e.g., a smoothed lofted profile), which these models don't have.
//
// Iteration count is lower than the simple-model bench (15 vs 50) because
// gear builds take ~6s/iter; 15 iterations is enough for median + p95 with
// meaningful confidence.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { loadOC } from '../../replicad-equivalent/setup.mjs';
import { runRaoNozzle } from '../../replicad-equivalent/examples/rao-nozzle.mjs';
import { runHelicalGear } from '../../replicad-equivalent/examples/helical-gear.mjs';
import { runWavyVase } from '../../replicad-equivalent/examples/wavy-vase.mjs';
import { bench, printResult, verdict, round } from '../harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '../../reports');
await fs.mkdir(REPORTS_DIR, { recursive: true });

const oc = await loadOC();

// Per-model iteration count: gear is ~6s/iter so we trim it to 15. The lighter
// models keep 30 for tighter confidence intervals.
const ITERATION_CONFIG = {
  'rao-nozzle': 30,
  'helical-gear': 15,
  'wavy-vase': 30,
};

function hashMesh(mesh) {
  let h = 0n;
  const verts = mesh.vertices;
  const tris = mesh.triangles;
  for (let i = 0; i < verts.length; i++) {
    h = (h * 1315423911n + BigInt(Math.round(verts[i] * 1000))) & 0xffffffffffffffffn;
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
    faceGroupCount: mesh.faceGroups.length,
  };
}

const results = {};

for (const [name, runFn] of [
  ['rao-nozzle', runRaoNozzle],
  ['helical-gear', runHelicalGear],
  ['wavy-vase', runWavyVase],
]) {
  const iters = ITERATION_CONFIG[name];
  console.log(`\n=== ${name} end-to-end (${iters} iterations) ===`);

  // Parity check + mesh stats
  const parityHashes = {};
  let stats = null;
  for (const combo of ['A', 'F']) {
    const meshStrategy = combo === 'F' ? 'F' : 'naive';
    const mesh = runFn(oc, { mesh: meshStrategy });
    parityHashes[combo] = hashMesh(mesh);
    if (combo === 'F') stats = meshStats(mesh);
  }
  console.log('  Parity hashes:', parityHashes);
  console.log('  Mesh stats:', stats);

  results[name] = { iterations: iters, parity: parityHashes, meshStats: stats, runs: {} };

  for (const combo of ['A', 'F']) {
    const meshStrategy = combo === 'F' ? 'F' : 'naive';
    const r = await bench(`combo ${combo}`, oc, iters, () => runFn(oc, { mesh: meshStrategy }));
    printResult(r);
    results[name].runs[combo] = r;
  }

  const a = results[name].runs['A'];
  const v = verdict(`A→F`, a, results[name].runs['F']);
  console.log(`  → ${v.label}: ${v.changePct} (${v.assessment})`);
}

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  examples: results,
  note: 'Complex models (nozzle/gear/vase) — Strategy D inapplicable; A vs F only.',
};

const outPath = path.join(REPORTS_DIR, 'complex-benches.json');
await fs.writeFile(outPath, JSON.stringify(report, null, 2));
console.log(`\nReport written: ${outPath}`);
