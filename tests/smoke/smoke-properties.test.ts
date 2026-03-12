/**
 * Smoke tests: Geometric properties and bounding boxes.
 *
 * Demonstrates:
 * - Computing volume, surface area, and center of mass with BRepGProp
 * - Computing bounding boxes with Bnd_Box and BRepBndLib
 * - Validating dimensions via GProp_GProps
 * - GLB export with geometry dimension validation
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Geometric properties', () => {
  beforeAll(async () => { await initOC(); });

  it('should compute volume of a 10x20x30 box with BRepGProp', () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();

    const props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);

    const volume = props.Mass();
    expect(volume).toBe(6000);

    const center = props.CentreOfMass();
    expect(center.X()).toBe(5);
    expect(center.Y()).toBe(10);
    expect(center.Z()).toBe(15);

    props.delete();
    box.delete();
  });

  it('should compute surface area of a 10x20x30 box with BRepGProp', () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();

    const props = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties_1(shape, props, false, false);

    const area = props.Mass();
    const expected = 2 * (10 * 20 + 20 * 30 + 10 * 30);
    expect(area).toBe(2200);

    props.delete();
    box.delete();
  });

  it('should compute volume of a sphere with BRepGProp', () => {
    const oc = getOC();
    const radius = 10;

    const sphere = new oc.BRepPrimAPI_MakeSphere_1(radius);
    const shape = sphere.Shape();

    const props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);

    const volume = props.Mass();
    const expectedVolume = (4 / 3) * Math.PI * radius ** 3;
    expect(volume).toBeCloseTo(expectedVolume, 0);

    const center = props.CentreOfMass();
    expect(center.X()).toBeCloseTo(0, 10);
    expect(center.Y()).toBeCloseTo(0, 10);
    expect(center.Z()).toBeCloseTo(0, 10);

    props.delete();
    sphere.delete();
  });

  it('should compute linear properties on a box wire segment with BRepGProp', () => {
    const oc = getOC();
    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(10, 0, 0);
    const edge = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);

    const props = new oc.GProp_GProps();
    oc.BRepGProp.LinearProperties(edge.Shape(), props, false, false);

    const length = props.Mass();
    expect(length).toBe(10);

    props.delete();
    edge.delete();
    p2.delete();
    p1.delete();
  });

  it('should compute bounding box for a box shape with Bnd_Box', () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();

    const bndBox = new oc.Bnd_Box();
    oc.BRepBndLib.Add(shape, bndBox, false);

    expect(bndBox.IsVoid()).toBe(false);

    const xMin = bndBox.GetXMin();
    const yMin = bndBox.GetYMin();
    const zMin = bndBox.GetZMin();
    const xMax = bndBox.GetXMax();
    const yMax = bndBox.GetYMax();
    const zMax = bndBox.GetZMax();

    expect(xMin).toBeCloseTo(0, 5);
    expect(yMin).toBeCloseTo(0, 5);
    expect(zMin).toBeCloseTo(0, 5);
    expect(xMax).toBeCloseTo(10, 5);
    expect(yMax).toBeCloseTo(20, 5);
    expect(zMax).toBeCloseTo(30, 5);

    bndBox.delete();
    box.delete();
  });

  it('should check point containment with Bnd_Box', () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const shape = box.Shape();

    const bndBox = new oc.Bnd_Box();
    oc.BRepBndLib.Add(shape, bndBox, false);

    const inside = new oc.gp_Pnt(5, 5, 5);
    const outside = new oc.gp_Pnt(15, 15, 15);

    expect(bndBox.IsOut_1(inside)).toBe(false);
    expect(bndBox.IsOut_1(outside)).toBe(true);

    outside.delete();
    inside.delete();
    bndBox.delete();
    box.delete();
  });

  it('should validate box dimensions in GLB export via gltf-transform', async () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(25, 15, 10);
    const shape = box.Shape();

    await expectShapeGeometry(shape, {
      size: [25, 15, 10],
      center: [12.5, 7.5, 5],
      meshCount: 1,
    });

    box.delete();
  });

  it('should validate sphere dimensions in GLB export via gltf-transform', async () => {
    const oc = getOC();
    const sphere = new oc.BRepPrimAPI_MakeSphere_1(8);
    const shape = sphere.Shape();

    await expectShapeGeometry(shape, {
      size: [16, 16, 16],
      center: [0, 0, 0],
      meshCount: 1,
    });

    sphere.delete();
  });

  it('should validate cylinder dimensions in GLB export via gltf-transform', async () => {
    const oc = getOC();
    const cyl = new oc.BRepPrimAPI_MakeCylinder_1(5, 20);
    const shape = cyl.Shape();

    await expectShapeGeometry(shape, {
      size: [10, 10, 20],
      center: [0, 0, 10],
    });

    cyl.delete();
  });
});
