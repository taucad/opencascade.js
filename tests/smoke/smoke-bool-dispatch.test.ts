/**
 * Smoke tests: Boolean vs number dispatch at the same arity.
 *
 * Validates that constructors where one overload takes a boolean and another
 * takes a number at the same argument position are dispatched correctly.
 * The bugra9 JS dispatch uses typeof, which distinguishes 'boolean' from
 * 'number' — so this pattern should work after migration.
 *
 * BRepPrimAPI_MakeRevol:
 *   constructor(S: TopoDS_Shape, A: gp_Ax1, Copy: boolean)  — full revolution
 *   constructor(S: TopoDS_Shape, A: gp_Ax1, D: number)       — partial revolution
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: boolean vs number dispatch', () => {
  beforeAll(async () => { await initOC(); });

  describe('BRepPrimAPI_MakeRevol — 3-arg bool vs number dispatch', () => {
    it('should dispatch (Shape, Ax1, boolean) — full revolution with copy flag', () => {
      const oc = getOC();
      using profile = new oc.BRepBuilderAPI_MakeEdge(
        new oc.gp_Pnt(5, 0, 0),
        new oc.gp_Pnt(5, 0, 10),
      );
      using ax1 = new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1));

      using revol = new oc.BRepPrimAPI_MakeRevol(profile.Edge(), ax1, true);
      const shape = revol.Shape();
      expect(shape.IsNull()).toBe(false);
    });

    it('should dispatch (Shape, Ax1, number) — partial revolution by angle', () => {
      const oc = getOC();
      using profile = new oc.BRepBuilderAPI_MakeEdge(
        new oc.gp_Pnt(5, 0, 0),
        new oc.gp_Pnt(5, 0, 10),
      );
      using ax1 = new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1));

      const halfPi = Math.PI / 2;
      using revol = new oc.BRepPrimAPI_MakeRevol(profile.Edge(), ax1, halfPi);
      const shape = revol.Shape();
      expect(shape.IsNull()).toBe(false);
    });

    it('should produce valid shapes for both bool and number dispatch paths', () => {
      const oc = getOC();
      using profile = new oc.BRepBuilderAPI_MakeEdge(
        new oc.gp_Pnt(5, 0, 0),
        new oc.gp_Pnt(5, 0, 10),
      );
      using ax1 = new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1));

      using revolFull = new oc.BRepPrimAPI_MakeRevol(profile.Edge(), ax1, true);
      using revolPartial = new oc.BRepPrimAPI_MakeRevol(profile.Edge(), ax1, Math.PI / 2);

      using explorerFull = new oc.TopExp_Explorer(
        revolFull.Shape(),
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      using explorerPartial = new oc.TopExp_Explorer(
        revolPartial.Shape(),
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );

      let fullFaces = 0;
      while (explorerFull.More()) { fullFaces++; explorerFull.Next(); }
      let partialFaces = 0;
      while (explorerPartial.More()) { partialFaces++; explorerPartial.Next(); }

      expect(fullFaces).toBeGreaterThan(0);
      expect(partialFaces).toBeGreaterThan(0);
      expect(revolFull.Shape().IsNull()).toBe(false);
      expect(revolPartial.Shape().IsNull()).toBe(false);
    });
  });

  describe('BRepGProp_Face — 1-arg bool vs object dispatch', () => {
    it('should dispatch (boolean) — flag constructor', () => {
      const oc = getOC();
      using face = new oc.BRepGProp_Face(true);
      const bounds = face.Bounds();
      expect(bounds).toEqual(expect.objectContaining({
        U1: expect.any(Number),
        U2: expect.any(Number),
        V1: expect.any(Number),
        V2: expect.any(Number),
      }));
    });

    it('should dispatch (TopoDS_Face) — face constructor', () => {
      const oc = getOC();
      using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
      using explorer = new oc.TopExp_Explorer(
        box.Shape(),
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      expect(explorer.More()).toBe(true);
      const topoFace = oc.TopoDS.Face(explorer.Current());
      using gpropFace = new oc.BRepGProp_Face(topoFace);
      const bounds = gpropFace.Bounds();
      expect(bounds.U2).toBeGreaterThanOrEqual(bounds.U1);
      expect(bounds.V2).toBeGreaterThanOrEqual(bounds.V1);
    });
  });
});
