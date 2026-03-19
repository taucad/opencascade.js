import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Fillets and chamfers', () => {
  beforeAll(async () => { await initOC(); });

  it('should preserve box dimensions after filleting one edge', async () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const boxShape = box.Shape();
    const fillet = new oc.BRepFilletAPI_MakeFillet(
      boxShape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    );
    const explorer = new oc.TopExp_Explorer(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    if (explorer.More()) {
      const edge = oc.TopoDS.Edge(explorer.Current());
      fillet.Add(2, edge);
      edge.delete();
    }
    fillet.Build(new oc.Message_ProgressRange());
    const shape = fillet.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 10, 10],
      center: [5, 5, 5],
    });

    box.delete();
    fillet.delete();
    explorer.delete();
  });

  it('should preserve box dimensions after chamfering one edge', async () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const boxShape = box.Shape();
    const chamfer = new oc.BRepFilletAPI_MakeChamfer(boxShape);
    const explorer = new oc.TopExp_Explorer(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    if (explorer.More()) {
      const edge = oc.TopoDS.Edge(explorer.Current());
      chamfer.Add(2, edge);
      edge.delete();
    }
    chamfer.Build(new oc.Message_ProgressRange());
    const shape = chamfer.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 10, 10],
      center: [5, 5, 5],
    });

    box.delete();
    chamfer.delete();
    explorer.delete();
  });

  it('should produce a rounded box with same dimensions when filleting all edges', async () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox(20, 20, 20);
    const boxShape = box.Shape();
    const fillet = new oc.BRepFilletAPI_MakeFillet(
      boxShape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    );

    const explorer = new oc.TopExp_Explorer(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (explorer.More()) {
      const edge = oc.TopoDS.Edge(explorer.Current());
      fillet.Add(3, edge);
      edge.delete();
      explorer.Next();
    }
    fillet.Build(new oc.Message_ProgressRange());
    const shape = fillet.Shape();

    await expectShapeGeometry(shape, {
      size: [20, 20, 20],
      center: [10, 10, 10],
    });

    fillet.delete();
    explorer.delete();
    box.delete();
  });
});
