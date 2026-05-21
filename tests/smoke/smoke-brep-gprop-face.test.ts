/**
 * Smoke tests: BRepGProp_Face.
 *
 * Validates face-specific property computation -- normals and UV bounds.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: BRepGProp_Face', () => {
  beforeAll(async () => {
    await initOC();
  });

  it('should compute the outward normal of a box top face pointing in Z direction', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);

    using shape = box.Shape();
    using explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

    // eslint-disable-next-line ocjs-lint/require-using-on-disposable -- topFace ownership is transferred across loop iterations; explicit `.delete()` + reassignment manages disposal manually.
    let topFace = explorer.Current();
    let maxZ = -Infinity;

    while (explorer.More()) {
      using currentShape = explorer.Current();
      using face = oc.TopoDS.Face(currentShape);
      using adaptor = new oc.BRepAdaptor_Surface(face);
      const uMid = (adaptor.FirstUParameter() + adaptor.LastUParameter()) / 2;
      const vMid = (adaptor.FirstVParameter() + adaptor.LastVParameter()) / 2;
      using pnt = adaptor.Value(uMid, vMid);
      if (pnt.Z() > maxZ) {
        maxZ = pnt.Z();
        topFace.delete();
        // eslint-disable-next-line ocjs-lint/require-using-on-disposable -- see prior comment: ownership is transferred across loop iterations.
        topFace = explorer.Current();
      }
      explorer.Next();
    }

    using disposeTopFace = topFace;
    using face = oc.TopoDS.Face(disposeTopFace);
    using gpropFace = new oc.BRepGProp_Face(face);

    const bounds = gpropFace.Bounds(0, 0, 0, 0);
    const uMid = (bounds.U1 + bounds.U2) / 2;
    const vMid = (bounds.V1 + bounds.V2) / 2;

    using inPoint = new oc.gp_Pnt(0, 0, 0);
    using inNormal = new oc.gp_Vec(0, 0, 0);
    gpropFace.Normal(uMid, vMid, inPoint, inNormal);

    const nz = inNormal.Z() / Math.sqrt(inNormal.X() ** 2 + inNormal.Y() ** 2 + inNormal.Z() ** 2);
    expect(Math.abs(nz)).toBeCloseTo(1, 3);
  });

  it('should report finite UV bounds for a planar face', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);

    using shape = box.Shape();
    using explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    expect(explorer.More()).toBe(true);

    using currentShape = explorer.Current();
    using face = oc.TopoDS.Face(currentShape);
    using gpropFace = new oc.BRepGProp_Face(face);

    const bounds = gpropFace.Bounds(0, 0, 0, 0);
    expect(Number.isFinite(bounds.U1)).toBe(true);
    expect(Number.isFinite(bounds.U2)).toBe(true);
    expect(Number.isFinite(bounds.V1)).toBe(true);
    expect(Number.isFinite(bounds.V2)).toBe(true);
    expect(bounds.U2).toBeGreaterThan(bounds.U1);
    expect(bounds.V2).toBeGreaterThan(bounds.V1);
  });
});
