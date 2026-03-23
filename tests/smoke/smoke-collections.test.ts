/**
 * Smoke tests: OCCT collection types.
 *
 * Demonstrates:
 * - TopTools_ListOfShape: building, iterating, sizing
 * - TopTools_IndexedMapOfShape: deduplicating and indexing shapes
 * - TColgp_Array1OfPnt: fixed-size point arrays
 * - TopExp_Explorer as an iterator for topology traversal
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Collections', () => {
  beforeAll(async () => { await initOC(); });

  it('should support append, size, and access on TopTools_ListOfShape', () => {
    const oc = getOC();
    using box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    using box2 = new oc.BRepPrimAPI_MakeBox(20, 20, 20);
    using box3 = new oc.BRepPrimAPI_MakeBox(30, 30, 30);

    using list = new oc.TopTools_ListOfShape();
    expect(list.Size()).toBe(0);

    list.Append(box1.Shape());
    list.Append(box2.Shape());
    list.Append(box3.Shape());

    expect(list.Size()).toBe(3);

    const first = list.First();
    expect(first.IsNull()).toBe(false);

    const last = list.Last();
    expect(last.IsNull()).toBe(false);
  });

  it('should support prepend and reverse on TopTools_ListOfShape', () => {
    const oc = getOC();
    using box1 = new oc.BRepPrimAPI_MakeBox(5, 5, 5);
    using box2 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);

    using list = new oc.TopTools_ListOfShape();
    list.Append(box1.Shape());
    list.Prepend(box2.Shape());

    expect(list.Size()).toBe(2);

    list.Reverse();
    expect(list.Size()).toBe(2);

    list.RemoveFirst();
    expect(list.Size()).toBe(1);
  });

  it('should collect unique faces from a box with TopTools_IndexedMapOfShape', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const shape = box.Shape();

    using map = new oc.TopTools_IndexedMapOfShape();

    using explorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );

    while (explorer.More()) {
      map.Add(explorer.Current());
      explorer.Next();
    }

    expect(map.Size()).toBe(6);

    const face1 = map.FindKey(1);
    expect(face1.IsNull()).toBe(false);

    expect(map.Contains(face1)).toBe(true);

    const faceIndex = map.FindIndex(face1);
    expect(faceIndex).toBe(1);
  });

  it('should collect unique edges from a box with TopTools_IndexedMapOfShape', () => {
    const oc = getOC();
    using box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const shape = box.Shape();

    using edgeMap = new oc.TopTools_IndexedMapOfShape();

    using explorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );

    while (explorer.More()) {
      edgeMap.Add(explorer.Current());
      explorer.Next();
    }

    expect(edgeMap.Size()).toBe(12);
  });

  it('should store and retrieve points in TColgp_Array1OfPnt', () => {
    const oc = getOC();
    using arr = new oc.TColgp_Array1OfPnt(1, 5);
    expect(arr.Length()).toBe(5);
    expect(arr.Lower()).toBe(1);
    expect(arr.Upper()).toBe(5);

    using pt0 = new oc.gp_Pnt(0, 0, 0);
    using pt1 = new oc.gp_Pnt(1, 2, 3);
    using pt2 = new oc.gp_Pnt(4, 5, 6);
    using pt3 = new oc.gp_Pnt(7, 8, 9);
    using pt4 = new oc.gp_Pnt(10, 11, 12);
    const pts = [pt0, pt1, pt2, pt3, pt4];

    for (let i = 0; i < pts.length; i++) {
      arr.SetValue(i + 1, pts[i]!);
    }

    const retrieved = arr.Value(3);
    expect(retrieved.X()).toBe(4);
    expect(retrieved.Y()).toBe(5);
    expect(retrieved.Z()).toBe(6);

    const first = arr.First();
    expect(first.X()).toBe(0);

    const last = arr.Last();
    expect(last.X()).toBe(10);
  });

  it('should count unique topology elements of a cylinder with IndexedMapOfShape', () => {
    const oc = getOC();
    using cyl = new oc.BRepPrimAPI_MakeCylinder(5, 10);
    const shape = cyl.Shape();

    using faceMap = new oc.TopTools_IndexedMapOfShape();
    using edgeMap = new oc.TopTools_IndexedMapOfShape();
    using vertexMap = new oc.TopTools_IndexedMapOfShape();

    using faceExp = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (faceExp.More()) {
      faceMap.Add(faceExp.Current());
      faceExp.Next();
    }

    using edgeExp = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (edgeExp.More()) {
      edgeMap.Add(edgeExp.Current());
      edgeExp.Next();
    }

    using vertExp = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (vertExp.More()) {
      vertexMap.Add(vertExp.Current());
      vertExp.Next();
    }

    expect(faceMap.Size()).toBe(3);
    expect(edgeMap.Size()).toBe(3);
    expect(vertexMap.Size()).toBe(2);
  });

  it('should report correct size after appending items to TopTools_ListOfShape', () => {
    const oc = getOC();
    using box1 = new oc.BRepPrimAPI_MakeBox(1, 1, 1);
    using box2 = new oc.BRepPrimAPI_MakeBox(2, 2, 2);
    using box3 = new oc.BRepPrimAPI_MakeBox(3, 3, 3);

    using list = new oc.TopTools_ListOfShape();

    list.Append(box1.Shape());
    list.Append(box2.Shape());
    list.Append(box3.Shape());

    expect(list.Size()).toBe(3);
    expect(list.First().IsNull()).toBe(false);
    expect(list.Last().IsNull()).toBe(false);
  });
});
