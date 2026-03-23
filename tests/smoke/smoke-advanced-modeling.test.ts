import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists, isExceptionsEnabled } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Advanced modeling', () => {
  beforeAll(async () => { await initOC(); });

  it('should shell a box preserving outer dimensions with MakeThickSolid', async () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(20, 20, 20);
    const boxShape = box.Shape();

    using faceExplorer = new oc.TopExp_Explorer(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    );
    faceExplorer.Next();
    const faceToRemove = faceExplorer.Current();

    using facesToRemove = new oc.TopTools_ListOfShape();
    facesToRemove.Append(faceToRemove);

    using thickSolid = new oc.BRepOffsetAPI_MakeThickSolid();
    thickSolid.MakeThickSolidByJoin(
      boxShape,
      facesToRemove,
      -2,
      1e-3,
      oc.BRepOffset_Mode.BRepOffset_Skin,
      false,
      false,
      oc.GeomAbs_JoinType.GeomAbs_Arc,
      false,
      new oc.Message_ProgressRange()
    );

    const result = thickSolid.Shape();
    expect(result.IsNull()).toBe(false);

    await expectShapeGeometry(result, {
      size: [20, 20, 20],
      center: [10, 10, 10],
    });
  });

  it('should produce loft with correct height and max diameter via ThruSections', async () => {
    const oc = getOC();
    using ax1 = new oc.gp_Ax2(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1));
    using ax2 = new oc.gp_Ax2(new oc.gp_Pnt(0, 0, 10), new oc.gp_Dir(0, 0, 1));

    using circle1 = new oc.Geom_Circle(ax1, 5);
    using circle2 = new oc.Geom_Circle(ax2, 3);

    using edge1 = new oc.BRepBuilderAPI_MakeEdge(circle1);
    using edge2 = new oc.BRepBuilderAPI_MakeEdge(circle2);

    using wire1 = new oc.BRepBuilderAPI_MakeWire(edge1.Edge());
    using wire2 = new oc.BRepBuilderAPI_MakeWire(edge2.Edge());

    using loft = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
    loft.AddWire(wire1.Wire());
    loft.AddWire(wire2.Wire());
    loft.CheckCompatibility(false);

    const result = loft.Shape();
    expect(result.IsNull()).toBe(false);

    await expectShapeGeometry(result, {
      size: [10, 10, 10],
      center: [0, 0, 5],
    });
  });

  it('should produce pipe sweep with correct dimensions via MakePipe', async (ctx) => {
    if (!isExceptionsEnabled()) ctx.skip();

    const oc = getOC();
    using p1 = new oc.gp_Pnt(0, 0, 0);
    using p2 = new oc.gp_Pnt(10, 0, 0);
    using lineEdge = new oc.BRepBuilderAPI_MakeEdge(p1, p2);
    using spineWire = new oc.BRepBuilderAPI_MakeWire(lineEdge.Edge());

    using ax = new oc.gp_Ax2(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(1, 0, 0));
    using circle = new oc.Geom_Circle(ax, 2);
    using profileEdge = new oc.BRepBuilderAPI_MakeEdge(circle);
    using profileWire = new oc.BRepBuilderAPI_MakeWire(profileEdge.Edge());

    using pipe = new oc.BRepOffsetAPI_MakePipe(spineWire.Wire(), profileWire.Wire());
    const result = pipe.Shape();
    expect(result.IsNull()).toBe(false);

    await expectShapeGeometry(result, {
      size: [10, 4, 4],
      minVertices: 10,
    });
  });
});
