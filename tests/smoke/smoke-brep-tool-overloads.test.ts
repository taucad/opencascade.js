/**
 * Smoke tests: BRep_Tool overload dispatch with RBV arity collisions.
 *
 * Validates that BRep_Tool static methods with same JS-visible arity
 * (after RBV output param stripping) dispatch correctly via val-based
 * runtime type checks. Specifically exercises:
 *
 * - PolygonOnTriangulation: 3-arg non-RBV (Edge, Triangulation, Location)
 *   vs 3-arg RBV (Edge, Location, int) → {P, T}
 * - PolygonOnSurface: 2-arg non-RBV (Edge, Face) vs 2-arg RBV
 *   (Edge, Location) → {C, S}
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: BRep_Tool overload dispatch (RBV arity collision)', () => {
  beforeAll(async () => {
    await initOC();
  });

  function makeTriangulatedBox() {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    const shape = box.Shape();
    const mesh = new oc.BRepMesh_IncrementalMesh(shape, 0.5, false, 0.5, false);
    const progressRange = new oc.Message_ProgressRange();
    mesh.Perform(progressRange);
    progressRange.delete();
    return {
      shape,
      cleanup: () => {
        mesh.delete();
        box.delete();
      },
    };
  }

  function getFirstTriangulatedEdge() {
    const oc = getOC();
    const { shape, cleanup } = makeTriangulatedBox();
    const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

    let edge: ReturnType<typeof oc.TopoDS.Edge> | undefined;
    let triangulation: InstanceType<typeof oc.Poly_Triangulation> | undefined;
    let location: InstanceType<typeof oc.TopLoc_Location> | undefined;

    while (explorer.More()) {
      const currentEdge = oc.TopoDS.Edge(explorer.Current());
      const loc = new oc.TopLoc_Location();
      const faceExplorer = new oc.TopExp_Explorer(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );

      if (faceExplorer.More()) {
        const face = oc.TopoDS.Face(faceExplorer.Current());
        const tri = oc.BRep_Tool.Triangulation(face, loc);
        if (!tri.isNull()) {
          const polyOnTri = oc.BRep_Tool.PolygonOnTriangulation(currentEdge, tri, loc);
          if (!polyOnTri.isNull()) {
            edge = currentEdge;
            triangulation = tri;
            location = loc;
            faceExplorer.delete();
            break;
          }
          polyOnTri.delete();
        }
        tri.delete();
        face.delete();
      }
      faceExplorer.delete();
      loc.delete();
      explorer.Next();
    }
    explorer.delete();
    return { edge, triangulation, location, cleanup };
  }

  describe('PolygonOnTriangulation', () => {
    it('3-arg non-RBV: (Edge, Triangulation, Location) → Handle<PolyOnTri>', () => {
      const oc = getOC();
      const { edge, triangulation, location, cleanup } = getFirstTriangulatedEdge();

      if (!edge || !triangulation || !location) {
        cleanup();
        return;
      }

      const handle = oc.BRep_Tool.PolygonOnTriangulation(edge, triangulation, location);

      expect(handle).toBeDefined();
      expect(typeof handle.isNull).toBe('function');
      expect(handle.isNull()).toBe(false);

      handle.delete();
      location.delete();
      triangulation.delete();
      edge.delete();
      cleanup();
    });

    it('2-arg RBV: (Edge, Location) → { P, T }', () => {
      const oc = getOC();
      const { edge, cleanup } = getFirstTriangulatedEdge();

      if (!edge) {
        cleanup();
        return;
      }

      const loc = new oc.TopLoc_Location();
      const result = oc.BRep_Tool.PolygonOnTriangulation(edge, loc);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('P');
      expect(result).toHaveProperty('T');

      loc.delete();
      edge.delete();
      cleanup();
    });
  });

  describe('PolygonOnSurface', () => {
    it('2-arg non-RBV: (Edge, Face) → Handle<Poly_Polygon2D>', () => {
      const oc = getOC();
      const { shape, cleanup } = makeTriangulatedBox();
      const faceExplorer = new oc.TopExp_Explorer(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      const edgeExplorer = new oc.TopExp_Explorer(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );

      if (faceExplorer.More() && edgeExplorer.More()) {
        const face = oc.TopoDS.Face(faceExplorer.Current());
        const edge = oc.TopoDS.Edge(edgeExplorer.Current());

        const handle = oc.BRep_Tool.PolygonOnSurface(edge, face);
        expect(handle === null || typeof handle.isNull === 'function').toBe(true);

        if (handle !== null) handle.delete();
        edge.delete();
        face.delete();
      }

      edgeExplorer.delete();
      faceExplorer.delete();
      cleanup();
    });

    it('2-arg RBV: (Edge, Location) → { C, S }', () => {
      const oc = getOC();
      const { shape, cleanup } = makeTriangulatedBox();
      const edgeExplorer = new oc.TopExp_Explorer(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );

      if (edgeExplorer.More()) {
        const edge = oc.TopoDS.Edge(edgeExplorer.Current());
        const loc = new oc.TopLoc_Location();

        const result = oc.BRep_Tool.PolygonOnSurface(edge, loc);
        expect(result).toBeDefined();
        expect(result).toHaveProperty('C');
        expect(result).toHaveProperty('S');

        loc.delete();
        edge.delete();
      }

      edgeExplorer.delete();
      cleanup();
    });
  });
});
