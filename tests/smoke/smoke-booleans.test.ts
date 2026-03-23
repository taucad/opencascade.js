import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Boolean operations', () => {
  beforeAll(async () => { await initOC(); });

  it('should fuse two overlapping boxes', async () => {
    const oc = getOC();
    using box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    using box2 = new oc.BRepPrimAPI_MakeBox(5, 5, 5);
    using fuse = new oc.BRepAlgoAPI_Fuse(
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
  });

  it('should cut second box from first', async () => {
    const oc = getOC();
    using box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    using box2 = new oc.BRepPrimAPI_MakeBox(5, 5, 5);
    using cut = new oc.BRepAlgoAPI_Cut(
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
  });

  it('should return intersection of two overlapping boxes', async () => {
    const oc = getOC();
    using box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    using box2 = new oc.BRepPrimAPI_MakeBox(5, 5, 5);
    using common = new oc.BRepAlgoAPI_Common(
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
  });

  it('should produce wider bounding box from fuse of two separated boxes', async () => {
    const oc = getOC();
    using box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    using box2 = new oc.BRepPrimAPI_MakeBox(
      new oc.gp_Pnt(20, 0, 0),
      10, 10, 10,
    );
    using fuse = new oc.BRepAlgoAPI_Fuse(
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
  });

  it('should produce a valid fused solid with fewer faces when using BOPAlgo_GlueFull glue mode', () => {
    const oc = getOC();
    using box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    using origin = new oc.gp_Pnt(10, 0, 0);
    using box2 = new oc.BRepPrimAPI_MakeBox(origin, 10, 10, 10);

    using fuse = new oc.BRepAlgoAPI_Fuse(
      box1.Shape(),
      box2.Shape(),
      new oc.Message_ProgressRange(),
    );
    fuse.SetGlue(oc.BOPAlgo_GlueEnum.BOPAlgo_GlueFull);
    fuse.Build(new oc.Message_ProgressRange());

    expect(fuse.Shape().IsNull()).toBe(false);

    using explorer = new oc.TopExp_Explorer(
      fuse.Shape(),
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    let faceCount = 0;
    while (explorer.More()) { faceCount++; explorer.Next(); }

    expect(faceCount).toBeGreaterThanOrEqual(6);
    expect(faceCount).toBeLessThanOrEqual(12);
  });
});
