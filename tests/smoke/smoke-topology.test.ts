import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Topology', () => {
  it('TopExp_Explorer counts 6 faces, 24 edges (with duplicates), 8 vertices on box', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const shape = box.Shape();

    let faceCount = 0;
    const faceExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    for (; faceExplorer.More(); faceExplorer.Next()) {
      faceCount++;
    }

    let edgeCount = 0;
    const edgeExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    for (; edgeExplorer.More(); edgeExplorer.Next()) {
      edgeCount++;
    }

    let vertexCount = 0;
    const vertexExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    for (; vertexExplorer.More(); vertexExplorer.Next()) {
      vertexCount++;
    }

    expect(faceCount).toBe(6);
    expect(edgeCount).toBe(24);
    expect(vertexCount).toBe(48);

    box.delete();
    faceExplorer.delete();
    edgeExplorer.delete();
    vertexExplorer.delete();
  });

  it('BRep_Builder and TopoDS_Compound build compound from box', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const builder = new oc.BRep_Builder();
    const compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);
    builder.Add(compound, box.Shape());
    const shape = compound;
    expect(shape).toBeTruthy();
    expect(shape.IsNull()).toBe(false);
    box.delete();
    builder.delete();
    compound.delete();
  });

  it('TopoDS cast functions convert explorer Current to Face/Edge/Vertex', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const shape = box.Shape();

    const faceExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    expect(faceExplorer.More()).toBe(true);
    const face = oc.TopoDS_Cast.Face(faceExplorer.Current());
    expect(face).toBeTruthy();
    face.delete();

    const edgeExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    expect(edgeExplorer.More()).toBe(true);
    const edge = oc.TopoDS_Cast.Edge(edgeExplorer.Current());
    expect(edge).toBeTruthy();
    edge.delete();

    const vertexExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    expect(vertexExplorer.More()).toBe(true);
    const vertex = oc.TopoDS_Cast.Vertex(vertexExplorer.Current());
    expect(vertex).toBeTruthy();
    vertex.delete();

    box.delete();
    faceExplorer.delete();
    edgeExplorer.delete();
    vertexExplorer.delete();
  });
});
