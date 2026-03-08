import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Fillets and chamfers', () => {
  it('BRepFilletAPI_MakeFillet adds fillet to first edge of box', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const boxShape = box.Shape();
    const fillet = new oc.BRepFilletAPI_MakeFillet(
      boxShape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational as never,
    );
    const explorer = new oc.TopExp_Explorer_2(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    if (explorer.More()) {
      const edge = oc.TopoDS.Edge_1(explorer.Current());
      fillet.Add_2(2, edge);
      edge.delete();
    }
    fillet.Build();
    const shape = fillet.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    box.delete();
    fillet.delete();
    explorer.delete();
  });

  it('BRepFilletAPI_MakeChamfer adds chamfer to first edge of box', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const boxShape = box.Shape();
    const chamfer = new oc.BRepFilletAPI_MakeChamfer(boxShape);
    const explorer = new oc.TopExp_Explorer_2(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    if (explorer.More()) {
      const edge = oc.TopoDS.Edge_1(explorer.Current());
      chamfer.Add(2, edge);
      edge.delete();
    }
    chamfer.Build();
    const shape = chamfer.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    box.delete();
    chamfer.delete();
    explorer.delete();
  });
});
