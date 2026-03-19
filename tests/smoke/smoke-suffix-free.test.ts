import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: suffix-free constructors and methods', () => {
  beforeAll(async () => { await initOC(); });

  describe('BRepPrimAPI_MakeBox — suffix-free constructors', () => {
    it('should construct with (dx, dy, dz)', async () => {
      const oc = getOC();
      const box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
      const shape = box.Shape();
      expect(shape.IsNull()).toBe(false);
      await expectShapeGeometry(shape, { size: [10, 20, 30], center: [5, 10, 15] });
      box.delete();
    });

    it('should construct with (gp_Pnt, dx, dy, dz)', async () => {
      const oc = getOC();
      const origin = new oc.gp_Pnt(1, 2, 3);
      const box = new oc.BRepPrimAPI_MakeBox(origin, 10, 20, 30);
      const shape = box.Shape();
      expect(shape.IsNull()).toBe(false);
      await expectShapeGeometry(shape, { size: [10, 20, 30], center: [6, 12, 18] });
      box.delete();
      origin.delete();
    });

    it('should construct with (gp_Pnt, gp_Pnt)', async () => {
      const oc = getOC();
      const p1 = new oc.gp_Pnt(0, 0, 0);
      const p2 = new oc.gp_Pnt(5, 10, 15);
      const box = new oc.BRepPrimAPI_MakeBox(p1, p2);
      const shape = box.Shape();
      expect(shape.IsNull()).toBe(false);
      await expectShapeGeometry(shape, { size: [5, 10, 15], center: [2.5, 5, 7.5] });
      box.delete();
      p1.delete();
      p2.delete();
    });

    it('should construct with (gp_Ax2, dx, dy, dz)', async () => {
      const oc = getOC();
      const ax2 = new oc.gp_Ax2();
      const box = new oc.BRepPrimAPI_MakeBox(ax2, 10, 20, 30);
      const shape = box.Shape();
      expect(shape.IsNull()).toBe(false);
      await expectShapeGeometry(shape, { size: [10, 20, 30] });
      box.delete();
      ax2.delete();
    });
  });

  describe('BRepBuilderAPI_MakeEdge — suffix-free constructors', () => {
    it('should construct with (gp_Lin)', () => {
      const oc = getOC();
      const origin = new oc.gp_Pnt(0, 0, 0);
      const dir = new oc.gp_Dir(1, 0, 0);
      const lin = new oc.gp_Lin(origin, dir);
      const edge = new oc.BRepBuilderAPI_MakeEdge(lin, 0, 10);
      expect(edge.IsDone()).toBe(true);
      edge.delete();
      lin.delete();
      dir.delete();
      origin.delete();
    });

    it('should construct with (gp_Circ)', () => {
      const oc = getOC();
      const ax2 = new oc.gp_Ax2();
      const circ = new oc.gp_Circ(ax2, 5);
      const edge = new oc.BRepBuilderAPI_MakeEdge(circ);
      expect(edge.IsDone()).toBe(true);
      edge.delete();
      circ.delete();
      ax2.delete();
    });

    it('should construct with (gp_Pnt, gp_Pnt)', () => {
      const oc = getOC();
      const p1 = new oc.gp_Pnt(0, 0, 0);
      const p2 = new oc.gp_Pnt(10, 0, 0);
      const edge = new oc.BRepBuilderAPI_MakeEdge(p1, p2);
      expect(edge.IsDone()).toBe(true);
      edge.delete();
      p1.delete();
      p2.delete();
    });
  });

  describe('gp_Vec — suffix-free constructors', () => {
    it('should construct with ()', () => {
      const oc = getOC();
      const vec = new oc.gp_Vec();
      expect(vec.Magnitude()).toBe(0);
      vec.delete();
    });

    it('should construct with (gp_Dir)', () => {
      const oc = getOC();
      const dir = new oc.gp_Dir(0, 0, 1);
      const vec = new oc.gp_Vec(dir);
      expect(vec.Z()).toBe(1);
      expect(vec.Magnitude()).toBeCloseTo(1);
      vec.delete();
      dir.delete();
    });

    it('should construct with (gp_XYZ)', () => {
      const oc = getOC();
      const xyz = new oc.gp_XYZ(3, 4, 0);
      const vec = new oc.gp_Vec(xyz);
      expect(vec.Magnitude()).toBe(5);
      vec.delete();
      xyz.delete();
    });

    it('should construct with (number, number, number)', () => {
      const oc = getOC();
      const vec = new oc.gp_Vec(1, 2, 3);
      expect(vec.X()).toBe(1);
      expect(vec.Y()).toBe(2);
      expect(vec.Z()).toBe(3);
      vec.delete();
    });

    it('should construct with (gp_Pnt, gp_Pnt)', () => {
      const oc = getOC();
      const p1 = new oc.gp_Pnt(0, 0, 0);
      const p2 = new oc.gp_Pnt(3, 4, 0);
      const vec = new oc.gp_Vec(p1, p2);
      expect(vec.Magnitude()).toBe(5);
      vec.delete();
      p1.delete();
      p2.delete();
    });
  });

  describe('gp_Dir — suffix-free constructors', () => {
    it('should construct with (gp_Vec)', () => {
      const oc = getOC();
      const vec = new oc.gp_Vec(0, 0, 5);
      const dir = new oc.gp_Dir(vec);
      expect(dir.Z()).toBeCloseTo(1);
      dir.delete();
      vec.delete();
    });

    it('should construct with (gp_XYZ)', () => {
      const oc = getOC();
      const xyz = new oc.gp_XYZ(0, 1, 0);
      const dir = new oc.gp_Dir(xyz);
      expect(dir.Y()).toBeCloseTo(1);
      dir.delete();
      xyz.delete();
    });

    it('should construct with (number, number, number)', () => {
      const oc = getOC();
      const dir = new oc.gp_Dir(0, 0, 1);
      expect(dir.Z()).toBeCloseTo(1);
      dir.delete();
    });
  });

  describe('gp_Ax1 — suffix-free constructors', () => {
    it('should construct with ()', () => {
      const oc = getOC();
      const ax = new oc.gp_Ax1();
      expect(ax.Direction().Z()).toBeCloseTo(1);
      ax.delete();
    });

    it('should construct with (gp_Pnt, gp_Dir)', () => {
      const oc = getOC();
      const pnt = new oc.gp_Pnt(1, 2, 3);
      const dir = new oc.gp_Dir(0, 1, 0);
      const ax = new oc.gp_Ax1(pnt, dir);
      expect(ax.Location().Y()).toBe(2);
      expect(ax.Direction().Y()).toBeCloseTo(1);
      ax.delete();
      dir.delete();
      pnt.delete();
    });
  });
});
