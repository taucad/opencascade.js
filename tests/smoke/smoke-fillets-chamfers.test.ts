import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Fillets and chamfers', () => {
  it('BRepFilletAPI_MakeFillet preserves box dimensions after filleting one edge', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const boxShape = box.Shape();
    const fillet = new oc.BRepFilletAPI_MakeFillet(
      boxShape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational as never,
    );
    const explorer = new oc.TopExp_Explorer(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    if (explorer.More()) {
      const edge = oc.TopoDS_Cast.Edge(explorer.Current());
      fillet.Add_2(2, edge);
      edge.delete();
    }
    fillet.Build(new oc.Message_ProgressRange());
    const shape = fillet.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 10, 10],
      center: [5, 5, 5],
      tolerance: 1,
    });

    box.delete();
    fillet.delete();
    explorer.delete();
  });

  it('BRepFilletAPI_MakeChamfer preserves box dimensions after chamfering one edge', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const boxShape = box.Shape();
    const chamfer = new oc.BRepFilletAPI_MakeChamfer(boxShape);
    const explorer = new oc.TopExp_Explorer(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    if (explorer.More()) {
      const edge = oc.TopoDS_Cast.Edge(explorer.Current());
      chamfer.Add(2, edge);
      edge.delete();
    }
    chamfer.Build(new oc.Message_ProgressRange());
    const shape = chamfer.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 10, 10],
      center: [5, 5, 5],
      tolerance: 1,
    });

    box.delete();
    chamfer.delete();
    explorer.delete();
  });

  it('Fillet all edges of a box produces a rounded box with same dimensions', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(20, 20, 20);
    const boxShape = box.Shape();
    const fillet = new oc.BRepFilletAPI_MakeFillet(
      boxShape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational as never,
    );

    const explorer = new oc.TopExp_Explorer(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    while (explorer.More()) {
      const edge = oc.TopoDS_Cast.Edge(explorer.Current());
      fillet.Add_2(3, edge);
      edge.delete();
      explorer.Next();
    }
    fillet.Build(new oc.Message_ProgressRange());
    const shape = fillet.Shape();

    await expectShapeGeometry(shape, {
      size: [20, 20, 20],
      center: [10, 10, 10],
      tolerance: 1,
    });

    fillet.delete();
    explorer.delete();
    box.delete();
  });
});
