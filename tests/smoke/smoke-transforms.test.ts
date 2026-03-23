import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Transforms', () => {
  beforeAll(async () => { await initOC(); });

  it('should shift box center by (5,0,0) with translation', async () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    using trsf = new oc.gp_Trsf();
    trsf.SetTranslation(new oc.gp_Vec(5, 0, 0));
    using transform = new oc.BRepBuilderAPI_Transform(
      box.Shape(),
      trsf,
      false,
      false,
    );
    const shape = transform.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 10, 10],
      center: [10, 5, 5],
    });
  });

  it('should preserve bounding box dimensions with rotation', async () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    using trsf = new oc.gp_Trsf();
    using axis = new oc.gp_Ax1(
      new oc.gp_Pnt(),
      new oc.gp_Dir(0, 0, 1),
    );
    trsf.SetRotation(axis, Math.PI / 4);
    using transform = new oc.BRepBuilderAPI_Transform(
      box.Shape(),
      trsf,
      false,
      false,
    );
    const shape = transform.Shape();
    expect(shape.IsNull()).toBe(false);

    const diag = 10 * Math.SQRT2;
    await expectShapeGeometry(shape, {
      size: [diag, diag, 10],
    });
  });

  it('should double all box dimensions with scale', async () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    using trsf = new oc.gp_Trsf();
    trsf.SetScale(new oc.gp_Pnt(), 2);
    using transform = new oc.BRepBuilderAPI_Transform(
      box.Shape(),
      trsf,
      false,
      false,
    );
    const shape = transform.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [20, 20, 20],
      center: [10, 10, 10],
    });
  });
});
