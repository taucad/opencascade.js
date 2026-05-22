// Shared OCCT helpers for the complex example ports.
//
// Mirrors the small subset of replicad's geometry/builders that the gear,
// vase, and nozzle ports need. Uses ES2026 `using` declarations everywhere a
// transient is created, matching the PoC's chosen GC discipline.
//
// Source attribution for ported pieces is noted inline; each block cites the
// replicad TS function it mirrors at the line range that was current as of
// 2026-05-16.

import { asPnt, asPnt2d } from './setup.mjs';

/**
 * Build a TopoDS_Edge representing a line segment from `a` to `b`.
 * Mirrors replicad/src/shapeHelpers.ts makeLine (line ~110-130).
 * Caller owns the returned edge.
 */
export function makeLine(oc, a, b) {
  using p1 = asPnt(oc, a);
  using p2 = asPnt(oc, b);
  using seg = new oc.GC_MakeSegment(p1, p2);
  if (!seg.IsDone()) throw new Error('GC_MakeSegment failed');
  using curve = seg.Value();
  using maker = new oc.BRepBuilderAPI_MakeEdge(curve);
  return maker.Edge();
}

/**
 * Build a TopoDS_Edge representing a three-point arc through a→mid→b.
 * Mirrors replicad/src/shapeHelpers.ts makeThreePointArc (line ~155-175).
 */
export function makeThreePointArc(oc, a, mid, b) {
  using p1 = asPnt(oc, a);
  using p2 = asPnt(oc, mid);
  using p3 = asPnt(oc, b);
  using arc = new oc.GC_MakeArcOfCircle(p1, p2, p3);
  if (!arc.IsDone()) throw new Error('GC_MakeArcOfCircle failed');
  using curve = arc.Value();
  using maker = new oc.BRepBuilderAPI_MakeEdge(curve);
  return maker.Edge();
}

/**
 * Build a Bezier curve TopoDS_Edge through the supplied control points.
 * Mirrors replicad/src/shapeHelpers.ts makeBezierCurve (line ~135-152).
 * The point count determines the degree (n control points → degree n-1).
 */
export function makeBezierCurve(oc, points) {
  using poles = new oc.NCollection_Array1_gp_Pnt(1, points.length);
  for (let i = 0; i < points.length; i++) {
    using p = asPnt(oc, points[i]);
    poles.SetValue(i + 1, p);
  }
  using bezier = new oc.Geom_BezierCurve(poles);
  using maker = new oc.BRepBuilderAPI_MakeEdge(bezier);
  return maker.Edge();
}

/**
 * Assemble a TopoDS_Wire from an ordered list of TopoDS_Edges.
 * Mirrors replicad/src/shapeHelpers.ts assembleWire (line ~178-200).
 * The wire is closed if the first edge's start matches the last edge's end.
 */
export function assembleWire(oc, edges) {
  using maker = new oc.BRepBuilderAPI_MakeWire();
  for (const edge of edges) {
    maker.Add(edge);
  }
  if (!maker.IsDone()) {
    throw new Error(`assembleWire failed: ${maker.Error()}`);
  }
  return maker.Wire();
}

/**
 * Make a planar TopoDS_Face from a wire on the XY plane.
 * Mirrors replicad/src/shapeHelpers.ts makeFace (line ~210-225).
 */
export function makeFace(oc, wire) {
  using maker = new oc.BRepBuilderAPI_MakeFace(wire, true);
  if (!maker.IsDone()) throw new Error('BRepBuilderAPI_MakeFace failed');
  return maker.Face();
}

/**
 * Translate a shape by (dx, dy, dz) using a fresh gp_Trsf + BRepBuilderAPI_Transform.
 * Returns a NEW shape (no aliasing into the input).
 */
export function translate(oc, shape, [dx, dy, dz]) {
  using trsf = new oc.gp_Trsf();
  using vec = new oc.gp_Vec(dx, dy, dz);
  trsf.SetTranslation(vec);
  using transformer = new oc.BRepBuilderAPI_Transform(shape, trsf, false);
  return transformer.Shape();
}

/**
 * Translate along Z only.
 */
export function translateZ(oc, shape, dz) {
  return translate(oc, shape, [0, 0, dz]);
}

/**
 * Rotate a shape around the Z axis by `angleRad` radians (passing through origin).
 * Returns a NEW shape.
 */
export function rotateZ(oc, shape, angleRad) {
  using trsf = new oc.gp_Trsf();
  using origin = new oc.gp_Pnt(0, 0, 0);
  using zDir = new oc.gp_Dir(0, 0, 1);
  using axis = new oc.gp_Ax1(origin, zDir);
  trsf.SetRotation(axis, angleRad);
  using transformer = new oc.BRepBuilderAPI_Transform(shape, trsf, false);
  return transformer.Shape();
}

/**
 * Linear extrude a face along Z by `height`. Returns a TopoDS_Solid.
 */
export function extrudeLinear(oc, face, height) {
  using vec = new oc.gp_Vec(0, 0, height);
  using prism = new oc.BRepPrimAPI_MakePrism(face, vec, false, true);
  return prism.Shape();
}

/**
 * Twisted-loft extrude: build a solid from `wire` lofted between z=0 and
 * z=height, with the top wire rotated by `twistAngleRad` around the Z axis.
 *
 * This mirrors replicad's Sketch.extrude({ twistAngle }) implementation
 * (replicad/src/sketch.ts ~700-740), which builds the result via
 * BRepOffsetAPI_ThruSections between the two profile wires.
 */
export function extrudeTwist(oc, wire, height, twistAngleRad) {
  using topRotated = rotateZ(oc, wire, twistAngleRad);
  using topMoved = translateZ(oc, topRotated, height);

  using thru = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
  thru.AddWire(wire);
  // topMoved is a TopoDS_Shape; we need to extract the Wire from it after transform.
  using ex = new oc.TopExp_Explorer(topMoved, oc.TopAbs_ShapeEnum.TopAbs_WIRE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  if (!ex.More()) throw new Error('extrudeTwist: top shape has no wire');
  using topWire = oc.TopoDS.Wire(ex.Current());
  thru.AddWire(topWire);
  thru.CheckCompatibility(false);

  using progress = new oc.Message_ProgressRange();
  thru.Build(progress);
  if (!thru.IsDone()) throw new Error('BRepOffsetAPI_ThruSections failed');
  return thru.Shape();
}

/**
 * Revolve a face around an axis (gp_Ax1) by 2*PI to make a solid of revolution.
 */
export function revolveFull(oc, face, axis) {
  using revol = new oc.BRepPrimAPI_MakeRevol(face, axis, 2 * Math.PI, false);
  return revol.Shape();
}

/**
 * Boolean cut: tool subtracted from blank. Returns a new shape.
 */
export function booleanCut(oc, blank, tool) {
  using progress = new oc.Message_ProgressRange();
  using cut = new oc.BRepAlgoAPI_Cut(blank, tool, progress);
  return cut.Shape();
}

/**
 * Boolean fuse: a + b. Returns a new shape.
 */
export function booleanFuse(oc, a, b) {
  using progress = new oc.Message_ProgressRange();
  using fuse = new oc.BRepAlgoAPI_Fuse(a, b, progress);
  return fuse.Shape();
}

/**
 * Iterate every TopoDS_Edge of `shape` and yield it (callback receives a NEW
 * borrowed handle that the caller must dispose). Mirrors replicad's edge
 * iteration over a shape.
 *
 * Note: TopExp_Explorer(TopAbs_EDGE) walks per face — every edge shared
 * between two faces appears twice. We dedupe by endpoint positions
 * (quantized to 1e-6) to give callers a unique-edge view.
 */
export function forEachEdge(oc, shape, callback) {
  const seen = new Set();
  using ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) {
    using edge = oc.TopoDS.Edge(ex.Current());
    const key = edgeKey(oc, edge);
    if (seen.has(key)) continue;
    seen.add(key);
    callback(edge);
  }
}

/**
 * Build a direction-invariant key from an edge's vertex positions (quantized
 * to 1e-6 mm). Two edges with the same endpoints map to the same key, which
 * is sufficient to dedupe TopExp_Explorer's per-face edge repetition.
 */
function edgeKey(oc, edge) {
  const points = [];
  using vex = new oc.TopExp_Explorer(edge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; vex.More(); vex.Next()) {
    using v = oc.TopoDS.Vertex(vex.Current());
    using p = oc.BRep_Tool.Pnt(v);
    points.push(Math.round(p.X() * 1e6) + ',' + Math.round(p.Y() * 1e6) + ',' + Math.round(p.Z() * 1e6));
  }
  points.sort();
  return points.join('|');
}

/**
 * Iterate every TopoDS_Vertex of `shape` returning its (x, y, z) position.
 */
export function vertexPositions(oc, shape) {
  const out = [];
  using ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) {
    using v = oc.TopoDS.Vertex(ex.Current());
    using p = oc.BRep_Tool.Pnt(v);
    out.push([p.X(), p.Y(), p.Z()]);
  }
  return out;
}

/**
 * Fillet ALL edges whose two endpoints are at (approximately) the given z.
 * Crude analogue of replicad's `edgeFinder.inPlane('XY', z)` filtering, but
 * sufficient for the benchmark fixtures (vase bottom rim, gear chamfer).
 *
 * `radius` is the fillet radius. Set `mode = 'chamfer'` for chamfer instead.
 */
export function filletAtZ(oc, shape, z, radius, mode = 'fillet', tol = 1e-3) {
  const Ctor = mode === 'chamfer' ? oc.BRepFilletAPI_MakeChamfer : oc.BRepFilletAPI_MakeFillet;
  using maker = new Ctor(shape);
  let added = 0;
  const seen = new Set();
  using ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) {
    using edge = oc.TopoDS.Edge(ex.Current());
    using vex = new oc.TopExp_Explorer(edge, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    let allMatch = true;
    let any = false;
    const key = [];
    for (; vex.More(); vex.Next()) {
      using v = oc.TopoDS.Vertex(vex.Current());
      using p = oc.BRep_Tool.Pnt(v);
      any = true;
      if (Math.abs(p.Z() - z) > tol) { allMatch = false; break; }
      key.push(Math.round(p.X() * 1e6) + ',' + Math.round(p.Y() * 1e6) + ',' + Math.round(p.Z() * 1e6));
    }
    if (!any || !allMatch) continue;
    key.sort();
    const k = key.join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    maker.Add(radius, edge);
    added++;
  }
  if (added === 0) throw new Error(`filletAtZ at z=${z}: no edges matched`);
  using progress = new oc.Message_ProgressRange();
  maker.Build(progress);
  if (!maker.IsDone()) throw new Error(`${mode} build failed`);
  return maker.Shape();
}

// ── M-coverage extensions ─────────────────────────────────────────────────
// Helpers added for the M1–M7 model port (NCollection coverage matrix).

/**
 * Build a 2D B-spline curve passing through `pts2d` via Geom2dAPI_Interpolate.
 * Returns a Geom2d_BSplineCurve handle (caller `using`s the result).
 *
 * Used by M1 to construct a curve with a controllable NbPoles count (which is
 * 1:1 with pts2d.length for non-periodic curves at C2 continuity).
 */
export function interpolatePoints2d(oc, pts2d, periodic = false, tolerance = 1e-7) {
  // Build a plain NCollection_Array1, fill it, then wrap with HArray1 via the
  // copy-from-array constructor. Avoids the `ChangeArray1()` reference dance
  // that disposes a borrowed handle.
  using flat = new oc.NCollection_Array1_gp_Pnt2d(1, pts2d.length);
  for (let i = 0; i < pts2d.length; i++) {
    using p = asPnt2d(oc, pts2d[i]);
    flat.SetValue(i + 1, p);
  }
  using arr = new oc.NCollection_HArray1_gp_Pnt2d(flat);
  using interp = new oc.Geom2dAPI_Interpolate(arr, periodic, tolerance);
  interp.Perform();
  if (!interp.IsDone()) throw new Error('Geom2dAPI_Interpolate failed');
  return interp.Curve();
}

/**
 * Build a 3D B-spline curve passing through `pts3d` via GeomAPI_Interpolate.
 * Returns a Geom_BSplineCurve handle. Used by M5 (helical spine).
 */
export function interpolatePoints3d(oc, pts3d, periodic = false, tolerance = 1e-7) {
  using flat = new oc.NCollection_Array1_gp_Pnt(1, pts3d.length);
  for (let i = 0; i < pts3d.length; i++) {
    using p = asPnt(oc, pts3d[i]);
    flat.SetValue(i + 1, p);
  }
  using arr = new oc.NCollection_HArray1_gp_Pnt(flat);
  using interp = new oc.GeomAPI_Interpolate(arr, periodic, tolerance);
  interp.Perform();
  if (!interp.IsDone()) throw new Error('GeomAPI_Interpolate failed');
  return interp.Curve();
}

/**
 * Sweep a closed profile wire along a spine wire to produce a TopoDS_Solid.
 *
 * `withContact = true` translates the profile so its origin touches the spine
 * start; `withCorrection = true` rotates it so its normal aligns with the
 * spine tangent. Mirrors replicad's `pipe` helper.
 *
 * Returns a new TopoDS_Shape (the swept solid).
 */
export function pipeShellWithProfile(oc, spineWire, profileWire, {
  withContact = true,
  withCorrection = true,
  makeSolid = true,
  tolerance = 1e-3,
} = {}) {
  using pipe = new oc.BRepOffsetAPI_MakePipeShell(spineWire);
  pipe.SetTolerance(tolerance, tolerance, tolerance * 0.1);
  pipe.Add(profileWire, withContact, withCorrection);
  if (!pipe.IsReady()) throw new Error('BRepOffsetAPI_MakePipeShell: not ready');
  using progress = new oc.Message_ProgressRange();
  pipe.Build(progress);
  if (!pipe.IsDone()) throw new Error(`BRepOffsetAPI_MakePipeShell build failed (status=${pipe.GetStatus()})`);
  if (makeSolid) {
    if (!pipe.MakeSolid()) throw new Error('BRepOffsetAPI_MakePipeShell::MakeSolid failed');
  }
  return pipe.Shape();
}

/**
 * Hollow `solid` by removing the supplied face(s) and offsetting the
 * remaining shell inward (negative offset) or outward (positive).
 * Mirrors replicad's `shell` operation. Returns a new TopoDS_Shape.
 *
 * facesToRemove must be an array of TopoDS_Face borrowed handles (not
 * disposed during this call; caller still owns them).
 */
export function shellSolid(oc, solid, facesToRemove, offset, tolerance = 1e-3) {
  using facesList = new oc.NCollection_List_TopoDS_Shape();
  for (const f of facesToRemove) facesList.Append(f);
  using maker = new oc.BRepOffsetAPI_MakeThickSolid();
  using progress = new oc.Message_ProgressRange();
  // Mode = Skin (default), Intersection = false, SelfInter = false,
  // Join = Arc (default), RemoveIntEdges = false.
  maker.MakeThickSolidByJoin(
    solid, facesList, offset, tolerance,
    oc.BRepOffset_Mode.BRepOffset_Skin,
    false, false,
    oc.GeomAbs_JoinType.GeomAbs_Arc,
    false, progress,
  );
  if (!maker.IsDone()) throw new Error('BRepOffsetAPI_MakeThickSolid failed');
  return maker.Shape();
}

/**
 * Build a helical wire of `turns` turns around the Z axis, radius `radius`,
 * pitch `pitch` (Z advance per full revolution), discretised at
 * `samplesPerTurn` points per turn. Returned as a TopoDS_Wire suitable as a
 * spine for `pipeShellWithProfile`.
 *
 * Helix sampling is done in JS (deterministic, no NCollection adapters), then
 * funnelled through GeomAPI_Interpolate to produce a smooth BSpline edge.
 * Used by M5 (threaded screw).
 */
export function makeHelicalWire(oc, radius, pitch, turns, samplesPerTurn = 24) {
  const nPts = Math.max(3, Math.round(turns * samplesPerTurn) + 1);
  const pts = new Array(nPts);
  for (let i = 0; i < nPts; i++) {
    const t = (turns * 2 * Math.PI * i) / (nPts - 1);
    const z = (pitch * i) / (samplesPerTurn);
    pts[i] = [radius * Math.cos(t), radius * Math.sin(t), z];
  }
  using curve = interpolatePoints3d(oc, pts, false, 1e-6);
  using edgeMaker = new oc.BRepBuilderAPI_MakeEdge(curve);
  using edge = edgeMaker.Edge();
  using wireMaker = new oc.BRepBuilderAPI_MakeWire();
  wireMaker.Add(edge);
  if (!wireMaker.IsDone()) throw new Error('makeHelicalWire: wire assembly failed');
  return wireMaker.Wire();
}

/**
 * Load a STEP file from disk, write it to the Emscripten virtual FS at
 * `/tmp/<basename>.step`, run STEPControl_Reader → TransferRoots → OneShape,
 * and return the resulting TopoDS_Shape (typically a TopoDS_Compound for
 * multi-component assemblies).
 *
 * `nodeFsBytes` should be a Uint8Array already loaded from the host FS.
 * Keeps the wasm-side write off the bench's hot path (callers should load +
 * write ONCE during harness setup, not per-iteration).
 */
export function writeStepBytesToWasm(oc, virtualPath, bytes) {
  // Cheap, idempotent: createDataFile fails if path exists, but writeFile
  // overwrites. Use writeFile uniformly.
  oc.FS.writeFile(virtualPath, bytes);
}

export function loadStepShape(oc, virtualPath) {
  using reader = new oc.STEPControl_Reader();
  const status = reader.ReadFile(virtualPath);
  // IFSelect_ReturnStatus_RetDone = 0
  if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
    throw new Error(`STEPControl_Reader.ReadFile failed: status=${status}`);
  }
  using progress = new oc.Message_ProgressRange();
  const nbTransferred = reader.TransferRoots(progress);
  if (nbTransferred === 0) {
    throw new Error('STEPControl_Reader.TransferRoots: zero shapes transferred');
  }
  return reader.OneShape();
}

/**
 * Iterate the top-level solids of `shape` (typically a TopoDS_Compound from
 * a STEP load). Returns an array of disposable TopoDS_Shape handles (one per
 * solid). Caller owns each entry and must dispose them.
 */
export function collectSolids(oc, shape) {
  const solids = [];
  using ex = new oc.TopExp_Explorer(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_SOLID,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  for (; ex.More(); ex.Next()) {
    // Note: TopoDS.Solid returns a borrowed handle; we copy via identity
    // transform so each entry is independently owned and outlives the loop.
    using rawSolid = oc.TopoDS.Solid(ex.Current());
    using idTrsf = new oc.gp_Trsf();
    using copier = new oc.BRepBuilderAPI_Transform(rawSolid, idTrsf, false);
    solids.push(copier.Shape());
  }
  return solids;
}
