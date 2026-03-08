/**
 * Smoke tests: Geometric properties and bounding boxes.
 *
 * Demonstrates:
 * - Computing volume, surface area, and center of mass with BRepGProp
 * - Computing bounding boxes with Bnd_Box and BRepBndLib
 * - Validating dimensions via GProp_GProps
 * - GLB export with geometry dimension validation
 */
import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';
import { expectShapeGeometry } from './geometry-helpers.js';

describe.skipIf(!wasmExists)('Smoke: Geometric properties', () => {
  it('BRepGProp computes volume of a 10x20x30 box', async () => {
    const oc = await getOC();

    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();

    const props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);

    const volume = props.Mass();
    expect(volume).toBeCloseTo(10 * 20 * 30, 0);

    const center = props.CentreOfMass();
    expect(center.X()).toBeCloseTo(5, 1);
    expect(center.Y()).toBeCloseTo(10, 1);
    expect(center.Z()).toBeCloseTo(15, 1);

    props.delete();
    box.delete();
  });

  it('BRepGProp computes surface area of a 10x20x30 box', async () => {
    const oc = await getOC();

    const box = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30);
    const shape = box.Shape();

    const props = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties_1(shape, props, false, false);

    const area = props.Mass();
    const expected = 2 * (10 * 20 + 20 * 30 + 10 * 30);
    expect(area).toBeCloseTo(expected, 0);

    props.delete();
    box.delete();
  });

  it('BRepGProp computes volume of a sphere', async () => {
    const oc = await getOC();
    const radius = 10;

    const sphere = new oc.BRepPrimAPI_MakeSphere_1(radius);
    const shape = sphere.Shape();

    const props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);

    const volume = props.Mass();
    const expectedVolume = (4 / 3) * Math.PI * radius ** 3;
    expect(volume).toBeCloseTo(expectedVolume, -1);

    const center = props.CentreOfMass();
    expect(center.X()).toBeCloseTo(0, 0);
    expect(center.Y()).toBeCloseTo(0, 0);
    expect(center.Z()).toBeCloseTo(0, 0);

    props.delete();
    sphere.delete();
  });

  it('BRepGProp linear properties on a box wire segment', async () => {
    const oc = await getOC();

    const p1 = new oc.gp_Pnt(0, 0, 0);
    const p2 = new oc.gp_Pnt(10, 0, 0);
    const edge = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2);

    const props = new oc.GProp_GProps();
    oc.BRepGProp.LinearProperties(edge.Shape(), props, false, false);

    const length = props.Mass();
    expect(length).toBeCloseTo(10, 1);

    props.delete();
    edge.delete();
    p2.delete();
    p1.delete();
  });

  it('Bnd_Box computes bounding box for a box shape', async () => {
    const oc = await getOC();

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

    expect(xMin).toBeCloseTo(0, 0);
    expect(yMin).toBeCloseTo(0, 0);
    expect(zMin).toBeCloseTo(0, 0);
    expect(xMax).toBeCloseTo(10, 0);
    expect(yMax).toBeCloseTo(20, 0);
    expect(zMax).toBeCloseTo(30, 0);

    bndBox.delete();
    box.delete();
  });

  it('Bnd_Box checks point containment', async () => {
    const oc = await getOC();

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

  it('GLB export validates box dimensions via gltf-transform', async () => {
    const oc = await getOC();

    const box = new oc.BRepPrimAPI_MakeBox_2(25, 15, 10);
    const shape = box.Shape();

    await expectShapeGeometry(shape, {
      size: [25, 15, 10],
      center: [12.5, 7.5, 5],
      meshCount: 1,
      tolerance: 1,
    });

    box.delete();
  });

  it('GLB export validates sphere dimensions via gltf-transform', async () => {
    const oc = await getOC();

    const sphere = new oc.BRepPrimAPI_MakeSphere_1(8);
    const shape = sphere.Shape();

    await expectShapeGeometry(shape, {
      size: [16, 16, 16],
      center: [0, 0, 0],
      meshCount: 1,
      tolerance: 1,
    });

    sphere.delete();
  });

  it('GLB export validates cylinder dimensions via gltf-transform', async () => {
    const oc = await getOC();

    const cyl = new oc.BRepPrimAPI_MakeCylinder_1(5, 20);
    const shape = cyl.Shape();

    await expectShapeGeometry(shape, {
      size: [10, 10, 20],
      center: [0, 0, 10],
      tolerance: 1,
    });

    cyl.delete();
  });
});
