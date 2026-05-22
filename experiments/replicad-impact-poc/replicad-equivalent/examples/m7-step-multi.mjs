// M7 — STEP file multi-component (iterate sub-solids + mesh each).
//
// Coverage target: load the same STEP file as M6, but iterate the top-level
// solids and mesh each independently. Stresses repeated mesh-extraction
// across N small shapes (vs. M6's one large compound).
//
// Compared to M6:
//   - Same load cost (TransferRoots + OneShape produces the same shape).
//   - DIFFERENT mesh cost: BRepMesh_IncrementalMesh runs per-solid, with
//     each iteration repeating the discretisation setup. In the F-strategy
//     case, extractMesh is called N times, each producing its own
//     PocMeshData buffer.
//   - The bench measures the per-solid amortisation: does Strategy F's
//     boundary cost amortise differently across 21 small shapes vs. one
//     big compound?
import {
  collectSolids,
} from '../helpers.mjs';
import { meshNaive, meshExtractorF } from '../mesh.mjs';
import { buildStepCompound, prewarmStepFile } from './m6-step-single.mjs';

export { prewarmStepFile };

/**
 * Mesh each top-level solid of the STEP compound independently. Returns a
 * single aggregated mesh result (concatenated vertices/triangles with
 * per-solid faceGroups), so the bench harness can hash it like other models.
 */
export function runStepMulti(oc, { mesh = 'naive' } = {}) {
  using compound = buildStepCompound(oc);
  const solids = collectSolids(oc, compound);
  const meshFn = mesh === 'F' ? meshExtractorF : meshNaive;

  // Collect per-solid meshes then concatenate into a flat aggregate.
  const meshes = [];
  let totalVerts = 0;
  let totalTris = 0;
  for (const solid of solids) {
    using s = solid;
    const m = meshFn(oc, s, { tolerance: 0.5, angularTolerance: 0.3 });
    meshes.push(m);
    totalVerts += m.vertices.length / 3;
    totalTris += m.triangles.length / 3;
  }

  // Flatten into Float32/Uint32 aggregates. Re-base triangle indices to
  // account for vertex concatenation.
  const verticesAgg = new Float32Array(totalVerts * 3);
  const trianglesAgg = new Uint32Array(totalTris * 3);
  const normalsAgg = new Float32Array(totalVerts * 3);
  const faceGroupsAgg = [];
  let vOff = 0, tOff = 0;
  for (const m of meshes) {
    verticesAgg.set(m.vertices, vOff * 3);
    if (m.normals.length) normalsAgg.set(m.normals, vOff * 3);
    for (let i = 0; i < m.triangles.length; i++) {
      trianglesAgg[tOff * 3 + i] = m.triangles[i] + vOff;
    }
    for (const g of m.faceGroups) {
      faceGroupsAgg.push({ start: g.start + tOff * 3, count: g.count, faceId: g.faceId });
    }
    vOff += m.vertices.length / 3;
    tOff += m.triangles.length / 3;
  }
  return {
    vertices: verticesAgg,
    triangles: trianglesAgg,
    normals: normalsAgg,
    faceGroups: faceGroupsAgg,
    meta: { solidCount: solids.length },
  };
}
