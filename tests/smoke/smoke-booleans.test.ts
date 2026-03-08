import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Boolean operations', () => {
  it('BRepAlgoAPI_Fuse fuses two overlapping boxes', async () => {
    const oc = await getOC();
    const box1 = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox_2(5, 5, 5);
    const fuse = new oc.BRepAlgoAPI_Fuse(
      box1.Shape(),
      box2.Shape(),
      new oc.Message_ProgressRange(),
    );
    fuse.Build(new oc.Message_ProgressRange());
    const shape = fuse.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 10, 10],
      center: [5, 5, 5],
      tolerance: 1,
    });

    box1.delete();
    box2.delete();
    fuse.delete();
  });

  it('BRepAlgoAPI_Cut cuts second box from first', async () => {
    const oc = await getOC();
    const box1 = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox_2(5, 5, 5);
    const cut = new oc.BRepAlgoAPI_Cut(
      box1.Shape(),
      box2.Shape(),
      new oc.Message_ProgressRange(),
    );
    cut.Build(new oc.Message_ProgressRange());
    const shape = cut.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 10, 10],
      tolerance: 1,
    });

    box1.delete();
    box2.delete();
    cut.delete();
  });

  it('BRepAlgoAPI_Common returns intersection of two overlapping boxes', async () => {
    const oc = await getOC();
    const box1 = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox_2(5, 5, 5);
    const common = new oc.BRepAlgoAPI_Common(
      box1.Shape(),
      box2.Shape(),
      new oc.Message_ProgressRange(),
    );
    common.Build(new oc.Message_ProgressRange());
    const shape = common.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [5, 5, 5],
      center: [2.5, 2.5, 2.5],
      tolerance: 1,
    });

    box1.delete();
    box2.delete();
    common.delete();
  });

  it('BRepAlgoAPI_Fuse of two separated boxes produces wider bounding box', async () => {
    const oc = await getOC();
    const box1 = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox_3(
      new oc.gp_Pnt(20, 0, 0),
      10, 10, 10,
    );
    const fuse = new oc.BRepAlgoAPI_Fuse(
      box1.Shape(),
      box2.Shape(),
      new oc.Message_ProgressRange(),
    );
    fuse.Build(new oc.Message_ProgressRange());
    const shape = fuse.Shape();

    await expectShapeGeometry(shape, {
      size: [30, 10, 10],
      center: [15, 5, 5],
      tolerance: 1,
    });

    fuse.delete();
    box2.delete();
    box1.delete();
  });
});
