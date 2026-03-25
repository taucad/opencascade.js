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
    using progressRange = new oc.Message_ProgressRange();
    mesh.Perform(progressRange);
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
    using explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

    let edge: ReturnType<typeof oc.TopoDS.Edge> | undefined;
    let triangulation: InstanceType<typeof oc.Poly_Triangulation> | undefined;
    let location: InstanceType<typeof oc.TopLoc_Location> | undefined;

    while (explorer.More()) {
      const currentEdge = oc.TopoDS.Edge(explorer.Current());
      const loc = new oc.TopLoc_Location();
      using faceExplorer = new oc.TopExp_Explorer(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );

      if (faceExplorer.More()) {
        const face = oc.TopoDS.Face(faceExplorer.Current());
        const tri = oc.BRep_Tool.Triangulation(face, loc, 0);
        if (!tri.isNull()) {
          using polyOnTri = oc.BRep_Tool.PolygonOnTriangulation(currentEdge, tri, loc);
          if (!polyOnTri.isNull()) {
            edge = currentEdge;
            triangulation = tri;
            location = loc;
            break;
          }
        }
        tri.delete();
        face.delete();
      }
      loc.delete();
      explorer.Next();
    }
    return { edge, triangulation, location, cleanup };
  }

  describe('PolygonOnTriangulation', () => {
    it('should return Handle<PolyOnTri> for 3-arg non-RBV dispatch (Edge, Triangulation, Location)', () => {
      const oc = getOC();
      const { edge, triangulation, location, cleanup } = getFirstTriangulatedEdge();

      try {
        if (!edge || !triangulation || !location) {
          expect.fail('Could not find a triangulated edge in the test shape');
        }

        using handle = oc.BRep_Tool.PolygonOnTriangulation(edge, triangulation, location);
        expect(typeof handle.isNull).toBe('function');
        expect(handle.isNull()).toBe(false);
      } finally {
        location?.delete();
        triangulation?.delete();
        edge?.delete();
        cleanup();
      }
    });

    it('should return {P, T} for 2-arg RBV dispatch (Edge, Location)', () => {
      const oc = getOC();
      const { edge, cleanup } = getFirstTriangulatedEdge();

      try {
        if (!edge) {
          expect.fail('Could not find a triangulated edge in the test shape');
        }

        using loc = new oc.TopLoc_Location();
        const result = oc.BRep_Tool.PolygonOnTriangulation(edge, loc);

        expect(result).toEqual(expect.objectContaining({
          P: expect.anything(),
          T: expect.anything(),
        }));
      } finally {
        edge?.delete();
        cleanup();
      }
    });
  });

  describe('PolygonOnSurface', () => {
    it('should return Handle<Poly_Polygon2D> for 2-arg non-RBV dispatch (Edge, Face)', () => {
      const oc = getOC();
      const { shape, cleanup } = makeTriangulatedBox();

      try {
        using faceExplorer = new oc.TopExp_Explorer(
          shape,
          oc.TopAbs_ShapeEnum.TopAbs_FACE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        );
        using edgeExplorer = new oc.TopExp_Explorer(
          shape,
          oc.TopAbs_ShapeEnum.TopAbs_EDGE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        );

        expect(faceExplorer.More()).toBe(true);
        expect(edgeExplorer.More()).toBe(true);

        const face = oc.TopoDS.Face(faceExplorer.Current());
        const edge = oc.TopoDS.Edge(edgeExplorer.Current());

        const handle = oc.BRep_Tool.PolygonOnSurface(edge, face);
        expect(handle === null || typeof handle.isNull === 'function').toBe(true);

        if (handle !== null) handle.delete();
        edge.delete();
        face.delete();
      } finally {
        cleanup();
      }
    });

    it('should return {C, S} for 2-arg RBV dispatch (Edge, Location)', () => {
      const oc = getOC();
      const { shape, cleanup } = makeTriangulatedBox();

      try {
        using edgeExplorer = new oc.TopExp_Explorer(
          shape,
          oc.TopAbs_ShapeEnum.TopAbs_EDGE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        );

        expect(edgeExplorer.More()).toBe(true);

        const edge = oc.TopoDS.Edge(edgeExplorer.Current());
        using loc = new oc.TopLoc_Location();

        const result = oc.BRep_Tool.PolygonOnSurface(edge, loc);

        expect(Object.keys(result).sort()).toEqual(['C', 'S']);

        edge.delete();
      } finally {
        cleanup();
      }
    });
  });
});
