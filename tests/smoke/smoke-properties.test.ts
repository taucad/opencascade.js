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
    using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    const shape = box.Shape();

    using props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(shape, props, false, false, false);

    const volume = props.Mass();
    expect(volume).toBe(6000);

    const center = props.CentreOfMass();
    expect(center.X()).toBe(5);
    expect(center.Y()).toBe(10);
    expect(center.Z()).toBe(15);
  });

  it('should compute surface area of a 10x20x30 box with BRepGProp', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    const shape = box.Shape();

    using props = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(shape, props, false, false);

    const area = props.Mass();
    const expected = 2 * (10 * 20 + 20 * 30 + 10 * 30);
    expect(area).toBe(2200);
  });

  it('should compute volume of a sphere with BRepGProp', () => {
    const oc = getOC();
    const radius = 10;

    using sphere = new oc.BRepPrimAPI_MakeSphere(radius);
    const shape = sphere.Shape();

    using props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(shape, props, false, false, false);

    const volume = props.Mass();
    const expectedVolume = (4 / 3) * Math.PI * radius ** 3;
    expect(volume).toBeCloseTo(expectedVolume, 0);

    const center = props.CentreOfMass();
    expect(center.X()).toBeCloseTo(0, 10);
    expect(center.Y()).toBeCloseTo(0, 10);
    expect(center.Z()).toBeCloseTo(0, 10);
  });

  it('should compute linear properties on a box wire segment with BRepGProp', () => {
    const oc = getOC();
    using p1 = new oc.gp_Pnt(0, 0, 0);
    using p2 = new oc.gp_Pnt(10, 0, 0);
    using edge = new oc.BRepBuilderAPI_MakeEdge(p1, p2);

    using props = new oc.GProp_GProps();
    oc.BRepGProp.LinearProperties(edge.Shape(), props, false, false);

    const length = props.Mass();
    expect(length).toBe(10);
  });

  it('should compute bounding box for a box shape with Bnd_Box', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 20, 30);
    const shape = box.Shape();

    using bndBox = new oc.Bnd_Box();
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
  });

  it('should check point containment with Bnd_Box', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const shape = box.Shape();

    using bndBox = new oc.Bnd_Box();
    oc.BRepBndLib.Add(shape, bndBox, false);

    using inside = new oc.gp_Pnt(5, 5, 5);
    using outside = new oc.gp_Pnt(15, 15, 15);

    expect(bndBox.IsOut(inside)).toBe(false);
    expect(bndBox.IsOut(outside)).toBe(true);
  });

  it('should validate box dimensions in GLB export via gltf-transform', async () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(25, 15, 10);
    const shape = box.Shape();

    await expectShapeGeometry(shape, {
      size: [25, 15, 10],
      center: [12.5, 7.5, 5],
      meshCount: 1,
    });
  });

  it('should validate sphere dimensions in GLB export via gltf-transform', async () => {
    const oc = getOC();
    using sphere = new oc.BRepPrimAPI_MakeSphere(8);
    const shape = sphere.Shape();

    await expectShapeGeometry(shape, {
      size: [16, 16, 16],
      center: [0, 0, 0],
      meshCount: 1,
    });
  });

  it('should validate cylinder dimensions in GLB export via gltf-transform', async () => {
    const oc = getOC();
    using cyl = new oc.BRepPrimAPI_MakeCylinder(5, 20);
    const shape = cyl.Shape();

    await expectShapeGeometry(shape, {
      size: [10, 10, 20],
      center: [0, 0, 10],
    });
  });

  it('should compute a finite 2D bounding box for a circular arc via BndLib_Add2dCurve', () => {
    const oc = getOC();
    const radius = 7;
    using origin = new oc.gp_Pnt2d(0, 0);
    using dir = new oc.gp_Dir2d(1, 0);
    using ax = new oc.gp_Ax2d(origin, dir);
    using circle = new oc.Geom2d_Circle(ax, radius, true);

    using box2d = new oc.Bnd_Box2d();

    oc.BndLib_Add2dCurve.Add(circle, 0, 2 * Math.PI, 0, box2d);

    expect(box2d.IsVoid()).toBe(false);

    const width = box2d.GetXMax() - box2d.GetXMin();
    const height = box2d.GetYMax() - box2d.GetYMin();

    expect(width).toBeCloseTo(2 * radius, 0);
    expect(height).toBeCloseTo(2 * radius, 0);
  });
});
