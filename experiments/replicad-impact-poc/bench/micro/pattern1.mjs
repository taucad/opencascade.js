// Pattern 1 — Input loops: build a B-spline approximation from N points.
// Compares Strategy A (per-element SetValue via embind) vs Strategy D
// (single Float64Array adapter call).
import { loadOC } from '../../replicad-equivalent/setup.mjs';
import { makeBSplineApproximation, makeBSplineApproximationStrategyD } from '../../replicad-equivalent/make-bspline.mjs';
import { bench, printResult, verdict } from '../harness.mjs';

const oc = await loadOC();

const SIZES = [16, 64, 256, 1024];
const ITERATIONS = 50;

const allResults = [];

for (const n of SIZES) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    pts.push([Math.cos(t) * 50, Math.sin(t) * 50, Math.sin(t * 3) * 5]);
  }

  console.log(`\n=== Pattern 1 — B-spline approximation of ${n} points ===`);

  const a = await bench('Strategy A (status quo)', oc, ITERATIONS, () => {
    using edge = makeBSplineApproximation(oc, pts, { tolerance: 0.1, degMax: 6 });
    return edge;
  });
  printResult(a);

  const d = await bench('Strategy D (Float64Array)', oc, ITERATIONS, () => {
    using edge = makeBSplineApproximationStrategyD(oc, pts, { tolerance: 0.1, degMax: 6 });
    return edge;
  });
  printResult(d);

  const v = verdict('A→D', a, d);
  console.log(`  → ${v.label}: ${v.changePct} (${v.assessment})`);

  allResults.push({ pattern: 'P1', n, statusQuo: a, strategyD: d, verdict: v });
}

export default allResults;

// Direct invocation
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\nDONE — Pattern 1 micro-bench complete.');
}
