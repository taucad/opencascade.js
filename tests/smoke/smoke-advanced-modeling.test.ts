import { describe, it, expect } from 'vitest';
import { getOC, wasmExists, isExceptionsEnabled } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Advanced modeling', () => {
  it('should shell a box preserving outer dimensions with MakeThickSolid', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(20, 20, 20);
    const boxShape = box.Shape();

    const faceExplorer = new oc.TopExp_Explorer(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    );
    faceExplorer.Next();
    const faceToRemove = faceExplorer.Current();

    const facesToRemove = new oc.TopTools_ListOfShape_1();
    facesToRemove.Append_1(faceToRemove);

    const thickSolid = new oc.BRepOffsetAPI_MakeThickSolid();
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

    thickSolid.delete();
    facesToRemove.delete();
    faceExplorer.delete();
    box.delete();
  });

  it('should produce loft with correct height and max diameter via ThruSections', async () => {
    const oc = await getOC();

    const ax1 = new oc.gp_Ax2_4(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir_5(0, 0, 1));
    const ax2 = new oc.gp_Ax2_4(new oc.gp_Pnt(0, 0, 10), new oc.gp_Dir_5(0, 0, 1));

    const circle1 = new oc.Geom_Circle(ax1, 5);
    const circle2 = new oc.Geom_Circle(ax2, 3);

    const edge1 = new oc.BRepBuilderAPI_MakeEdge_24(circle1);
    const edge2 = new oc.BRepBuilderAPI_MakeEdge_24(circle2);

    const wire1 = new oc.BRepBuilderAPI_MakeWire_2(edge1.Edge());
    const wire2 = new oc.BRepBuilderAPI_MakeWire_2(edge2.Edge());

    const loft = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
    loft.AddWire(wire1.Wire());
    loft.AddWire(wire2.Wire());
    loft.CheckCompatibility(false);

    const result = loft.Shape();
    expect(result.IsNull()).toBe(false);

    await expectShapeGeometry(result, {
      size: [10, 10, 10],
      center: [0, 0, 5],
    });

    loft.delete();
    wire2.delete();
    wire1.delete();
    edge2.delete();
    edge1.delete();
    circle2.delete();
    circle1.delete();
    ax2.delete();
    ax1.delete();
  });

  it('should produce pipe sweep with correct dimensions via MakePipe', async (ctx) => {
    const oc = await getOC();
    if (!isExceptionsEnabled()) ctx.skip();

    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(10, 0, 0);
    const lineEdge = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);
    const spineWire = new oc.BRepBuilderAPI_MakeWire_2(lineEdge.Edge());

    const ax = new oc.gp_Ax2_4(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir_5(1, 0, 0));
    const circle = new oc.Geom_Circle(ax, 2);
    const profileEdge = new oc.BRepBuilderAPI_MakeEdge_24(circle);
    const profileWire = new oc.BRepBuilderAPI_MakeWire_2(profileEdge.Edge());

    const pipe = new oc.BRepOffsetAPI_MakePipe(spineWire.Wire(), profileWire.Wire());
    const result = pipe.Shape();
    expect(result.IsNull()).toBe(false);

    await expectShapeGeometry(result, {
      size: [10, 4, 4],
      minVertices: 10,
    });

    pipe.delete();
    profileWire.delete();
    profileEdge.delete();
    circle.delete();
    ax.delete();
    spineWire.delete();
    lineEdge.delete();
    p2.delete();
    p1.delete();
  });
});
