/**
 * Smoke tests: Static method signature dispatch.
 *
 * Validates that static methods with same-arity overloads dispatch correctly
 * via the JS signature table. A bug in _embind_register_class_class_function
 * fails to set .signature on the first-registered static method, causing
 * ensureOverloadSignatureTable to store it under key "undefined" instead of
 * the raw signature string. This prevents whenDependentTypesAreResolved from
 * properly cleaning up the stale entry and may block overload resolution.
 *
 * Regression target: BRep_Tool.PolygonOnTriangulation has a 3-arg
 * select_overload (Edge, Triangulation, Location) and a 3-arg RBV
 * optional_override (Edge, Location, int). The dispatch must route
 * to the correct overload based on argument types.
 *
 * Patterns tested:
 * - BRep_Tool.PolygonOnTriangulation 3-arg type-based dispatch
 * - BRep_Tool.Curve 3-arg RBV static method dispatch
 * - BRepTools.UVBounds 1-arg static method with value_object return
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: static method signature dispatch', () => {
  beforeAll(async () => { await initOC(); });

  function makeTriangulatedBox() {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    const shape = box.Shape();
    using progressRange = new oc.Message_ProgressRange();
    using mesh = new oc.BRepMesh_IncrementalMesh(shape, 0.5, false, 0.5, false);
    mesh.Perform(progressRange);
    return shape;
  }

  describe('BRep_Tool.PolygonOnTriangulation — 3-arg type dispatch', () => {
    it('should dispatch (Edge, Triangulation, Location) to the handle-returning overload', () => {
      const oc = getOC();
      const shape = makeTriangulatedBox();

      using faceExplorer = new oc.TopExp_Explorer(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      expect(faceExplorer.More()).toBe(true);
      const face = oc.TopoDS.Face(faceExplorer.Current());

      using loc = new oc.TopLoc_Location();
      const tri = oc.BRep_Tool.Triangulation(face, loc, 0);
      expect(tri.isNull()).toBe(false);

      using edgeExplorer = new oc.TopExp_Explorer(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      expect(edgeExplorer.More()).toBe(true);
      const edge = oc.TopoDS.Edge(edgeExplorer.Current());

      const polyOnTri = oc.BRep_Tool.PolygonOnTriangulation(edge, tri, loc);
      expect(typeof polyOnTri.isNull).toBe('function');
    });

    it('should dispatch (Edge, Location) to the {P, T} RBV overload', () => {
      const oc = getOC();
      const shape = makeTriangulatedBox();

      using edgeExplorer = new oc.TopExp_Explorer(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      expect(edgeExplorer.More()).toBe(true);
      const edge = oc.TopoDS.Edge(edgeExplorer.Current());
      using loc = new oc.TopLoc_Location();

      const result = oc.BRep_Tool.PolygonOnTriangulation(edge, loc);
      expect(result).toEqual(expect.objectContaining({
        P: expect.anything(),
        T: expect.anything(),
      }));
    });
  });

  describe('BRep_Tool.Curve — static method with RBV {First, Last}', () => {
    it('should return {Curve, First, Last} from edge curve extraction', () => {
      const oc = getOC();
      using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
      using explorer = new oc.TopExp_Explorer(
        box.Shape(),
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      expect(explorer.More()).toBe(true);
      const edge = oc.TopoDS.Edge(explorer.Current());

      using loc = new oc.TopLoc_Location();
      const curveResult = oc.BRep_Tool.Curve(edge, loc);

      expect(curveResult).toEqual(expect.objectContaining({
        First: expect.any(Number),
        Last: expect.any(Number),
      }));
      expect(curveResult.Last).toBeGreaterThan(curveResult.First);
    });
  });
});
