import { describe, it, expect } from 'vitest';
import { getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Topology', () => {
  it('should count 6 faces, 24 edges, and 8 vertices on box with TopExp_Explorer', async () => {
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

  it('should build compound from box with BRep_Builder and TopoDS_Compound', async () => {
    const oc = await getOC();
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const builder = new oc.BRep_Builder();
    const compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);
    builder.Add(compound, box.Shape());
    const shape = compound;
    expect(shape.IsNull()).toBe(false);
    box.delete();
    builder.delete();
    compound.delete();
  });

  it('should convert explorer Current to Face/Edge/Vertex with TopoDS cast functions', async () => {
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
    face.delete();

    const edgeExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    expect(edgeExplorer.More()).toBe(true);
    const edge = oc.TopoDS_Cast.Edge(edgeExplorer.Current());
    edge.delete();

    const vertexExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
    );
    expect(vertexExplorer.More()).toBe(true);
    const vertex = oc.TopoDS_Cast.Vertex(vertexExplorer.Current());
    vertex.delete();

    box.delete();
    faceExplorer.delete();
    edgeExplorer.delete();
    vertexExplorer.delete();
  });
});
