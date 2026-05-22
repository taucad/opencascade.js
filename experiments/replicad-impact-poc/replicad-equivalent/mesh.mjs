// Pattern 3 — Triangulation hot path.
// Two strategies:
//  (a) NAIVE — walk faces in JS, call BRep_Tool::Triangulation, then read every
//      Node(i) and Triangle(i) through embind one element at a time. Worst case.
//  (b) STRATEGY F — port replicad's `ReplicadMeshExtractor` pattern: do all the
//      walking in C++, return raw pointers, slice the wasm HEAP* views in JS.
//      This is what the production replicad build already uses for mesh export.

/**
 * NAIVE — per-element JS access through the OCCT triangulation API.
 * This is the regression path for someone who writes the "obvious" mesh extraction
 * without an extractor adapter.
 */
export function meshNaive(oc, shape, { tolerance = 1e-3, angularTolerance = 0.1 } = {}) {
  oc.BRepTools.Clean(shape, false);
  using mesher = new oc.BRepMesh_IncrementalMesh(shape, tolerance, false, angularTolerance, false);

  const vertices = [];
  const triangles = [];
  const normals = [];
  const faceGroups = [];

  using ex = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let vertexOffset = 0;
  let triOffsetIdx = 0;
  let faceId = 0;

  for (; ex.More(); ex.Next()) {
    using face = oc.TopoDS.Face(ex.Current());
    using loc = new oc.TopLoc_Location();
    using tri = oc.BRep_Tool.Triangulation(face, loc, 0);
    if (!tri || tri.isDeleted?.()) continue;

    using trsf = loc.Transformation();
    const nbNodes = tri.NbNodes();
    const nbTri = tri.NbTriangles();

    for (let i = 1; i <= nbNodes; i++) {
      using node = tri.Node(i);
      using transformed = node.Transformed(trsf);
      vertices.push(transformed.X(), transformed.Y(), transformed.Z());
      normals.push(0, 0, 1);
    }

    for (let i = 1; i <= nbTri; i++) {
      using t = tri.Triangle(i);
      const out = t.Get(0, 0, 0);
      triangles.push(vertexOffset + out.theN1 - 1);
      triangles.push(vertexOffset + out.theN2 - 1);
      triangles.push(vertexOffset + out.theN3 - 1);
    }

    faceGroups.push({ start: triOffsetIdx, count: nbTri * 3, faceId });
    triOffsetIdx += nbTri * 3;
    vertexOffset += nbNodes;
    faceId++;
  }

  return {
    vertices: Float32Array.from(vertices),
    triangles: Uint32Array.from(triangles),
    normals: Float32Array.from(normals),
    faceGroups,
  };
}

/**
 * STRATEGY F — replicad's ReplicadMeshExtractor pattern (status quo for mesh).
 * All walking + raw-pointer allocation in C++; JS only slices typed-array views
 * over the wasm linear memory. Zero per-element embind hops.
 */
export function meshExtractorF(oc, shape, { tolerance = 1e-3, angularTolerance = 0.1, skipNormals = false } = {}) {
  using raw = oc.ReplicadAdapters.extractMesh(shape, tolerance, angularTolerance, skipNormals);

  // Re-take HEAP* views AFTER extract() returns; extract() may have triggered
  // memory.grow() which detaches previous views.
  const buffer = oc.HEAP8.buffer;
  const heapF32 = new Float32Array(buffer);
  const heapU32 = new Uint32Array(buffer);
  const heapI32 = new Int32Array(buffer);

  const verticesPtr = raw.getVerticesPtr();
  const verticesSize = raw.getVerticesSize();
  const trianglesPtr = raw.getTrianglesPtr();
  const trianglesSize = raw.getTrianglesSize();
  const normalsPtr = raw.getNormalsPtr();
  const normalsSize = raw.getNormalsSize();
  const groupsPtr = raw.getFaceGroupsPtr();
  const groupsSize = raw.getFaceGroupsSize();

  // Subarray views are zero-copy; copy out so the caller can keep them after
  // raw.delete() releases the malloc'd buffers.
  const vertices = heapF32.slice(verticesPtr / 4, verticesPtr / 4 + verticesSize);
  const triangles = heapU32.slice(trianglesPtr / 4, trianglesPtr / 4 + trianglesSize);
  const normals = skipNormals
    ? new Float32Array(0)
    : heapF32.slice(normalsPtr / 4, normalsPtr / 4 + normalsSize);

  const groupsRaw = heapI32.slice(groupsPtr / 4, groupsPtr / 4 + groupsSize);
  const faceGroups = [];
  for (let i = 0; i < groupsRaw.length; i += 3) {
    faceGroups.push({ start: groupsRaw[i], count: groupsRaw[i + 1], faceId: groupsRaw[i + 2] });
  }

  return { vertices, triangles, normals, faceGroups };
}
