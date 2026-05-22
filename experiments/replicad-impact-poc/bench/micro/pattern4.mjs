// Pattern 4 — Ellipsoid Poles (NCollection_Array2 round-trip).
// Status quo walks per-pole through Geom_BSplineSurface::Pole(u, v) (one
// embind hop + one gp_Pnt allocation per pole). Strategy D pulls the entire
// surface poles into a flat Float64Array, mutates in JS, flushes back in one
// adapter call.
import { loadOC } from '../../replicad-equivalent/setup.mjs';
import { makeEllipsoidStatusQuo, makeEllipsoidStrategyD } from '../../replicad-equivalent/make-ellipsoid.mjs';
import { bench, printResult, verdict } from '../harness.mjs';

const oc = await loadOC();

const ITERATIONS = 30;

const cases = [
  { dims: [10, 20, 30], label: 'small (10x20x30)' },
  { dims: [100, 200, 50], label: 'medium (100x200x50)' },
  { dims: [1000, 200, 50], label: 'wide (1000x200x50)' },
];

const allResults = [];

for (const { dims, label } of cases) {
  console.log(`\n=== Pattern 4 — ellipsoid ${label} ===`);
  const a = await bench('Status quo (per-pole)', oc, ITERATIONS, () => {
    using shell = makeEllipsoidStatusQuo(oc, ...dims);
    return shell;
  });
  printResult(a);
  const d = await bench('Strategy D (flat array)', oc, ITERATIONS, () => {
    using shell = makeEllipsoidStrategyD(oc, ...dims);
    return shell;
  });
  printResult(d);
  const v = verdict('A→D', a, d);
  console.log(`  → ${v.label}: ${v.changePct} (${v.assessment})`);
  allResults.push({ pattern: 'P4', label, dims, statusQuo: a, strategyD: d, verdict: v });
}

export default allResults;

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\nDONE — Pattern 4 micro-bench complete.');
}
