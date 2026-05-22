// Phase 5 end-to-end examples bench.
// Runs simpleVase and birdhouse with 4 strategy combos × 50 iterations each.
// Strategies:
//   A    — status quo (per-element BSpline, naive mesh extraction)
//   D    — Strategy D for B-spline input (Pattern 1), naive mesh
//   F    — status quo input, Strategy F mesh extractor (Pattern 3)
//   D+F  — Strategy D for input + Strategy F for mesh
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { loadOC } from '../../replicad-equivalent/setup.mjs';
import { runSimpleVase } from '../../replicad-equivalent/examples/simple-vase.mjs';
import { runBirdhouse } from '../../replicad-equivalent/examples/birdhouse.mjs';
import { bench, printResult, verdict, round } from '../harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '../../reports');
await fs.mkdir(REPORTS_DIR, { recursive: true });

const oc = await loadOC();

const ITERATIONS = 50;

// Mesh hash helper for parity validation across strategies.
function hashMesh(mesh) {
  let h = 0n;
  const verts = mesh.vertices;
  const tris = mesh.triangles;
  // Quantize positions to 1e-3 to absorb float jitter.
  for (let i = 0; i < verts.length; i++) {
    const q = Math.round(verts[i] * 1000);
    h = (h * 1315423911n + BigInt(q)) & 0xffffffffffffffffn;
  }
  for (let i = 0; i < tris.length; i++) {
    h = (h * 1315423911n + BigInt(tris[i])) & 0xffffffffffffffffn;
  }
  return h.toString(16);
}

const results = {};

for (const [name, runFn] of [['simpleVase', runSimpleVase], ['birdhouse', runBirdhouse]]) {
  console.log(`\n=== ${name} end-to-end (${ITERATIONS} iterations) ===`);

  // Validate parity once before timing.
  const parityHashes = {};
  for (const combo of ['A', 'D', 'F', 'D+F']) {
    const inputStrategy = combo.includes('D') ? 'D' : 'A';
    const meshStrategy = combo.includes('F') ? 'F' : 'naive';
    if (name === 'birdhouse' && inputStrategy === 'D') {
      // birdhouse has no BSpline input -- collapse to status quo.
      parityHashes[combo] = parityHashes['A'] ?? hashMesh(runFn(oc, { input: 'A', mesh: meshStrategy }));
      continue;
    }
    const mesh = runFn(oc, name === 'simpleVase' ? { input: inputStrategy, mesh: meshStrategy } : { mesh: meshStrategy });
    parityHashes[combo] = hashMesh(mesh);
  }
  console.log('  Parity hashes:', parityHashes);

  results[name] = { iterations: ITERATIONS, parity: parityHashes, runs: {} };

  for (const combo of ['A', 'D', 'F', 'D+F']) {
    const inputStrategy = combo.includes('D') ? 'D' : 'A';
    const meshStrategy = combo.includes('F') ? 'F' : 'naive';
    const r = await bench(`combo ${combo}`, oc, ITERATIONS, () => {
      return runFn(oc, name === 'simpleVase' ? { input: inputStrategy, mesh: meshStrategy } : { mesh: meshStrategy });
    });
    printResult(r);
    results[name].runs[combo] = r;
  }

  const a = results[name].runs['A'];
  for (const combo of ['D', 'F', 'D+F']) {
    const v = verdict(`A→${combo}`, a, results[name].runs[combo]);
    console.log(`  → ${v.label}: ${v.changePct} (${v.assessment})`);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  examples: results,
};

const outPath = path.join(REPORTS_DIR, 'example-benches.json');
await fs.writeFile(outPath, JSON.stringify(report, null, 2));
console.log(`\nReport written: ${outPath}`);
