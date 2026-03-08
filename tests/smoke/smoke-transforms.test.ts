import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Transforms', () => {
  it('gp_Trsf translation shifts box center by (5,0,0)', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const trsf = new oc.gp_Trsf();
    trsf.SetTranslation(new oc.gp_Vec_4(5, 0, 0));
    const transform = new oc.BRepBuilderAPI_Transform(
      box.Shape(),
      trsf,
      false,
      false,
    );
    const shape = transform.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 10, 10],
      center: [10, 5, 5],
      tolerance: 1,
    });

    box.delete();
    trsf.delete();
    transform.delete();
  });

  it('gp_Trsf rotation preserves bounding box dimensions', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const trsf = new oc.gp_Trsf();
    const axis = new oc.gp_Ax1_2(
      new oc.gp_Pnt(),
      new oc.gp_Dir_5(0, 0, 1),
    );
    trsf.SetRotation(axis, Math.PI / 4);
    const transform = new oc.BRepBuilderAPI_Transform(
      box.Shape(),
      trsf,
      false,
      false,
    );
    const shape = transform.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);

    const diag = 10 * Math.SQRT2;
    await expectShapeGeometry(shape, {
      size: [diag, diag, 10],
      tolerance: 1,
    });

    box.delete();
    trsf.delete();
    axis.delete();
    transform.delete();
  });

  it('gp_Trsf scale doubles all box dimensions', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const trsf = new oc.gp_Trsf();
    trsf.SetScale(new oc.gp_Pnt(), 2);
    const transform = new oc.BRepBuilderAPI_Transform(
      box.Shape(),
      trsf,
      false,
      false,
    );
    const shape = transform.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [20, 20, 20],
      center: [10, 10, 10],
      tolerance: 1,
    });

    box.delete();
    trsf.delete();
    transform.delete();
  });
});
