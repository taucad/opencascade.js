/**
 * Smoke tests: STEPCAFControl_Writer.
 *
 * Guards two source patches in the STEPCAFControl package that are required
 * for WASM trimming: the `STEPCAFControl_ActorWrite` entry in
 * `patch_noexcept_destructors.py` (rewrites the destructor as `noexcept` so it
 * can be inlined and stripped) and `patch_stepcaf_dyntype.py` (rewrites
 * `DynamicType()` to drop the unused RTTI lookup). Both are easy to regress
 * because they touch generated method bodies. These tests verify that colored
 * STEP export still round-trips correctly after those rewrites.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initOC, getOC, wasmExists } from './helpers.js';

describe.skipIf(!wasmExists)('Smoke: STEPCAFControl_Writer', () => {
  beforeAll(async () => {
    await initOC();
  });

  it('should export colored shapes to STEP and produce a file with correct root count', () => {
    const oc = getOC();
    using tCollectionExtendedstring = new oc.TCollection_ExtendedString();
    using doc = new oc.TDocStd_Document(tCollectionExtendedstring);
    using mainLabel = doc.Main();
    using shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(mainLabel);
    using colorTool = oc.XCAFDoc_DocumentTool.ColorTool(mainLabel);

    using box1 = new oc.BRepPrimAPI_MakeBox(10, 10, 10);
    using label1 = shapeTool.NewShape();
    using box1Shape = box1.Shape();
    shapeTool.SetShape(label1, box1Shape);

    using box2 = new oc.BRepPrimAPI_MakeBox(5, 5, 5);
    using label2 = shapeTool.NewShape();
    using box2Shape = box2.Shape();
    shapeTool.SetShape(label2, box2Shape);

    using red = new oc.Quantity_Color(1, 0, 0, oc.Quantity_TypeOfColor.Quantity_TOC_RGB);
    using blue = new oc.Quantity_Color(0, 0, 1, oc.Quantity_TypeOfColor.Quantity_TOC_RGB);
    using box1Shape2 = box1.Shape();
    colorTool.SetColor(box1Shape2, red, oc.XCAFDoc_ColorType.XCAFDoc_ColorGen);
    using box2Shape2 = box2.Shape();
    colorTool.SetColor(box2Shape2, blue, oc.XCAFDoc_ColorType.XCAFDoc_ColorGen);

    using writer = new oc.STEPCAFControl_Writer();
    using progress = new oc.Message_ProgressRange();
    const transferOk = writer.Transfer(doc, oc.STEPControl_StepModelType.STEPControl_AsIs, '', progress);
    expect(transferOk).toBe(true);

    const stepPath = '/tmp/_smoke_stepcaf_test.stp';
    const writeStatus = writer.Write(stepPath);
    expect(writeStatus).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);

    const fileData = oc.FS.readFile(stepPath);
    expect(fileData.length).toBeGreaterThan(100);

    using reader = new oc.STEPControl_Reader();
    const readStatus = reader.ReadFile(stepPath);
    expect(readStatus).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);
    expect(reader.NbRootsForTransfer()).toBeGreaterThanOrEqual(2);

    try {
      oc.FS.unlink(stepPath);
    } catch {
      /* best-effort cleanup */
    }
  });

  it('should round-trip shape geometry through STEP write and read back', () => {
    const oc = getOC();
    using tCollectionExtendedstring2 = new oc.TCollection_ExtendedString();
    using doc = new oc.TDocStd_Document(tCollectionExtendedstring2);
    using mainLabel = doc.Main();
    using shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(mainLabel);

    using sphere = new oc.BRepPrimAPI_MakeSphere(15);
    using label = shapeTool.NewShape();
    using sphereShape = sphere.Shape();
    shapeTool.SetShape(label, sphereShape);

    using writer = new oc.STEPCAFControl_Writer();
    using progress = new oc.Message_ProgressRange();
    writer.Transfer(doc, oc.STEPControl_StepModelType.STEPControl_AsIs, '', progress);

    const stepPath = '/tmp/_smoke_stepcaf_roundtrip.stp';
    const writeStatus = writer.Write(stepPath);
    expect(writeStatus).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);

    using reader = new oc.STEPControl_Reader();
    const readStatus = reader.ReadFile(stepPath);
    expect(readStatus).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);

    const nRoots = reader.NbRootsForTransfer();
    expect(nRoots).toBeGreaterThanOrEqual(1);

    try {
      oc.FS.unlink(stepPath);
    } catch {
      /* best-effort cleanup */
    }
  });

  it('should preserve a conical cylinder chamfer through STEPCAF round-trip', () => {
    const oc = getOC();
    using cylinder = new oc.BRepPrimAPI_MakeCylinder(25, 50);
    using cylinderShape = cylinder.Shape();
    using chamfer = new oc.BRepFilletAPI_MakeChamfer(cylinderShape);
    using edgeExplorer = new oc.TopExp_Explorer(
      cylinderShape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );

    let foundTopEdge = false;
    while (edgeExplorer.More()) {
      using current = edgeExplorer.Current();
      using edge = oc.TopoDS.Edge(current);
      using curve = new oc.BRepAdaptor_Curve(edge);
      if (curve.GetType() === oc.GeomAbs_CurveType.GeomAbs_Circle) {
        using circle = curve.Circle();
        using location = circle.Location();
        if (Math.abs(location.Z() - 50) < 1e-9) {
          chamfer.Add(5, edge);
          foundTopEdge = true;
          break;
        }
      }
      edgeExplorer.Next();
    }
    expect(foundTopEdge).toBe(true);

    using buildProgress = new oc.Message_ProgressRange();
    chamfer.Build(buildProgress);
    expect(chamfer.IsDone()).toBe(true);
    using chamferedShape = chamfer.Shape();

    using documentName = new oc.TCollection_ExtendedString('XmlOcaf', true);
    using document = new oc.TDocStd_Document(documentName);
    using mainLabel = document.Main();
    using shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(mainLabel);
    using shapeLabel = shapeTool.NewShape();
    shapeTool.SetShape(shapeLabel, chamferedShape);

    const stepPath = '/tmp/_smoke_stepcaf_chamfer.step';
    using writer = new oc.STEPCAFControl_Writer();
    using writeProgress = new oc.Message_ProgressRange();
    expect(writer.Perform(document, stepPath, writeProgress)).toBe(true);

    using readDocumentName = new oc.TCollection_ExtendedString('XmlOcaf', true);
    using readDocument = new oc.TDocStd_Document(readDocumentName);
    using reader = new oc.STEPCAFControl_Reader();
    using readProgress = new oc.Message_ProgressRange();
    expect(reader.Perform(stepPath, readDocument, readProgress)).toBe(true);
    using readMainLabel = readDocument.Main();
    using readShapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(readMainLabel);
    using readShape = readShapeTool.GetOneShape();
    using faceExplorer = new oc.TopExp_Explorer(
      readShape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );

    let cones = 0;
    let cylinders = 0;
    while (faceExplorer.More()) {
      using current = faceExplorer.Current();
      using face = oc.TopoDS.Face(current);
      using surface = new oc.BRepAdaptor_Surface(face, true);
      if (surface.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Cone) {
        cones += 1;
      }
      if (surface.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
        cylinders += 1;
      }
      faceExplorer.Next();
    }

    expect(cones).toBe(1);
    expect(cylinders).toBeGreaterThanOrEqual(1);

    try {
      oc.FS.unlink(stepPath);
    } catch {
      /* best-effort cleanup */
    }
  });
});
