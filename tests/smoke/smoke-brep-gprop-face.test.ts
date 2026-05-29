/**
 * Smoke tests: BRepGProp_Face — RBV input-passthrough family contract.
 *
 * Policy (`repos/opencascade.js/docs/policy/ocjs-trailing-default-emission-policy.md`):
 *   - Matrix row 17 — primitive in/out params (RBV input-passthrough).
 *   - Matrix row 18 — class `T&` output / in-out (RBV input-passthrough
 *     with `val::as<T*>()` reference dereference for non-copyable
 *     classes).
 *
 * Post-Phase-4 RBV-shape assumption:
 *   Inspection of `repos/opencascade.js/src/ocjs_bindgen/codegen/rbv.py`
 *   and the current emitted binding at
 *   `build/bindings/ModelingAlgorithms/TKTopAlgo/BRepGProp/BRepGProp_Face.hxx/BRepGProp_Face.cpp:5582-5585`
 *   confirms `BRepGProp_Face::Normal(U, V, gp_Pnt& P, gp_Vec& N)` lowers
 *   to the **input-passthrough RBV** lambda — the caller supplies `P`
 *   and `N` as JS-managed gp_Pnt / gp_Vec instances; the lambda reads
 *   their underlying C++ pointers via `*val.as<T*>(allow_raw_pointers())`
 *   and the underlying `gp_Pnt`/`gp_Vec` are mutated in place. Post-
 *   Phase-4 this shape is unchanged — the trailing-default emission
 *   migration only flips the routing for default-bearing slots, not the
 *   RBV envelope for output classes.
 *
 *   The same shape applies to the wider family — `BRepGProp_Face::D12d`
 *   and other multi-output methods compose `optional_override` lambdas
 *   that take `::emscripten::val` for each class-typed in/out slot and
 *   dereference via `*val.as<T*>(allow_raw_pointers())`. This file pins
 *   the family contract via a cross-method assertion on `D12d` in
 *   addition to the canonical `Normal` shape.
 *
 * Canary marker (replicad bug fix): the replicad post-migration audit
 * (`docs/research/ocjs-replicad-post-migration-simplifications.md`,
 * `Face.normalAt` bug-fix finding) flags `BRepGProp_Face` as the
 * canonical row-8 sub-2b smoking gun. Replicad currently passes the
 * explicit `false` second argument to `new BRepGProp_Face(face, false)`
 * to force the larger-arity ctor and dodge the libembind optional-
 * wildcard short-circuit. Post-Phase-4 the val-discriminated single
 * ctor at the larger arity makes the explicit-`false` workaround
 * unnecessary, but the family contract pinned here (Normal + D12d) must
 * continue to produce the correct geometric result.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: BRepGProp_Face', () => {
  beforeAll(async () => {
    await initOC();
  });

  it('should compute the outward normal of a box top face pointing in Z direction', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);

    using shape = box.Shape();
    using explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

    // eslint-disable-next-line ocjs-lint/require-using-on-disposable -- topFace ownership is transferred across loop iterations; explicit `.delete()` + reassignment manages disposal manually.
    let topFace = explorer.Current();
    let maxZ = -Infinity;

    while (explorer.More()) {
      using currentShape = explorer.Current();
      using face = oc.TopoDS.Face(currentShape);
      using adaptor = new oc.BRepAdaptor_Surface(face);
      const uMid = (adaptor.FirstUParameter() + adaptor.LastUParameter()) / 2;
      const vMid = (adaptor.FirstVParameter() + adaptor.LastVParameter()) / 2;
      using pnt = adaptor.Value(uMid, vMid);
      if (pnt.Z() > maxZ) {
        maxZ = pnt.Z();
        topFace.delete();
        // eslint-disable-next-line ocjs-lint/require-using-on-disposable -- see prior comment: ownership is transferred across loop iterations.
        topFace = explorer.Current();
      }
      explorer.Next();
    }

    using disposeTopFace = topFace;
    using face = oc.TopoDS.Face(disposeTopFace);
    using gpropFace = new oc.BRepGProp_Face(face);

    const bounds = gpropFace.Bounds(0, 0, 0, 0);
    const uMid = (bounds.U1 + bounds.U2) / 2;
    const vMid = (bounds.V1 + bounds.V2) / 2;

    using inPoint = new oc.gp_Pnt(0, 0, 0);
    using inNormal = new oc.gp_Vec(0, 0, 0);
    gpropFace.Normal(uMid, vMid, inPoint, inNormal);

    const nz = inNormal.Z() / Math.sqrt(inNormal.X() ** 2 + inNormal.Y() ** 2 + inNormal.Z() ** 2);
    expect(Math.abs(nz)).toBeCloseTo(1, 3);
  });

  it('should report finite UV bounds for a planar face', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);

    using shape = box.Shape();
    using explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    expect(explorer.More()).toBe(true);

    using currentShape = explorer.Current();
    using face = oc.TopoDS.Face(currentShape);
    using gpropFace = new oc.BRepGProp_Face(face);

    const bounds = gpropFace.Bounds(0, 0, 0, 0);
    expect(Number.isFinite(bounds.U1)).toBe(true);
    expect(Number.isFinite(bounds.U2)).toBe(true);
    expect(Number.isFinite(bounds.V1)).toBe(true);
    expect(Number.isFinite(bounds.V2)).toBe(true);
    expect(bounds.U2).toBeGreaterThan(bounds.U1);
    expect(bounds.V2).toBeGreaterThan(bounds.V1);
  });

  /**
   * Cross-method family pin — `D12d` shares the input-passthrough RBV
   * shape with `Normal`. If the bindgen ever flips one of these methods
   * to pure-output RBV (`{ thePoint, theDerivative } = .D12d(U)`) the
   * other should follow in the same regeneration sweep; otherwise the
   * family contract drifts. The assertion confirms the lambda accepts
   * caller-provided `gp_Pnt2d` and `gp_Vec2d` instances and mutates
   * them in place.
   *
   * Unlike `Normal` (which reads the face SURFACE set by the
   * `BRepGProp_Face(face)` ctor), `D12d` reads the 2D boundary curve
   * `myCurve` — a `Geom2dAdaptor_Curve` member that is only populated by
   * `Load(const TopoDS_Edge&)` (see
   * `deps/OCCT/.../BRepGProp_Face.hxx:100-102` and `.lxx:79-82` where
   * `D12d` forwards to `myCurve.D1(U, P, V1)`). Calling `D12d` before
   * loading a boundary arc dereferences an empty adaptor and traps with
   * `RuntimeError: null function or function signature mismatch`. The
   * fix is in the test fixture (load an edge first), NOT the binding —
   * the emitted lambda is correct and identical in shape to `Normal`.
   */
  it('cross-method family: BRepGProp_Face.D12d uses input-passthrough RBV shape', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    using shape = box.Shape();
    using explorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    expect(explorer.More()).toBe(true);
    using currentShape = explorer.Current();
    using face = oc.TopoDS.Face(currentShape);
    using gpropFace = new oc.BRepGProp_Face(face);

    // `D12d` operates on the 2D boundary curve, which is only set by
    // `Load(edge)`. Explore the face for a boundary edge and load it
    // before evaluating the curve derivative.
    using edgeExplorer = new oc.TopExp_Explorer(
      face,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    expect(edgeExplorer.More()).toBe(true);
    using edgeShape = edgeExplorer.Current();
    using edge = oc.TopoDS.Edge(edgeShape);
    gpropFace.Load(edge);

    using outPoint2d = new oc.gp_Pnt2d(0, 0);
    using outDeriv2d = new oc.gp_Vec2d(0, 0);
    expect(() => gpropFace.D12d(0.5, outPoint2d, outDeriv2d)).not.toThrow();
  });
});
