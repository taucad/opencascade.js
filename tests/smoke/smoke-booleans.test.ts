import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Boolean operations', () => {
  it('BRepAlgoAPI_Fuse fuses two overlapping boxes', async () => {
    const oc = await getOC();
    const box1 = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox_2(5, 5, 5);
    const fuse = new oc.BRepAlgoAPI_Fuse_3(
      box1.Shape(),
      box2.Shape(),
      new oc.Message_ProgressRange_1(),
    );
    fuse.Build(new oc.Message_ProgressRange_1());
    const shape = fuse.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    box1.delete();
    box2.delete();
    fuse.delete();
  });

  it('BRepAlgoAPI_Cut cuts second box from first', async () => {
    const oc = await getOC();
    const box1 = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox_2(5, 5, 5);
    const cut = new oc.BRepAlgoAPI_Cut_3(
      box1.Shape(),
      box2.Shape(),
      new oc.Message_ProgressRange_1(),
    );
    cut.Build(new oc.Message_ProgressRange_1());
    const shape = cut.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    box1.delete();
    box2.delete();
    cut.delete();
  });

  it('BRepAlgoAPI_Common returns intersection of two overlapping boxes', async () => {
    const oc = await getOC();
    const box1 = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox_2(5, 5, 5);
    const common = new oc.BRepAlgoAPI_Common_3(
      box1.Shape(),
      box2.Shape(),
      new oc.Message_ProgressRange_1(),
    );
    common.Build(new oc.Message_ProgressRange_1());
    const shape = common.Shape();
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    box1.delete();
    box2.delete();
    common.delete();
  });
});
