// Phase 2 smoke: exercise the ported status-quo (Strategy A) hot-path functions
// to confirm they run end-to-end against the custom OCJS subset.
import assert from 'node:assert/strict';
import { loadOC, asPnt } from '../replicad-equivalent/setup.mjs';
import { makeBSplineApproximation } from '../replicad-equivalent/make-bspline.mjs';
import { meshNaive } from '../replicad-equivalent/mesh.mjs';
import { makeEllipsoidStatusQuo } from '../replicad-equivalent/make-ellipsoid.mjs';

const oc = await loadOC();

// 1. Cube smoke.
{
  using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
  using shape = box.Shape();
  const mesh = meshNaive(oc, shape, { tolerance: 0.5 });
  assert.ok(mesh.vertices.length > 0, 'cube mesh has vertices');
  assert.ok(mesh.triangles.length > 0, 'cube mesh has triangles');
  assert.ok(mesh.faceGroups.length > 0, 'cube mesh has face groups');
  console.log(`  cube mesh: ${mesh.vertices.length / 3} verts, ${mesh.triangles.length / 3} tris`);
}

// 2. Sphere smoke.
{
  using sphere = new oc.BRepPrimAPI_MakeSphere(10);
  using shape = sphere.Shape();
  const mesh = meshNaive(oc, shape, { tolerance: 0.5 });
  assert.ok(mesh.vertices.length > 0, 'sphere mesh has vertices');
  console.log(`  sphere mesh: ${mesh.vertices.length / 3} verts, ${mesh.triangles.length / 3} tris`);
}

// 3. Pattern 1: B-spline through a circle of points.
{
  const pts = [];
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * 2 * Math.PI;
    pts.push([Math.cos(t) * 50, Math.sin(t) * 50, 0]);
  }
  pts.push(pts[0]);
  using edge = makeBSplineApproximation(oc, pts, { tolerance: 0.1, degMax: 5 });
  assert.ok(edge, 'b-spline edge built');
  console.log(`  bspline edge built from ${pts.length} pts`);
}

// 4. Pattern 4: ellipsoid via Poles() rebuild.
{
  using shell = makeEllipsoidStatusQuo(oc, 10, 20, 30);
  assert.ok(shell, 'ellipsoid shell built');
  console.log('  ellipsoid shell built (10x20x30)');
}

console.log('PHASE 2 SMOKE OK');
