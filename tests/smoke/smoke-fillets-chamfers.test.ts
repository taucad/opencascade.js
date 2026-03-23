import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Fillets and chamfers', () => {
  beforeAll(async () => { await initOC(); });

  it('should preserve box dimensions after filleting one edge', async () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const boxShape = box.Shape();
    using fillet = new oc.BRepFilletAPI_MakeFillet(
      boxShape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    );
    using explorer = new oc.TopExp_Explorer(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    if (explorer.More()) {
      const edge = oc.TopoDS.Edge(explorer.Current());
      fillet.Add(2, edge);
    }
    fillet.Build(new oc.Message_ProgressRange());
    const shape = fillet.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 10, 10],
      center: [5, 5, 5],
    });
  });

  it('should preserve box dimensions after chamfering one edge', async () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const boxShape = box.Shape();
    using chamfer = new oc.BRepFilletAPI_MakeChamfer(boxShape);
    using explorer = new oc.TopExp_Explorer(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    if (explorer.More()) {
      const edge = oc.TopoDS.Edge(explorer.Current());
      chamfer.Add(2, edge);
    }
    chamfer.Build(new oc.Message_ProgressRange());
    const shape = chamfer.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 10, 10],
      center: [5, 5, 5],
    });
  });

  it('should produce a rounded box with same dimensions when filleting all edges', async () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(20, 20, 20);
    const boxShape = box.Shape();
    using fillet = new oc.BRepFilletAPI_MakeFillet(
      boxShape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    );

    using explorer = new oc.TopExp_Explorer(
      boxShape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (explorer.More()) {
      const edge = oc.TopoDS.Edge(explorer.Current());
      fillet.Add(3, edge);
      explorer.Next();
    }
    fillet.Build(new oc.Message_ProgressRange());
    const shape = fillet.Shape();

    await expectShapeGeometry(shape, {
      size: [20, 20, 20],
      center: [10, 10, 10],
    });
  });
});
