import '@google/model-viewer';
import initOpenCascade from 'opencascade.js';
import { shapeToGlbUrl } from './shape-to-url';

const statusEl = document.getElementById('status')!;
const viewerEl = document.getElementById('viewer')! as HTMLElement & { src: string };

async function run() {
  statusEl.textContent = 'Loading OpenCASCADE WASM...';
  const oc = await initOpenCascade();
  statusEl.textContent = 'Creating geometry...';

  const box = new oc.BRepPrimAPI_MakeBox_3(60, 40, 20);
  const boxShape = box.Shape();

  const fillet = new oc.BRepFilletAPI_MakeFillet(boxShape, oc.ChFi3d_FilletShape.ChFi3d_Rational as never);
  const explorer = new oc.TopExp_Explorer_2(
    boxShape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
  );

  while (explorer.More()) {
    const edge = oc.TopoDS.Edge_1(explorer.Current());
    fillet.Add_2(3, edge);
    explorer.Next();
  }

  const filletedShape = fillet.Shape();

  statusEl.textContent = 'Meshing and exporting GLB...';
  const glbUrl = shapeToGlbUrl(oc, filletedShape);

  viewerEl.src = glbUrl;
  viewerEl.style.display = 'block';
  statusEl.textContent = 'Ready — drag to rotate, scroll to zoom';

  box.delete();
  fillet.delete();
  explorer.delete();
}

run().catch((err) => {
  statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  console.error(err);
});
