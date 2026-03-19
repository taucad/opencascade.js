/**
 * Smoke tests: Enum bindings as const object pattern.
 *
 * Validates that OCCT enums are exposed as plain numeric values via embind's
 * enum_value_type::number mode, producing idiomatic JavaScript objects where
 * each member is a plain integer. This ensures:
 * - Zero WASM boundary overhead (identity fromWireType/toWireType)
 * - JSON-serializable values
 * - Correct strict equality semantics
 * - API compatibility with TopExp_Explorer and other enum-consuming functions
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Enum Bindings', () => {
  beforeAll(async () => { await initOC(); });

  it('should represent enum values as plain numbers', () => {
    const oc = getOC();
    expect(typeof oc.TopAbs_ShapeEnum.TopAbs_FACE).toBe('number');
    expect(typeof oc.TopAbs_ShapeEnum.TopAbs_EDGE).toBe('number');
    expect(typeof oc.TopAbs_Orientation.TopAbs_FORWARD).toBe('number');
  });

  it('should have correct numeric values for enum members', () => {
    const oc = getOC();
    expect(oc.TopAbs_ShapeEnum.TopAbs_COMPOUND).toBe(0);
    expect(oc.TopAbs_ShapeEnum.TopAbs_COMPSOLID).toBe(1);
    expect(oc.TopAbs_ShapeEnum.TopAbs_SOLID).toBe(2);
    expect(oc.TopAbs_ShapeEnum.TopAbs_SHELL).toBe(3);
    expect(oc.TopAbs_ShapeEnum.TopAbs_FACE).toBe(4);
    expect(oc.TopAbs_ShapeEnum.TopAbs_WIRE).toBe(5);
    expect(oc.TopAbs_ShapeEnum.TopAbs_EDGE).toBe(6);
    expect(oc.TopAbs_ShapeEnum.TopAbs_VERTEX).toBe(7);
    expect(oc.TopAbs_ShapeEnum.TopAbs_SHAPE).toBe(8);
  });

  it('should not have .value property on enum values', () => {
    const oc = getOC();
    const face = oc.TopAbs_ShapeEnum.TopAbs_FACE;
    expect(face).not.toHaveProperty('value');
  });

  it('should serialize enum values to JSON', () => {
    const oc = getOC();
    const face = oc.TopAbs_ShapeEnum.TopAbs_FACE;
    const json = JSON.stringify({ shapeType: face });
    expect(json).toBe('{"shapeType":4}');
    expect(JSON.parse(json).shapeType).toBe(4);
  });

  it('should support strict equality for enum values', () => {
    const oc = getOC();
    const face1 = oc.TopAbs_ShapeEnum.TopAbs_FACE;
    const face2 = oc.TopAbs_ShapeEnum.TopAbs_FACE;
    expect(face1 === face2).toBe(true);
    expect(face1).not.toBe(oc.TopAbs_ShapeEnum.TopAbs_EDGE);
  });

  it('should return all enum member names via Object.keys()', () => {
    const oc = getOC();
    const keys = Object.keys(oc.TopAbs_ShapeEnum);
    expect(keys).toContain('TopAbs_COMPOUND');
    expect(keys).toContain('TopAbs_FACE');
    expect(keys).toContain('TopAbs_EDGE');
    expect(keys).toContain('TopAbs_SHAPE');
    expect(keys.length).toBe(9);
  });

  it('should accept enum values in API functions', () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox(10, 10, 10).Shape();
    const explorer = new oc.TopExp_Explorer(
      box,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );

    let faceCount = 0;
    while (explorer.More()) {
      faceCount++;
      explorer.Next();
    }
    expect(faceCount).toBe(6);

    explorer.delete();
    box.delete();
  });

  it('should have correct values for TopAbs_Orientation enum', () => {
    const oc = getOC();
    expect(typeof oc.TopAbs_Orientation.TopAbs_FORWARD).toBe('number');
    expect(oc.TopAbs_Orientation.TopAbs_FORWARD).toBe(0);
    expect(oc.TopAbs_Orientation.TopAbs_REVERSED).toBe(1);
    expect(oc.TopAbs_Orientation.TopAbs_INTERNAL).toBe(2);
    expect(oc.TopAbs_Orientation.TopAbs_EXTERNAL).toBe(3);
  });

  it('should have correct values for ChFi3d_FilletShape enum', () => {
    const oc = getOC();
    expect(typeof oc.ChFi3d_FilletShape.ChFi3d_Rational).toBe('number');
    expect(oc.ChFi3d_FilletShape.ChFi3d_Rational).toBe(0);
  });

  it('should have independent value spaces for different enum types', () => {
    const oc = getOC();
    expect(oc.TopAbs_ShapeEnum.TopAbs_COMPOUND).toBe(0);
    expect(oc.TopAbs_Orientation.TopAbs_FORWARD).toBe(0);
    expect(oc.TopAbs_ShapeEnum.TopAbs_COMPOUND).toBe(oc.TopAbs_Orientation.TopAbs_FORWARD);
  });
});
