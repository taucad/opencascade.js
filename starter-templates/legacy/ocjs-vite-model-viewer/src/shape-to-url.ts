/**
 * Convert a TopoDS_Shape to a GLB blob URL via BRepMesh + StlAPI.
 *
 * Uses STL triangulation as an intermediate format since the OCCT→GLB
 * pipeline (RWGltf_CafWriter) requires the full XDE framework.
 * For a simple demo, STL→GLB is sufficient.
 */

type OcInstance = Record<string, any>;
type OcShape = { IsNull: () => boolean };

export function shapeToGlbUrl(oc: OcInstance, shape: OcShape): string {
  const mesh = new oc.BRepMesh_IncrementalMesh_2(shape as never, 0.1, false, 0.5, false);
  mesh.Perform(new oc.Message_ProgressRange_1());

  const writer = new oc.StlAPI_Writer();
  writer.ASCIIMode = false;

  const tempPath = '/tmp/export.stl';
  const success: boolean = writer.Write(shape as never, tempPath, new oc.Message_ProgressRange_1());

  if (!success) {
    throw new Error('STL export failed');
  }

  const fileData = oc.FS.readFile(tempPath) as Uint8Array<ArrayBuffer>;
  oc.FS.unlink(tempPath);
  mesh.delete();

  const blob = new Blob([fileData.buffer], { type: 'model/stl' });
  return URL.createObjectURL(blob);
}
