/**
 * Smoke tests: Output parameter stripping from public API.
 *
 * Validates that primitive output parameters (double&, int&) used purely as
 * return channels in optional_override bindings are stripped from the caller-
 * facing signature. The C++ lambda takes these by value, so the JS-side value
 * is never read — it's pure ceremony. The result struct already returns the
 * computed values.
 *
 * These tests document the DESIRED API shape. They are expected to fail until
 * bindings.py's shouldStripParam is updated to strip primitive output params
 * unconditionally (not just for const methods).
 *
 * Patterns tested:
 * - BRepTools.UVBounds(face) — 4 primitive output params stripped
 * - BRep_Tool.Range(edge) — 2 primitive output params stripped
 * - BRep_Tool.Curve(edge, loc) — 2 primitive output params stripped
 * - BRep_Tool.Curve(edge) — 2 primitive output params stripped
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: output parameter stripping', () => {
  beforeAll(async () => { await initOC(); });

  describe('BRepTools.UVBounds — should not require output param placeholders', () => {
    it('should return {UMin, UMax, VMin, VMax} from face without extra args', () => {
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

    it('should return {UMin, UMax, VMin, VMax} from face+wire without extra args', () => {
      const oc = getOC();
      using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
      using faceExplorer = new oc.TopExp_Explorer(
        box.Shape(),
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      expect(faceExplorer.More()).toBe(true);
      const face = oc.TopoDS.Face(faceExplorer.Current());

      using wireExplorer = new oc.TopExp_Explorer(
        face,
        oc.TopAbs_ShapeEnum.TopAbs_WIRE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      expect(wireExplorer.More()).toBe(true);
      const wire = oc.TopoDS.Wire(wireExplorer.Current());

      const result = oc.BRepTools.UVBounds(face, wire);

      expect(result).toEqual(expect.objectContaining({
        UMin: expect.any(Number),
        UMax: expect.any(Number),
        VMin: expect.any(Number),
        VMax: expect.any(Number),
      }));
    });
  });

  describe('BRep_Tool.Range — should not require output param placeholders', () => {
    it('should return {First, Last} from edge without extra args', () => {
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

  describe('BRep_Tool.Curve — should not require output param placeholders', () => {
    it('should return {result, First, Last} from (edge, location) without extra args', () => {
      const oc = getOC();
      using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
      using explorer = new oc.TopExp_Explorer(
        box.Shape(),
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      expect(explorer.More()).toBe(true);
      const edge = oc.TopoDS.Edge(explorer.Current());

      using loc = new oc.TopLoc_Location();
      const curveResult = oc.BRep_Tool.Curve(edge, loc);

      expect(curveResult).toEqual(expect.objectContaining({
        First: expect.any(Number),
        Last: expect.any(Number),
      }));
      expect(curveResult.Last).toBeGreaterThan(curveResult.First);
    });

    it('should return {result, First, Last} from (edge) without extra args', () => {
      const oc = getOC();
      using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
      using explorer = new oc.TopExp_Explorer(
        box.Shape(),
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      );
      expect(explorer.More()).toBe(true);
      const edge = oc.TopoDS.Edge(explorer.Current());

      const curveResult = oc.BRep_Tool.Curve(edge);

      expect(curveResult).toEqual(expect.objectContaining({
        First: expect.any(Number),
        Last: expect.any(Number),
      }));
      expect(curveResult.Last).toBeGreaterThan(curveResult.First);
    });
  });
});
