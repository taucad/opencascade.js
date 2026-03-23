/**
 * Smoke tests: Feature-based modeling.
 *
 * Validates BRepFeat_MakeDPrism for boss/pocket operations on faces.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Feature modeling', () => {
  beforeAll(async () => { await initOC(); });

  it('should create a boss on a box face that increases the shape bounding box height', async () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const boxShape = box.Shape();

    using faceExplorer = new oc.TopExp_Explorer(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );

    let topFace = faceExplorer.Current();
    let maxZ = -Infinity;

    while (faceExplorer.More()) {
      const face = oc.TopoDS.Face(faceExplorer.Current());
      using adaptor = new oc.BRepAdaptor_Surface(face);

      if (adaptor.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
        using origin = new oc.gp_Pnt(0, 0, 0);
        using normal = new oc.gp_Vec(0, 0, 0);
        const uMid = (adaptor.FirstUParameter() + adaptor.LastUParameter()) / 2;
        const vMid = (adaptor.FirstVParameter() + adaptor.LastVParameter()) / 2;

        using pnt = adaptor.Value(uMid, vMid);
        if (pnt.Z() > maxZ) {
          maxZ = pnt.Z();
          topFace = faceExplorer.Current();
        }
      }
      faceExplorer.Next();
    }

    const skFace = oc.TopoDS.Face(topFace);

    using profilePt1 = new oc.gp_Pnt(2, 2, 10);
    using profilePt2 = new oc.gp_Pnt(8, 2, 10);
    using profilePt3 = new oc.gp_Pnt(8, 8, 10);
    using profilePt4 = new oc.gp_Pnt(2, 8, 10);

    using profilePoly = new oc.BRepBuilderAPI_MakePolygon(
      profilePt1, profilePt2, profilePt3, profilePt4, true,
    );
    const profileWire = profilePoly.Wire();
    using profileFace = new oc.BRepBuilderAPI_MakeFace(profileWire, true);

    using dprism = new oc.BRepFeat_MakeDPrism(
      boxShape,
      profileFace.Face(),
      skFace,
      0,
      1,
      true,
    );
    dprism.Perform(5);

    const result = dprism.Shape();
    expect(result.IsNull()).toBe(false);

    await expectShapeGeometry(result, {
      size: [10, 10, 15],
      center: [5, 5, 7.5],
      tolerance: 1,
    });
  });
});
