// Pattern 4 — Ellipsoid Poles (NCollection_Array2 → JS array, mutate, write back).
// Ported from replicad/packages/replicad/src/shapeHelpers.ts (makeEllipsoid +
// convertToJSArray + EllpsoidTransform).

function makeAx1(oc, [lx, ly, lz], [dx, dy, dz]) {
  using p = new oc.gp_Pnt(lx, ly, lz);
  using d = new oc.gp_Dir(dx, dy, dz);
  return new oc.gp_Ax1(p, d);
}

function buildEllipsoidGTrsf(oc, x, y, z) {
  const xyRatio = Math.sqrt((x * y) / z);
  const xzRatio = x / xyRatio;
  const yzRatio = y / xyRatio;

  const transform = new oc.gp_GTrsf();
  using axY = makeAx1(oc, [0, 0, 0], [0, 1, 0]);
  transform.SetAffinity(axY, xzRatio);
  using xy = new oc.gp_GTrsf();
  using axZ = makeAx1(oc, [0, 0, 0], [0, 0, 1]);
  xy.SetAffinity(axZ, xyRatio);
  using yz = new oc.gp_GTrsf();
  using axX = makeAx1(oc, [0, 0, 0], [1, 0, 0]);
  yz.SetAffinity(axX, yzRatio);
  transform.Multiply(xy);
  transform.Multiply(yz);
  return transform;
}

/**
 * STATUS QUO — replicad's existing pattern: walk Array2 in JS, allocate one
 * gp_Pnt per pole on every read.
 */
export function makeEllipsoidStatusQuo(oc, aLength, bLength, cLength) {
  using sphere = new oc.gp_Sphere();
  sphere.SetRadius(1);
  using sphericalSurface = new oc.Geom_SphericalSurface(sphere);

  using surfReversed = sphericalSurface.UReversed();
  using baseSurface = oc.GeomConvert.SurfaceToBSplineSurface(surfReversed);

  // NOTE: NCollection_Array2_gp_Pnt::Value(r, c) is *not* exposed through the
  // current NCollection bindings (this is the exact gap that motivates
  // Option D). Replicad's `convertToJSArray` walks Value(r, c); without it we
  // walk per-pole through Geom_BSplineSurface::Pole(u, v), which is identical
  // in cost (one embind hop per pole + one gp_Pnt allocation per pole).
  const nbU = baseSurface.NbUPoles();
  const nbV = baseSurface.NbVPoles();

  using transform = buildEllipsoidGTrsf(oc, aLength, bLength, cLength);

  for (let u = 1; u <= nbU; u++) {
    for (let v = 1; v <= nbV; v++) {
      using value = baseSurface.Pole(u, v);
      using coords = value.XYZ();
      transform.Transforms(coords);
      using newPnt = new oc.gp_Pnt(coords);
      baseSurface.SetPole(u, v, newPnt);
    }
  }

  using surf2 = baseSurface.UReversed();
  using shellMaker = new oc.BRepBuilderAPI_MakeShell(surf2, false);
  return shellMaker.Shell();
}

/**
 * STRATEGY D — pull the entire NCollection_Array2 down as a flat
 * Float64Array in one C++ call; mutate in JS; flush back via a single
 * Strategy-D adapter.
 */
export function makeEllipsoidStrategyD(oc, aLength, bLength, cLength) {
  using sphere = new oc.gp_Sphere();
  sphere.SetRadius(1);
  using sphericalSurface = new oc.Geom_SphericalSurface(sphere);
  using surfReversed = sphericalSurface.UReversed();
  using baseSurface = oc.GeomConvert.SurfaceToBSplineSurface(surfReversed);

  // Adapter pulls all NbU*NbV poles down as a flat Float64Array buffer in wasm
  // linear memory — one C++ call replaces NbU*NbV per-pole embind hops.
  using polesEnv = oc.ReplicadAdapters.bsplineSurfacePolesAsArray(baseSurface);
  const rows = polesEnv.getRows();
  const cols = polesEnv.getCols();
  const xyzPtr = polesEnv.getXyzPtr();
  const xyzLen = polesEnv.getXyzSize();
  const heap = oc.HEAPF64;
  const offset = xyzPtr >>> 3;

  using transform = buildEllipsoidGTrsf(oc, aLength, bLength, cLength);

  // Mutate the flat buffer *in place* in wasm linear memory. No JS-side copy
  // and no second malloc: the same buffer is handed back to the flush adapter.
  for (let i = 0; i < rows * cols; i++) {
    const o = offset + i * 3;
    using xyz = new oc.gp_XYZ(heap[o], heap[o + 1], heap[o + 2]);
    transform.Transforms(xyz);
    heap[o + 0] = xyz.X();
    heap[o + 1] = xyz.Y();
    heap[o + 2] = xyz.Z();
  }

  oc.ReplicadAdapters.bsplineSurfaceSetPolesFromArray(baseSurface, rows, cols, xyzPtr, xyzLen);

  using surf2 = baseSurface.UReversed();
  using shellMaker = new oc.BRepBuilderAPI_MakeShell(surf2, false);
  return shellMaker.Shell();
}
