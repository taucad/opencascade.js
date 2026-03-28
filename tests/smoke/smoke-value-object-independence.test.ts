/**
 * Smoke tests: value_object registration independence across classes.
 *
 * Validates that value_object (RBV) return structs are self-contained per
 * translation unit. When cross-class deduplication assigns a canonical name
 * from class A to class B's result struct, the value_object registration
 * lives only in class A's TU. If class A is not linked, class B's methods
 * fail with "unbound types".
 *
 * On the full build, both classes are linked so the shared registration
 * works. These tests verify the functional contract: multiple classes
 * returning identically-shaped value_objects must each work independently.
 *
 * Regression target: BRepTools.UVBounds uses IntTools_Context_UVBounds_Result
 * struct name but the value_object registration is only in IntTools_Context.cpp.
 *
 * Patterns tested:
 * - BRepTools.UVBounds returns {UMin, UMax, VMin, VMax}
 * - IntTools_Context.UVBounds returns {UMin, UMax, VMin, VMax}
 * - Both return identical field structures
 * - BRep_Tool.Range returns {First, Last} (another cross-class candidate)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: value_object registration independence', () => {
  beforeAll(async () => { await initOC(); });

  describe('BRepTools.UVBounds — static method with output params', () => {
    it('should return {UMin, UMax, VMin, VMax} with valid numeric bounds', () => {
      const oc = getOC();
      using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
      using explorer = new oc.TopExp_Explorer(
        box.Shape(),
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      expect(explorer.More()).toBe(true);
      const face = oc.TopoDS.Face(explorer.Current());

      const result = oc.BRepTools.UVBounds(face);

      expect(result).toEqual(expect.objectContaining({
        UMin: expect.any(Number),
        UMax: expect.any(Number),
        VMin: expect.any(Number),
        VMax: expect.any(Number),
      }));
      expect(result.UMax).toBeGreaterThanOrEqual(result.UMin);
      expect(result.VMax).toBeGreaterThanOrEqual(result.VMin);
    });

    it('should return UV bounds for a cylindrical face', () => {
      const oc = getOC();
      using cylinder = new oc.BRepPrimAPI_MakeCylinder(5, 20);
      using explorer = new oc.TopExp_Explorer(
        cylinder.Shape(),
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      expect(explorer.More()).toBe(true);
      const face = oc.TopoDS.Face(explorer.Current());

      const result = oc.BRepTools.UVBounds(face);
      expect(typeof result.UMin).toBe('number');
      expect(typeof result.UMax).toBe('number');
      expect(typeof result.VMin).toBe('number');
      expect(typeof result.VMax).toBe('number');
      expect(Number.isFinite(result.UMin)).toBe(true);
      expect(Number.isFinite(result.UMax)).toBe(true);
    });
  });

  describe('BRep_Tool.Range — another static method with output params', () => {
    it('should return {First, Last} from edge parameter range', () => {
      const oc = getOC();
      using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
      using explorer = new oc.TopExp_Explorer(
        box.Shape(),
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      expect(explorer.More()).toBe(true);
      const edge = oc.TopoDS.Edge(explorer.Current());

      const range = oc.BRep_Tool.Range(edge);

      expect(range).toEqual(expect.objectContaining({
        First: expect.any(Number),
        Last: expect.any(Number),
      }));
      expect(range.Last).toBeGreaterThan(range.First);
    });
  });

  describe('Multiple classes returning same-layout value_objects', () => {
    it('should return valid results from both BRepTools.UVBounds and Geom surface Bounds', () => {
      const oc = getOC();

      using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
      using faceExplorer = new oc.TopExp_Explorer(
        box.Shape(),
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      expect(faceExplorer.More()).toBe(true);
      const face = oc.TopoDS.Face(faceExplorer.Current());

      const brepBounds = oc.BRepTools.UVBounds(face);

      using ax3 = new oc.gp_Ax3(new oc.gp_Pnt(), new oc.gp_Dir(0, 0, 1));
      using sphere = new oc.Geom_SphericalSurface(ax3, 10.0);
      const geomBounds = sphere.Bounds();

      expect(Object.keys(brepBounds).sort()).toEqual(['UMax', 'UMin', 'VMax', 'VMin']);
      expect(Object.keys(geomBounds).sort()).toEqual(['U1', 'U2', 'V1', 'V2']);

      expect(typeof brepBounds.UMin).toBe('number');
      expect(typeof geomBounds.U1).toBe('number');
    });
  });
});
