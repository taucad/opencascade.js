/**
 * Smoke tests: OCCT collection types.
 *
 * Demonstrates:
 * - TopTools_ListOfShape: building, iterating, sizing
 * - TopTools_IndexedMapOfShape: deduplicating and indexing shapes
 * - TColgp_Array1OfPnt: fixed-size point arrays
 * - TopExp_Explorer as an iterator for topology traversal
 */
import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Collections', () => {
  it('should support append, size, and access on TopTools_ListOfShape', async () => {
    const oc = await getOC();

    const box1 = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const box2 = new oc.BRepPrimAPI_MakeBox_2(20, 20, 20);
    const box3 = new oc.BRepPrimAPI_MakeBox_2(30, 30, 30);

    const list = new oc.TopTools_ListOfShape_1();
    expect(list.Size()).toBe(0);

    list.Append_1(box1.Shape());
    list.Append_1(box2.Shape());
    list.Append_1(box3.Shape());

    expect(list.Size()).toBe(3);

    const first = list.First_1();
    expect(first.IsNull()).toBe(false);

    const last = list.Last_1();
    expect(last.IsNull()).toBe(false);

    list.delete();
    box3.delete();
    box2.delete();
    box1.delete();
  });

  it('should support prepend and reverse on TopTools_ListOfShape', async () => {
    const oc = await getOC();

    const box1 = new oc.BRepPrimAPI_MakeBox_2(5, 5, 5);
    const box2 = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);

    const list = new oc.TopTools_ListOfShape_1();
    list.Append_1(box1.Shape());
    list.Prepend_1(box2.Shape());

    expect(list.Size()).toBe(2);

    list.Reverse();
    expect(list.Size()).toBe(2);

    list.RemoveFirst();
    expect(list.Size()).toBe(1);

    list.delete();
    box2.delete();
    box1.delete();
  });

  it('should collect unique faces from a box with TopTools_IndexedMapOfShape', async () => {
    const oc = await getOC();

    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const shape = box.Shape();

    const map = new oc.TopTools_IndexedMapOfShape_1();

    const explorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );

    while (explorer.More()) {
      map.Add_1(explorer.Current());
      explorer.Next();
    }

    expect(map.Size()).toBe(6);

    const face1 = map.FindKey(1);
    expect(face1.IsNull()).toBe(false);

    expect(map.Contains(face1)).toBe(true);

    const faceIndex = map.FindIndex(face1);
    expect(faceIndex).toBe(1);

    map.delete();
    explorer.delete();
    box.delete();
  });

  it('should collect unique edges from a box with TopTools_IndexedMapOfShape', async () => {
    const oc = await getOC();

    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const shape = box.Shape();

    const edgeMap = new oc.TopTools_IndexedMapOfShape_1();

    const explorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );

    while (explorer.More()) {
      edgeMap.Add_1(explorer.Current());
      explorer.Next();
    }

    expect(edgeMap.Size()).toBe(12);

    edgeMap.delete();
    explorer.delete();
    box.delete();
  });

  it('should store and retrieve points in TColgp_Array1OfPnt', async () => {
    const oc = await getOC();

    const arr = new oc.TColgp_Array1OfPnt_2(1, 5);
    expect(arr.Length()).toBe(5);
    expect(arr.Lower()).toBe(1);
    expect(arr.Upper()).toBe(5);

    const pts = [
      new oc.gp_Pnt(0, 0, 0),
      new oc.gp_Pnt(1, 2, 3),
      new oc.gp_Pnt(4, 5, 6),
      new oc.gp_Pnt(7, 8, 9),
      new oc.gp_Pnt(10, 11, 12),
    ];

    for (let i = 0; i < pts.length; i++) {
      arr.SetValue_1(i + 1, pts[i]!);
    }

    const retrieved = arr.Value(3);
    expect(retrieved.X()).toBe(4);
    expect(retrieved.Y()).toBe(5);
    expect(retrieved.Z()).toBe(6);

    const first = arr.First();
    expect(first.X()).toBe(0);

    const last = arr.Last();
    expect(last.X()).toBe(10);

    arr.delete();
    for (const pt of pts) pt.delete();
  });

  it('should count unique topology elements of a cylinder with IndexedMapOfShape', async () => {
    const oc = await getOC();

    const cyl = new oc.BRepPrimAPI_MakeCylinder_1(5, 10);
    const shape = cyl.Shape();

    const faceMap = new oc.TopTools_IndexedMapOfShape_1();
    const edgeMap = new oc.TopTools_IndexedMapOfShape_1();
    const vertexMap = new oc.TopTools_IndexedMapOfShape_1();

    const faceExp = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (faceExp.More()) {
      faceMap.Add_1(faceExp.Current());
      faceExp.Next();
    }

    const edgeExp = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (edgeExp.More()) {
      edgeMap.Add_1(edgeExp.Current());
      edgeExp.Next();
    }

    const vertExp = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (vertExp.More()) {
      vertexMap.Add_1(vertExp.Current());
      vertExp.Next();
    }

    expect(faceMap.Size()).toBe(3);
    expect(edgeMap.Size()).toBe(3);
    expect(vertexMap.Size()).toBe(2);

    vertexMap.delete();
    edgeMap.delete();
    faceMap.delete();
    vertExp.delete();
    edgeExp.delete();
    faceExp.delete();
    cyl.delete();
  });
});
