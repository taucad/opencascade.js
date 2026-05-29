/**
 * Smoke: meshing pipeline — BRepMesh_IncrementalMesh populates face triangulation.
 *
 * BRepMesh_FaceChecker depends on IMeshData_Face handles that are not part of the
 * generated JS surface; this test still exercises incremental meshing + BRep_Tool.
 *
 * Canary marker (replicad bug fix): per the replicad post-migration
 * audit (`docs/research/ocjs-replicad-post-migration-simplifications.md`,
 * `Shape._mesh` bug-fix finding), replicad currently calls
 * `new BRepMesh_IncrementalMesh(shape, tolerance, false, angularTolerance, false)`
 * — the explicit 5-arg fan-out variant — to dodge the sub-2a (matrix
 * row 7) cross-arity dispatch confusion documented in the policy doc.
 * BRepMesh_IncrementalMesh is the canonical row-7 example: an arity-3
 * `(Shape, IMeshTools_Parameters, ProgressRange)` ctor and an arity-5
 * `(Shape, double, bool, double, bool)` ctor share the same Shape
 * first parameter and have to be discriminated by JS-type of the
 * second argument.
 *
 * This file pins the 5-arg fan-out variant pre-Phase-4 (the call shape
 * replicad uses today). Post-Phase-4 the val-merged single ctor at the
 * larger arity will route both shapes correctly and the explicit 5-arg
 * form continues to work as a superset (per the policy rule 5 strict-
 * null semantics — explicit `false` is honoured verbatim; only `null`
 * would route through the rule-5 strict branch).
 *
 * Policy pin: matrix rows 1 + 7 + 24 + rule 5.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: BRepMesh incremental mesh + triangulation', () => {
  beforeAll(async () => {
    await initOC();
  });

  it('BRepMesh_IncrementalMesh yields a face triangulation with triangles', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(6, 6, 6);
    using shape = box.Shape();
    using mesh = new oc.BRepMesh_IncrementalMesh(shape, 0.25, false, 0.5, false);

    using explorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    expect(explorer.More()).toBe(true);
    using explorerCurrent = explorer.Current();
    using face = oc.TopoDS.Face(explorerCurrent);

    using loc = new oc.TopLoc_Location();
    /** `Poly_MeshPurpose_NONE` — default visualization mesh (see `Poly_MeshPurpose.hxx`). */
    const meshPurposeNone = 0;
    using tri = oc.BRep_Tool.Triangulation(face, loc, meshPurposeNone);
    expect(tri.NbTriangles()).toBeGreaterThan(0);
    expect(tri.NbNodes()).toBeGreaterThan(2);
  });
});
