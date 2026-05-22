// Phase 3 smoke: validate every adapter on a tiny input. Confirms that the
// Strategy D / Dp / F / naive-D / split-API D paths are reachable from JS
// before we layer benchmarking on top.
import assert from 'node:assert/strict';
import { loadOC } from '../replicad-equivalent/setup.mjs';

const oc = await loadOC();

function bytesToFloat64Buffer(arr) {
  const ptr = oc._malloc(arr.length * 8);
  oc.HEAPF64.set(arr, ptr / 8);
  return ptr;
}

function viewFloat64(ptr, len) {
  return oc.HEAPF64.subarray(ptr / 8, ptr / 8 + len);
}

function viewInt32(ptr, len) {
  return oc.HEAP32.subarray(ptr / 4, ptr / 4 + len);
}

function viewFloat32(ptr, len) {
  return oc.HEAPF32.subarray(ptr / 4, ptr / 4 + len);
}

function viewUint32(ptr, len) {
  return oc.HEAPU32.subarray(ptr / 4, ptr / 4 + len);
}

// 1. Pattern 1 — makeBSplineEdgeFromCoords
{
  const pts = [];
  for (let i = 0; i < 32; i++) {
    const t = (i / 32) * 2 * Math.PI;
    pts.push(Math.cos(t) * 50, Math.sin(t) * 50, 0);
  }
  const ptr = bytesToFloat64Buffer(pts);
  using edge = oc.ReplicadAdapters.makeBSplineEdgeFromCoords(ptr, pts.length / 3, 1, 6, 0.1);
  oc._free(ptr);
  assert.ok(edge && !edge.IsNull?.(), 'Strategy D B-spline edge built');
  console.log('  Pattern 1 Strategy D OK');
}

// 2. Pattern 3 — Strategy F mesh extractor
{
  using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
  using shape = box.Shape();
  using raw = oc.ReplicadAdapters.extractMesh(shape, 0.5, 0.1, false);
  const verts = viewFloat32(raw.getVerticesPtr(), raw.getVerticesSize());
  const tris = viewUint32(raw.getTrianglesPtr(), raw.getTrianglesSize());
  assert.ok(verts.length > 0, 'extractor produced vertices');
  assert.ok(tris.length > 0, 'extractor produced triangles');
  console.log(`  Pattern 3 Strategy F OK (${verts.length / 3} verts, ${tris.length / 3} tris)`);
}

// 3. Pattern 4 — bsplineSurfacePolesAsArray + setPolesFromArray
{
  using sphere = new oc.gp_Sphere();
  sphere.SetRadius(1);
  using surf = new oc.Geom_SphericalSurface(sphere);
  using surfRev = surf.UReversed();
  using bspline = oc.GeomConvert.SurfaceToBSplineSurface(surfRev);
  using polesArr = oc.ReplicadAdapters.bsplineSurfacePolesAsArray(bspline);
  const xyz = viewFloat64(polesArr.getXyzPtr(), polesArr.getXyzSize());
  assert.ok(xyz.length === polesArr.getRows() * polesArr.getCols() * 3, 'pole shape matches');
  // Round-trip: scale all poles 2x then write back.
  const scaled = new Float64Array(xyz.length);
  for (let i = 0; i < xyz.length; i++) scaled[i] = xyz[i] * 2;
  const sptr = bytesToFloat64Buffer(Array.from(scaled));
  oc.ReplicadAdapters.bsplineSurfaceSetPolesFromArray(bspline, polesArr.getRows(), polesArr.getCols(), sptr, scaled.length);
  oc._free(sptr);
  console.log(`  Pattern 4 Strategy D OK (${polesArr.getRows()}x${polesArr.getCols()} poles)`);
}

// 4. Pattern 2 — naive arrays (parity sanity)
{
  // Build a small B-spline using the existing BSpline approximation.
  const n = 16;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push(t, t * t);
  }
  using array = new oc.NCollection_Array1_gp_Pnt2d(1, n);
  for (let i = 0; i < n; i++) {
    using p = new oc.gp_Pnt2d(pts[i * 2], pts[i * 2 + 1]);
    array.SetValue(i + 1, p);
  }
  using builder = new oc.Geom2dAPI_PointsToBSpline(array, 1, 6, oc.GeomAbs_Shape.GeomAbs_C2, 0.001);
  assert.ok(builder.IsDone(), 'BSpline builder done');
  using bspline = builder.Curve();

  using poles = oc.ReplicadAdapters.bsplinePoles2dAsArray(bspline);
  using knots = oc.ReplicadAdapters.bsplineKnots2dAsArray(bspline);
  using mults = oc.ReplicadAdapters.bsplineMults2dAsArray(bspline);

  const polesView = viewFloat64(poles.getPtr(), poles.getSize());
  const knotsView = viewFloat64(knots.getPtr(), knots.getSize());
  const multsView = viewInt32(mults.getPtr(), mults.getSize());

  assert.ok(polesView.length > 0, 'poles materialized');
  assert.ok(knotsView.length > 0, 'knots materialized');
  assert.ok(multsView.length > 0, 'mults materialized');

  // Round-trip rebuild via naive Strategy D.
  const polesPtr = bytesToFloat64Buffer(Array.from(polesView));
  const knotsPtr = bytesToFloat64Buffer(Array.from(knotsView));
  const mptr = oc._malloc(multsView.length * 4);
  oc.HEAP32.set(multsView, mptr / 4);
  using copy = oc.ReplicadAdapters.makeBSpline2dFromArrays(
    polesPtr, polesView.length,
    knotsPtr, knotsView.length,
    mptr, multsView.length,
    bspline.Degree(), bspline.IsPeriodic(),
    bspline.FirstParameter() + 0.05, bspline.LastParameter() - 0.05, 1e-9,
  );
  oc._free(polesPtr); oc._free(knotsPtr); oc._free(mptr);
  assert.ok(copy && !copy.isDeleted?.(), 'naive D rebuild OK');

  // Split-API D
  using split = oc.ReplicadAdapters.splitBSpline2dViaHandles(
    bspline,
    bspline.FirstParameter() + 0.05, bspline.LastParameter() - 0.05, 1e-9,
  );
  assert.ok(split && !split.isDeleted?.(), 'split-API D rebuild OK');

  console.log(`  Pattern 2 naive-D + split-API D OK (${polesView.length / 2} poles)`);
}

console.log('PHASE 3 SMOKE OK');
