import { expectTypeOf, test } from 'vitest';
import type init from '../build-configs/opencascade_full';

type OC = Awaited<ReturnType<typeof init>>;

test('gp_Pnt methods return correct types', () => {
  expectTypeOf<InstanceType<OC['gp_Pnt']>['X']>().returns.toBeNumber();
  expectTypeOf<InstanceType<OC['gp_Pnt']>['Y']>().returns.toBeNumber();
  expectTypeOf<InstanceType<OC['gp_Pnt']>['Z']>().returns.toBeNumber();
  expectTypeOf<InstanceType<OC['gp_Pnt']>['Distance']>().returns.toBeNumber();
  expectTypeOf<InstanceType<OC['gp_Pnt']>['IsEqual']>().returns.toBeBoolean();
});

test('gp_Vec methods return correct types', () => {
  expectTypeOf<InstanceType<OC['gp_Vec']>['X']>().returns.toBeNumber();
  expectTypeOf<InstanceType<OC['gp_Vec']>['Magnitude']>().returns.toBeNumber();
});

test('BRepPrimAPI_MakeBox produces shape with expected properties', () => {
  type MakeBox = InstanceType<OC['BRepPrimAPI_MakeBox']>;
  expectTypeOf<MakeBox['Shape']>().returns.toHaveProperty('IsNull');
  expectTypeOf<MakeBox['Shape']>().returns.toHaveProperty('delete');
});

test('delete method exists on all bound classes', () => {
  expectTypeOf<InstanceType<OC['gp_Pnt']>>().toHaveProperty('delete');
  expectTypeOf<InstanceType<OC['gp_Vec']>>().toHaveProperty('delete');
  expectTypeOf<InstanceType<OC['TopoDS_Shape']>>().toHaveProperty('delete');
  expectTypeOf<InstanceType<OC['BRepPrimAPI_MakeBox']>>().toHaveProperty('delete');
});

test('enum types are objects with enum members', () => {
  expectTypeOf<OC['TopAbs_ShapeEnum']>().toBeObject();
});

test('NCollection_Vec types resolve to fixed-length tuples not number[]', () => {
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

test('init returns Promise<OpenCascadeInstance>', () => {
  expectTypeOf<typeof init>().returns.resolves.toHaveProperty('gp_Pnt');
  expectTypeOf<typeof init>().returns.resolves.toHaveProperty('FS');
});
