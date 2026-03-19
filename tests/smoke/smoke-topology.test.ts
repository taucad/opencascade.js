import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: Topology', () => {
  beforeAll(async () => { await initOC(); });

  it('should count 6 faces, 24 edges, and 8 vertices on box with TopExp_Explorer', () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const shape = box.Shape();

    let faceCount = 0;
    const faceExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    for (; faceExplorer.More(); faceExplorer.Next()) {
      faceCount++;
    }

    let edgeCount = 0;
    const edgeExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    for (; edgeExplorer.More(); edgeExplorer.Next()) {
      edgeCount++;
    }

    let vertexCount = 0;
    const vertexExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
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

  it('should build compound from box with BRep_Builder and TopoDS_Compound', () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
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

  it('should convert explorer Current to Face/Edge/Vertex with TopoDS cast functions', () => {
    const oc = getOC();
    const box = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    const shape = box.Shape();

    const faceExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    expect(faceExplorer.More()).toBe(true);
    const face = oc.TopoDS.Face(faceExplorer.Current());
    face.delete();

    const edgeExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    expect(edgeExplorer.More()).toBe(true);
    const edge = oc.TopoDS.Edge(edgeExplorer.Current());
    edge.delete();

    const vertexExplorer = new oc.TopExp_Explorer(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    expect(vertexExplorer.More()).toBe(true);
    const vertex = oc.TopoDS.Vertex(vertexExplorer.Current());
    vertex.delete();

    box.delete();
    faceExplorer.delete();
    edgeExplorer.delete();
    vertexExplorer.delete();
  });
});
