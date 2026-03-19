import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Boolean operations', () => {
  beforeAll(async () => { await initOC(); });

  it('should fuse two overlapping boxes', async () => {
    const oc = getOC();
    const box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox(5, 5, 5);
    const fuse = new oc.BRepAlgoAPI_Fuse(
      box1.Shape(),
      box2.Shape(),
      new oc.Message_ProgressRange(),
    );
    fuse.Build(new oc.Message_ProgressRange());
    const shape = fuse.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 10, 10],
      center: [5, 5, 5],
    });

    box1.delete();
    box2.delete();
    fuse.delete();
  });

  it('should cut second box from first', async () => {
    const oc = getOC();
    const box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox(5, 5, 5);
    const cut = new oc.BRepAlgoAPI_Cut(
      box1.Shape(),
      box2.Shape(),
      new oc.Message_ProgressRange(),
    );
    cut.Build(new oc.Message_ProgressRange());
    const shape = cut.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [10, 10, 10],
    });

    box1.delete();
    box2.delete();
    cut.delete();
  });

  it('should return intersection of two overlapping boxes', async () => {
    const oc = getOC();
    const box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox(5, 5, 5);
    const common = new oc.BRepAlgoAPI_Common(
      box1.Shape(),
      box2.Shape(),
      new oc.Message_ProgressRange(),
    );
    common.Build(new oc.Message_ProgressRange());
    const shape = common.Shape();
    expect(shape.IsNull()).toBe(false);

    await expectShapeGeometry(shape, {
      size: [5, 5, 5],
      center: [2.5, 2.5, 2.5],
    });

    box1.delete();
    box2.delete();
    common.delete();
  });

  it('should produce wider bounding box from fuse of two separated boxes', async () => {
    const oc = getOC();
    const box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox(
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
    });

    fuse.delete();
    box2.delete();
    box1.delete();
  });
});
