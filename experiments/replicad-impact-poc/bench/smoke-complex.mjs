// Smoke test for the complex ports (nozzle / gear / vase + M1–M7).
// Builds + meshes each, validates non-empty geometry, prints summary stats.
import { loadOC } from '../replicad-equivalent/setup.mjs';
import { runRaoNozzle } from '../replicad-equivalent/examples/rao-nozzle.mjs';
import { runHelicalGear } from '../replicad-equivalent/examples/helical-gear.mjs';
import { runWavyVase } from '../replicad-equivalent/examples/wavy-vase.mjs';
import { runM1HighNbPoles, defaultParams as m1Defaults } from '../replicad-equivalent/examples/m1-high-nbpoles.mjs';
import { runWateringCan } from '../replicad-equivalent/examples/m2-watering-can.mjs';
import { runMotorHousing } from '../replicad-equivalent/examples/m3-motor-housing.mjs';
import { runLegoBrick } from '../replicad-equivalent/examples/m4-lego-brick.mjs';
import { runThreadedScrew } from '../replicad-equivalent/examples/m5-threaded-screw.mjs';
import { runStepSingle, prewarmStepFile } from '../replicad-equivalent/examples/m6-step-single.mjs';
import { runStepMulti } from '../replicad-equivalent/examples/m7-step-multi.mjs';

const oc = await loadOC();
prewarmStepFile(oc);

function summarize(name, mesh, { minVerts = 1, minTris = 0 } = {}) {
  const nVerts = mesh.vertices.length / 3;
  const nTris = mesh.triangles.length / 3;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const x = mesh.vertices[i], y = mesh.vertices[i + 1], z = mesh.vertices[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const meta = mesh.meta ? ' meta=' + JSON.stringify(mesh.meta) : '';
  console.log(`  ${name}: ${nVerts} verts, ${nTris} tris, bbox ${(maxX - minX).toFixed(1)} × ${(maxY - minY).toFixed(1)} × ${(maxZ - minZ).toFixed(1)}${meta}`);
  if (nVerts < minVerts) throw new Error(`${name}: too few vertices (${nVerts} < ${minVerts})`);
  if (nTris < minTris) throw new Error(`${name}: too few triangles (${nTris} < ${minTris})`);
}

const aMeshRuns = [
  ['rao-nozzle', runRaoNozzle, { minTris: 1 }],
  ['helical-gear', runHelicalGear, { minTris: 1 }],
  ['wavy-vase', runWavyVase, { minTris: 1 }],
  ['M2-watering-can', runWateringCan, { minTris: 1 }],
  ['M3-motor-housing', runMotorHousing, { minTris: 1 }],
  ['M4-lego-brick', runLegoBrick, { minTris: 1 }],
  ['M5-threaded-screw', runThreadedScrew, { minTris: 1 }],
  ['M6-step-single', runStepSingle, { minTris: 1 }],
  ['M7-step-multi', runStepMulti, { minTris: 1 }],
];

for (const [name, runFn, validation] of aMeshRuns) {
  console.log(`\n=== ${name} ===`);
  const t0 = Date.now();
  const naive = runFn(oc, { mesh: 'naive' });
  console.log(`  naive: ${Date.now() - t0}ms`);
  summarize(`${name} (naive)`, naive, validation);

  const t1 = Date.now();
  const f = runFn(oc, { mesh: 'F' });
  console.log(`  F: ${Date.now() - t1}ms`);
  summarize(`${name} (F)`, f, validation);
}

// M1 is special: 3 strategies (A / naive-D / split-API-D) × multiple NbPoles
// values. We test the smallest NbPoles cohort for smoke and let the bench
// harness exercise the full sweep.
console.log(`\n=== M1-high-nbpoles ===`);
for (const N of [30, 1000]) {
  console.log(`  NbPoles cohort N=${N}:`);
  for (const strategy of ['A', 'naive-D', 'split-API-D']) {
    const t0 = Date.now();
    const r = runM1HighNbPoles(oc, { strategy, params: { ...m1Defaults, nbInputPoints: N } });
    console.log(`    ${strategy.padEnd(12)} verts(surrogate)=${r.vertices.length/2}  srcPoles=${r.meta.nbPolesSrc} segPoles=${r.meta.nbPolesSeg} ms=${Date.now() - t0}`);
    summarize(`M1 N=${N} ${strategy}`, r, { minVerts: 1, minTris: 0 });
  }
}

// M7 sub-solid count assertion (acceptance criterion: ≥ 5 sub-solids).
const m7 = runStepMulti(oc, { mesh: 'F' });
if (m7.meta.solidCount < 5) {
  throw new Error(`M7: expected ≥ 5 sub-solids, got ${m7.meta.solidCount}`);
}
console.log(`\nM7 sub-solid count: ${m7.meta.solidCount} (≥ 5 ✓)`);

console.log('\n✓ All smoke tests passed.');
