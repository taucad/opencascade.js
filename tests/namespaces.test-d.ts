import { expectTypeOf, it } from 'vitest';
import type {
  gp,
  gp_Pnt,
  gp_Vec,
  BRepPrimAPI,
  BRepPrimAPI_MakeBox,
  BRepBuilderAPI,
  BRepAlgoAPI,
  TopAbs,
  TopAbs_ShapeEnum,
  TopExp,
  TopTools,
  TopoDS as TopoDS_NS,
  Geom,
  GeomAbs,
  BRepOffsetAPI,
  TColgp,
  TColStd,
  BRepFilletAPI,
  GProp,
  Bnd,
  STEPControl,
  IFSelect,
  Message,
  Quantity,
  TCollection,
  TDocStd,
  XCAFDoc,
  ShapeFix,
  BRepMesh,
  StlAPI,
  BRep,
  BRepAdaptor,
  Geom2d,
  GCE2d,
  Expr,
  FairCurve,
  Standard,
} from '../build-configs/opencascade_full';

it('should expose gp namespace with geometry types', () => {
  expectTypeOf<gp.Pnt>().toHaveProperty('X');
  expectTypeOf<gp.Pnt>().toHaveProperty('Y');
  expectTypeOf<gp.Pnt>().toHaveProperty('Z');
  expectTypeOf<gp.Pnt>().toHaveProperty('Distance');
  expectTypeOf<gp.Vec>().toHaveProperty('Magnitude');
  expectTypeOf<gp.Dir>().toHaveProperty('X');
  expectTypeOf<gp.Pnt2d>().toHaveProperty('X');
});

it('should expose BRepPrimAPI namespace with primitive builders', () => {
  expectTypeOf<BRepPrimAPI.MakeBox>().toHaveProperty('Shape');
  expectTypeOf<BRepPrimAPI.MakeBox>().toHaveProperty('delete');
  expectTypeOf<BRepPrimAPI.MakeSphere>().toHaveProperty('Shape');
  expectTypeOf<BRepPrimAPI.MakeCylinder>().toHaveProperty('Shape');
});

it('should expose BRepBuilderAPI namespace', () => {
  expectTypeOf<BRepBuilderAPI.MakeEdge>().toHaveProperty('Edge');
  expectTypeOf<BRepBuilderAPI.MakeWire>().toHaveProperty('Wire');
  expectTypeOf<BRepBuilderAPI.MakeFace>().toHaveProperty('Face');
});

it('should expose BRepAlgoAPI namespace with boolean operations', () => {
  expectTypeOf<BRepAlgoAPI.Fuse>().toHaveProperty('Shape');
  expectTypeOf<BRepAlgoAPI.Cut>().toHaveProperty('Shape');
  expectTypeOf<BRepAlgoAPI.Common>().toHaveProperty('Shape');
});

it('should expose TopAbs namespace with topology enums', () => {
  expectTypeOf<TopAbs.ShapeEnum>().toBeNumber();
  expectTypeOf<TopAbs.Orientation>().toBeNumber();
});

it('should expose TopExp namespace with topology explorer', () => {
  expectTypeOf<TopExp.Explorer>().toHaveProperty('More');
  expectTypeOf<TopExp.Explorer>().toHaveProperty('Next');
  expectTypeOf<TopExp.Explorer>().toHaveProperty('Current');
});

it('should expose TopoDS namespace with shape types', () => {
  expectTypeOf<TopoDS_NS.Shape>().toHaveProperty('IsNull');
  expectTypeOf<TopoDS_NS.Edge>().toHaveProperty('IsNull');
  expectTypeOf<TopoDS_NS.Face>().toHaveProperty('IsNull');
  expectTypeOf<TopoDS_NS.Wire>().toHaveProperty('IsNull');
});

it('should expose Geom namespace with geometry classes', () => {
  expectTypeOf<Geom.Circle>().toHaveProperty('Radius');
  expectTypeOf<Geom.Line>().toHaveProperty('Position');
});

it('should expose GeomAbs namespace with enums', () => {
  expectTypeOf<GeomAbs.CurveType>().toBeNumber();
  expectTypeOf<GeomAbs.Shape>().toBeNumber();
});

it('should expose BRepOffsetAPI namespace', () => {
  expectTypeOf<BRepOffsetAPI.ThruSections>().toHaveProperty('Shape');
  expectTypeOf<BRepOffsetAPI.MakePipe>().toHaveProperty('Shape');
});

it('should expose collection namespaces', () => {
  expectTypeOf<TColgp.Array1OfPnt>().toHaveProperty('Value');
  expectTypeOf<TopTools.ListOfShape>().toHaveProperty('Size');
});

it('should expose data exchange namespaces', () => {
  expectTypeOf<STEPControl.Writer>().toHaveProperty('Write');
  expectTypeOf<STEPControl.Reader>().toHaveProperty('ReadFile');
  expectTypeOf<IFSelect.ReturnStatus>().toBeNumber();
});

it('should expose application framework namespaces', () => {
  expectTypeOf<TDocStd.Document>().toHaveProperty('Main');
  expectTypeOf<TCollection.ExtendedString>().toHaveProperty('delete');
  expectTypeOf<XCAFDoc.DocumentTool>().toHaveProperty('delete');
});

it('should expose shape analysis namespace', () => {
  expectTypeOf<ShapeFix.Shape>().toHaveProperty('Shape');
});

it('should expose Standard namespace', () => {
  expectTypeOf<Standard.Transient>().toHaveProperty('delete');
});

it('should expose BRepFilletAPI namespace', () => {
  expectTypeOf<BRepFilletAPI.MakeFillet>().toHaveProperty('Shape');
  expectTypeOf<BRepFilletAPI.MakeChamfer>().toHaveProperty('Shape');
});

it('should expose GProp namespace', () => {
  expectTypeOf<GProp.GProps>().toHaveProperty('Mass');
});

it('should expose Bnd namespace', () => {
  expectTypeOf<Bnd.Box>().toHaveProperty('IsVoid');
});

it('should expose Message namespace', () => {
  expectTypeOf<Message.ProgressRange>().toHaveProperty('delete');
});

it('should expose Quantity namespace', () => {
  expectTypeOf<Quantity.Color>().toHaveProperty('Red');
});

it('should expose BRepMesh namespace', () => {
  expectTypeOf<BRepMesh.IncrementalMesh>().toHaveProperty('delete');
});

it('should expose BRep namespace', () => {
  expectTypeOf<BRep.Builder>().toHaveProperty('MakeCompound');
});

it('should expose 2D geometry namespaces', () => {
  expectTypeOf<Geom2d.Circle>().toHaveProperty('Radius');
  expectTypeOf<GCE2d.MakeCircle>().toHaveProperty('Value');
});

it('should expose Expr namespace', () => {
  expectTypeOf<Expr.NamedUnknown>().toHaveProperty('delete');
});

it('should expose FairCurve namespace', () => {
  expectTypeOf<FairCurve.Batten>().toHaveProperty('delete');
});

it('namespace types should be identical to flat types', () => {
  expectTypeOf<gp.Pnt>().toEqualTypeOf<InstanceType<typeof gp_Pnt>>();
  expectTypeOf<gp.Vec>().toEqualTypeOf<InstanceType<typeof gp_Vec>>();
  expectTypeOf<BRepPrimAPI.MakeBox>().toEqualTypeOf<InstanceType<typeof BRepPrimAPI_MakeBox>>();
  expectTypeOf<TopAbs.ShapeEnum>().toEqualTypeOf<TopAbs_ShapeEnum>();
});

it('constructor subclass types should be in the same namespace as the base', () => {
  expectTypeOf<BRepPrimAPI.MakeBox_2>().toMatchTypeOf<BRepPrimAPI.MakeBox>();
  expectTypeOf<BRepPrimAPI.MakeBox_3>().toMatchTypeOf<BRepPrimAPI.MakeBox>();
});
