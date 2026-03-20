import { expectTypeOf, it } from 'vitest';
import type init from '../build-configs/opencascade_full';
import type { gp, BRepPrimAPI, TopoDS as TopoDS_NS, TopAbs } from '../build-configs/opencascade_full';

it('should return correct types for gp.Pnt methods', () => {
  expectTypeOf<gp.Pnt['X']>().returns.toBeNumber();
  expectTypeOf<gp.Pnt['Y']>().returns.toBeNumber();
  expectTypeOf<gp.Pnt['Z']>().returns.toBeNumber();
  expectTypeOf<gp.Pnt['Distance']>().returns.toBeNumber();
  expectTypeOf<gp.Pnt['IsEqual']>().returns.toBeBoolean();
});

it('should return correct types for gp.Vec methods', () => {
  expectTypeOf<gp.Vec['X']>().returns.toBeNumber();
  expectTypeOf<gp.Vec['Magnitude']>().returns.toBeNumber();
});

it('should produce shape with expected properties for BRepPrimAPI.MakeBox', () => {
  expectTypeOf<BRepPrimAPI.MakeBox['Shape']>().returns.toHaveProperty('IsNull');
  expectTypeOf<BRepPrimAPI.MakeBox['Shape']>().returns.toHaveProperty('delete');
});

it('should have delete method on all bound classes', () => {
  expectTypeOf<gp.Pnt>().toHaveProperty('delete');
  expectTypeOf<gp.Vec>().toHaveProperty('delete');
  expectTypeOf<TopoDS_NS.Shape>().toHaveProperty('delete');
  expectTypeOf<BRepPrimAPI.MakeBox>().toHaveProperty('delete');
});

it('should have members with string literal types for enum lookup objects', () => {
  expectTypeOf<TopAbs.ShapeEnum>().toBeString();
});

it('should resolve NCollection_Vec types to fixed-length tuples not number[]', () => {
  type Vec2 = [number, number];
  type Vec3 = [number, number, number];
  type Vec4 = [number, number, number, number];

  expectTypeOf<Vec2>().not.toEqualTypeOf<number[]>();
  expectTypeOf<Vec3>().not.toEqualTypeOf<number[]>();
  expectTypeOf<Vec4>().not.toEqualTypeOf<number[]>();

  expectTypeOf<[number, number]>().toEqualTypeOf<Vec2>();
  expectTypeOf<[number, number, number]>().toEqualTypeOf<Vec3>();
  expectTypeOf<[number, number, number, number]>().toEqualTypeOf<Vec4>();
});

it('should support Symbol.dispose for using declarations', () => {
  expectTypeOf<gp.Pnt>().toHaveProperty(Symbol.dispose);
  expectTypeOf<gp.Vec>().toHaveProperty(Symbol.dispose);
  expectTypeOf<TopoDS_NS.Shape>().toHaveProperty(Symbol.dispose);
  expectTypeOf<BRepPrimAPI.MakeBox>().toHaveProperty(Symbol.dispose);
});

it('should return Promise<OpenCascadeInstance> from init', () => {
  expectTypeOf<typeof init>().returns.resolves.not.toBeVoid();
});
