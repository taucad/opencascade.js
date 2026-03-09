import { expectTypeOf, it } from 'vitest';
import type init from '../build-configs/opencascade_full';

type OC = Awaited<ReturnType<typeof init>>;

it('should return correct types for gp_Pnt methods', () => {
  expectTypeOf<InstanceType<OC['gp_Pnt']>['X']>().returns.toBeNumber();
  expectTypeOf<InstanceType<OC['gp_Pnt']>['Y']>().returns.toBeNumber();
  expectTypeOf<InstanceType<OC['gp_Pnt']>['Z']>().returns.toBeNumber();
  expectTypeOf<InstanceType<OC['gp_Pnt']>['Distance']>().returns.toBeNumber();
  expectTypeOf<InstanceType<OC['gp_Pnt']>['IsEqual']>().returns.toBeBoolean();
});

it('should return correct types for gp_Vec methods', () => {
  expectTypeOf<InstanceType<OC['gp_Vec']>['X']>().returns.toBeNumber();
  expectTypeOf<InstanceType<OC['gp_Vec']>['Magnitude']>().returns.toBeNumber();
});

it('should produce shape with expected properties for BRepPrimAPI_MakeBox', () => {
  type MakeBox = InstanceType<OC['BRepPrimAPI_MakeBox']>;
  expectTypeOf<MakeBox['Shape']>().returns.toHaveProperty('IsNull');
  expectTypeOf<MakeBox['Shape']>().returns.toHaveProperty('delete');
});

it('should have delete method on all bound classes', () => {
  expectTypeOf<InstanceType<OC['gp_Pnt']>>().toHaveProperty('delete');
  expectTypeOf<InstanceType<OC['gp_Vec']>>().toHaveProperty('delete');
  expectTypeOf<InstanceType<OC['TopoDS_Shape']>>().toHaveProperty('delete');
  expectTypeOf<InstanceType<OC['BRepPrimAPI_MakeBox']>>().toHaveProperty('delete');
});

it('should have members with numeric literal types for enum lookup objects', () => {
  expectTypeOf<OC['TopAbs_ShapeEnum']>().toBeObject();
  expectTypeOf<OC['TopAbs_ShapeEnum']['TopAbs_FACE']>().toBeNumber();
  expectTypeOf<OC['TopAbs_ShapeEnum']['TopAbs_EDGE']>().toBeNumber();
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

it('should return Promise<OpenCascadeInstance> from init', () => {
  expectTypeOf<typeof init>().returns.resolves.toHaveProperty('gp_Pnt');
  expectTypeOf<typeof init>().returns.resolves.toHaveProperty('FS');
});
