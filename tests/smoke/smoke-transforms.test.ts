import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Transforms', () => {
  it('gp_Trsf translation via SetTranslation and BRepBuilderAPI_Transform', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const trsf = new oc.gp_Trsf_1();
    trsf.SetTranslation(new oc.gp_Vec_4(5, 0, 0));
    const transform = new oc.BRepBuilderAPI_Transform_2(
      box.Shape(),
      trsf,
      false,
      false,
    );
    const shape = transform.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    box.delete();
    trsf.delete();
    transform.delete();
  });

  it('gp_Trsf rotation via SetRotation and BRepBuilderAPI_Transform', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const trsf = new oc.gp_Trsf_1();
    const axis = new oc.gp_Ax1_2(
      new oc.gp_Pnt_1(),
      new oc.gp_Dir_4(0, 0, 1),
    );
    trsf.SetRotation(axis, Math.PI / 4);
    const transform = new oc.BRepBuilderAPI_Transform_2(
      box.Shape(),
      trsf,
      false,
      false,
    );
    const shape = transform.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    box.delete();
    trsf.delete();
    axis.delete();
    transform.delete();
  });

  it('gp_Trsf scale via SetScaleFactor and BRepBuilderAPI_Transform', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const trsf = new oc.gp_Trsf_1();
    trsf.SetScale(new oc.gp_Pnt_1(), 2);
    const transform = new oc.BRepBuilderAPI_Transform_2(
      box.Shape(),
      trsf,
      false,
      false,
    );
    const shape = transform.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    box.delete();
    trsf.delete();
    transform.delete();
  });
});
