// Replicad Impact PoC — adapter façade.
//
// One adapter class (`ReplicadAdapters`) covering all four hot patterns +
// strategy variants. Each method is a thin wrapper around the same OCCT calls
// replicad's TS code already makes; the only difference is *where* the
// JS<->C++ boundary lives.
//
// Strategies covered:
//   Strategy D    — flatten arrays at the boundary; one C++ call per data flow.
//   Strategy Dp   — Strategy D's primitive fast-path via typed_memory_view.
//   Strategy F    — port of replicad's `ReplicadMeshExtractor` (raw pointer return).
//   Naive-D       — Pattern 2 regression mitigation: materialize Poles/Knots/Mults.
//   Split-API D   — Pattern 2 regression mitigation: keep handle pass-through path.
//
// All adapters use intptr_t pointers + sizes for typed-array I/O. JS callers
// use `Module._malloc` / `Module.HEAPF64.set` to stage input buffers and
// `Module.HEAPF64.subarray` to read output buffers.

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <vector>

// ── Pattern 1 / 2 / 4 helpers (Strategy D + Naive-D + Split-API D) ────

// Forward-declare the OCCT facets we touch (the surface yml binds them).
class TopoDS_Edge;
class TopoDS_Shape;
class Geom2d_BSplineCurve;
class Geom_BSplineSurface;

// Egress wrapper: matches replicad's ReplicadMeshData pattern. Owns malloc'd
// pointers; JS reads the pointer/size pair, slices wasm HEAP* views, then
// disposes via embind to free.
class PocFloat64Array {
public:
  PocFloat64Array() : ptr_(nullptr), size_(0) {}
  PocFloat64Array(double* p, int n) : ptr_(p), size_(n) {}
  ~PocFloat64Array() { std::free(ptr_); }
  PocFloat64Array(const PocFloat64Array& other) : ptr_(other.ptr_), size_(other.size_) {
    auto& m = const_cast<PocFloat64Array&>(other);
    m.ptr_ = nullptr;
    m.size_ = 0;
  }
  int getPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(ptr_)); }
  int getSize() const { return size_; }
private:
  double* ptr_;
  int size_;
};

class PocInt32Array {
public:
  PocInt32Array() : ptr_(nullptr), size_(0) {}
  PocInt32Array(int32_t* p, int n) : ptr_(p), size_(n) {}
  ~PocInt32Array() { std::free(ptr_); }
  PocInt32Array(const PocInt32Array& other) : ptr_(other.ptr_), size_(other.size_) {
    auto& m = const_cast<PocInt32Array&>(other);
    m.ptr_ = nullptr;
    m.size_ = 0;
  }
  int getPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(ptr_)); }
  int getSize() const { return size_; }
private:
  int32_t* ptr_;
  int size_;
};

// Pattern 4 envelope: rows + cols + flat XYZ buffer.
class PocSurfacePoles {
public:
  PocSurfacePoles() : rows_(0), cols_(0), xyz_(nullptr), size_(0) {}
  PocSurfacePoles(int rows, int cols, double* p, int n)
    : rows_(rows), cols_(cols), xyz_(p), size_(n) {}
  ~PocSurfacePoles() { std::free(xyz_); }
  PocSurfacePoles(const PocSurfacePoles& other)
    : rows_(other.rows_), cols_(other.cols_), xyz_(other.xyz_), size_(other.size_) {
    auto& m = const_cast<PocSurfacePoles&>(other);
    m.xyz_ = nullptr;
    m.size_ = 0;
  }
  int getRows() const { return rows_; }
  int getCols() const { return cols_; }
  int getXyzPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(xyz_)); }
  int getXyzSize() const { return size_; }
private:
  int rows_, cols_;
  double* xyz_;
  int size_;
};

// Pattern 3 mesh data — verbatim from replicad's ReplicadMeshData.
class PocMeshData {
public:
  PocMeshData()
    : verticesPtr_(nullptr), normalsPtr_(nullptr),
      trianglesPtr_(nullptr), faceGroupsPtr_(nullptr),
      verticesSize_(0), normalsSize_(0),
      trianglesSize_(0), faceGroupsSize_(0) {}

  ~PocMeshData() {
    std::free(verticesPtr_);
    std::free(normalsPtr_);
    std::free(trianglesPtr_);
    std::free(faceGroupsPtr_);
  }

  PocMeshData(const PocMeshData& other)
    : verticesPtr_(other.verticesPtr_), normalsPtr_(other.normalsPtr_),
      trianglesPtr_(other.trianglesPtr_), faceGroupsPtr_(other.faceGroupsPtr_),
      verticesSize_(other.verticesSize_), normalsSize_(other.normalsSize_),
      trianglesSize_(other.trianglesSize_), faceGroupsSize_(other.faceGroupsSize_) {
    auto& m = const_cast<PocMeshData&>(other);
    m.verticesPtr_ = nullptr;
    m.normalsPtr_ = nullptr;
    m.trianglesPtr_ = nullptr;
    m.faceGroupsPtr_ = nullptr;
  }

  int getVerticesPtr() const  { return static_cast<int>(reinterpret_cast<uintptr_t>(verticesPtr_)); }
  int getNormalsPtr() const   { return static_cast<int>(reinterpret_cast<uintptr_t>(normalsPtr_)); }
  int getTrianglesPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(trianglesPtr_)); }
  int getFaceGroupsPtr() const { return static_cast<int>(reinterpret_cast<uintptr_t>(faceGroupsPtr_)); }

  int getVerticesSize() const   { return verticesSize_; }
  int getNormalsSize() const    { return normalsSize_; }
  int getTrianglesSize() const  { return trianglesSize_; }
  int getFaceGroupsSize() const { return faceGroupsSize_; }

private:
  float*    verticesPtr_;
  float*    normalsPtr_;
  uint32_t* trianglesPtr_;
  int32_t*  faceGroupsPtr_;

  int verticesSize_;
  int normalsSize_;
  int trianglesSize_;
  int faceGroupsSize_;

  friend class ReplicadAdapters;
};

class ReplicadAdapters {
public:
  // Smoke probe (Phase 1).
  static int hello() { return 42; }

  // ── Pattern 1 — Input loops (Strategy D) ─────────────────────────
  // Builds a B-spline approximation Edge from a flat Float64Array (interleaved
  // x,y,z). One C++ call replaces N JS-side SetValue() embind hops.
  static TopoDS_Edge makeBSplineEdgeFromCoords(
    intptr_t coordsPtr, int npts,
    int degMin, int degMax, double tolerance);

  // ── Pattern 2 — naive Strategy D (regression baseline) ───────────
  // These materialize Poles/Knots/Multiplicities into JS-visible Float64/Int32
  // arrays. Designed to be slower than status quo so we can prove the
  // pass-through regression empirically.
  static PocFloat64Array bsplinePoles2dAsArray(const Geom2d_BSplineCurve& src);
  static PocFloat64Array bsplineKnots2dAsArray(const Geom2d_BSplineCurve& src);
  static PocInt32Array bsplineMults2dAsArray(const Geom2d_BSplineCurve& src);

  // Builds a Geom2d_BSplineCurve from materialized JS arrays + Segment.
  static Geom2d_BSplineCurve* makeBSpline2dFromArrays(
    intptr_t polesPtr, int polesLen,
    intptr_t knotsPtr, int knotsLen,
    intptr_t multsPtr, int multsLen,
    int degree, bool isPeriodic,
    double first, double last, double precision);

  // ── Pattern 2 — split-API Strategy D (regression mitigation) ────
  // Keeps the pass-through path zero-copy. The "acquire" methods return the
  // raw NCollection handles via opencascade::handle<>; the builder takes them
  // back without ever materializing in JS.
  // (Actual NCollection types resolved in implementation.)
  static Geom2d_BSplineCurve* splitBSpline2dViaHandles(
    const Geom2d_BSplineCurve& src,
    double first, double last, double precision);

  // ── Pattern 3 — Strategy F mesh extractor (port of replicad) ────
  static PocMeshData extractMesh(
    const TopoDS_Shape& shape,
    double tolerance, double angularTolerance, bool skipNormals);

  // ── Pattern 4 — Surface poles (Strategy D + flush back) ─────────
  static PocSurfacePoles bsplineSurfacePolesAsArray(const Geom_BSplineSurface& src);
  static void bsplineSurfaceSetPolesFromArray(
    Geom_BSplineSurface& dst, int rows, int cols,
    intptr_t xyzPtr, int xyzLen);
};

// ── Implementation pulled in from the OCJS preamble ────────────────────
// (The OCJS bindgen prefixes additionalCppCode with `ocAllIncludeStatements`
// so every OCCT header is already available here.)

#include <gp_Pnt.hxx>
#include <gp_XYZ.hxx>
#include <NCollection_Array1.hxx>
#include <NCollection_Array2.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TColgp_Array1OfPnt2d.hxx>
#include <TColgp_Array2OfPnt.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom2d_BSplineCurve.hxx>
#include <GeomAPI_PointsToBSpline.hxx>
#include <GeomAbs_Shape.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopLoc_Location.hxx>
#include <BRep_Tool.hxx>
#include <BRepTools.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <Poly_Triangulation.hxx>
#include <Poly_Triangle.hxx>
#include <gp_Trsf.hxx>

inline TopoDS_Edge ReplicadAdapters::makeBSplineEdgeFromCoords(
  intptr_t coordsPtr, int npts,
  int degMin, int degMax, double tolerance)
{
  const double* coords = reinterpret_cast<const double*>(coordsPtr);
  TColgp_Array1OfPnt pnts(1, npts);
  for (int i = 0; i < npts; ++i) {
    pnts.SetValue(i + 1, gp_Pnt(coords[3 * i + 0], coords[3 * i + 1], coords[3 * i + 2]));
  }
  GeomAPI_PointsToBSpline builder(pnts, degMin, degMax, GeomAbs_C2, tolerance);
  if (!builder.IsDone()) {
    return TopoDS_Edge{};
  }
  Handle(Geom_BSplineCurve) curve = builder.Curve();
  BRepBuilderAPI_MakeEdge maker(curve);
  return maker.Edge();
}

inline PocFloat64Array ReplicadAdapters::bsplinePoles2dAsArray(const Geom2d_BSplineCurve& src) {
  int n = src.NbPoles();
  double* buf = static_cast<double*>(std::malloc(sizeof(double) * n * 2));
  for (int i = 1; i <= n; ++i) {
    gp_Pnt2d p = src.Pole(i);
    buf[(i - 1) * 2 + 0] = p.X();
    buf[(i - 1) * 2 + 1] = p.Y();
  }
  return PocFloat64Array(buf, n * 2);
}

inline PocFloat64Array ReplicadAdapters::bsplineKnots2dAsArray(const Geom2d_BSplineCurve& src) {
  int n = src.NbKnots();
  double* buf = static_cast<double*>(std::malloc(sizeof(double) * n));
  for (int i = 1; i <= n; ++i) buf[i - 1] = src.Knot(i);
  return PocFloat64Array(buf, n);
}

inline PocInt32Array ReplicadAdapters::bsplineMults2dAsArray(const Geom2d_BSplineCurve& src) {
  int n = src.NbKnots();
  int32_t* buf = static_cast<int32_t*>(std::malloc(sizeof(int32_t) * n));
  for (int i = 1; i <= n; ++i) buf[i - 1] = src.Multiplicity(i);
  return PocInt32Array(buf, n);
}

inline Geom2d_BSplineCurve* ReplicadAdapters::makeBSpline2dFromArrays(
  intptr_t polesPtr, int polesLen,
  intptr_t knotsPtr, int knotsLen,
  intptr_t multsPtr, int multsLen,
  int degree, bool isPeriodic,
  double first, double last, double precision)
{
  const double* polesData = reinterpret_cast<const double*>(polesPtr);
  const double* knotsData = reinterpret_cast<const double*>(knotsPtr);
  const int32_t* multsData = reinterpret_cast<const int32_t*>(multsPtr);

  int npoles = polesLen / 2;
  TColgp_Array1OfPnt2d poles(1, npoles);
  for (int i = 0; i < npoles; ++i) {
    poles.SetValue(i + 1, gp_Pnt2d(polesData[i * 2 + 0], polesData[i * 2 + 1]));
  }
  TColStd_Array1OfReal knots(1, knotsLen);
  for (int i = 0; i < knotsLen; ++i) knots.SetValue(i + 1, knotsData[i]);
  TColStd_Array1OfInteger mults(1, multsLen);
  for (int i = 0; i < multsLen; ++i) mults.SetValue(i + 1, multsData[i]);

  auto* curve = new Geom2d_BSplineCurve(poles, knots, mults, degree, isPeriodic);
  curve->Segment(first, last, precision);
  return curve;
}

inline Geom2d_BSplineCurve* ReplicadAdapters::splitBSpline2dViaHandles(
  const Geom2d_BSplineCurve& src,
  double first, double last, double precision)
{
  // Split-API Strategy D in its purest form: do everything in C++ in one shot.
  // No NCollection materialization to JS at all. This is the upper-bound
  // mitigation — equivalent to the status-quo path with zero JS round trips
  // for the Poles/Knots/Multiplicities pass-through.
  const TColgp_Array1OfPnt2d& poles = src.Poles();
  const TColStd_Array1OfReal& knots = src.Knots();
  const TColStd_Array1OfInteger& mults = src.Multiplicities();
  auto* curve = new Geom2d_BSplineCurve(poles, knots, mults, src.Degree(), src.IsPeriodic());
  curve->Segment(first, last, precision);
  return curve;
}

inline PocMeshData ReplicadAdapters::extractMesh(
  const TopoDS_Shape& shape,
  double tolerance, double angularTolerance, bool skipNormals)
{
  BRepTools::Clean(shape, Standard_False);
  BRepMesh_IncrementalMesh mesher(shape, tolerance, Standard_False, angularTolerance, Standard_False);

  int totalNodes = 0;
  int totalTriangles = 0;
  int totalFaces = 0;
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(TopoDS::Face(ex.Current()), loc);
    if (tri.IsNull()) continue;
    totalNodes += tri->NbNodes();
    totalTriangles += tri->NbTriangles();
    totalFaces++;
  }

  PocMeshData result;
  result.verticesSize_ = totalNodes * 3;
  result.verticesPtr_ = static_cast<float*>(std::malloc(result.verticesSize_ * sizeof(float)));
  if (!skipNormals) {
    result.normalsSize_ = totalNodes * 3;
    result.normalsPtr_ = static_cast<float*>(std::malloc(result.normalsSize_ * sizeof(float)));
    if (result.normalsPtr_) std::memset(result.normalsPtr_, 0, result.normalsSize_ * sizeof(float));
  }
  result.trianglesSize_ = totalTriangles * 3;
  result.trianglesPtr_ = static_cast<uint32_t*>(std::malloc(result.trianglesSize_ * sizeof(uint32_t)));
  result.faceGroupsSize_ = totalFaces * 3;
  result.faceGroupsPtr_ = static_cast<int32_t*>(std::malloc(result.faceGroupsSize_ * sizeof(int32_t)));

  int vertexOffset = 0;
  int triOffset = 0;
  int faceGroupIdx = 0;
  for (TopExp_Explorer ex(shape, TopAbs_FACE); ex.More(); ex.Next()) {
    const TopoDS_Face& face = TopoDS::Face(ex.Current());
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
    if (tri.IsNull()) continue;
    const gp_Trsf& trsf = loc.Transformation();
    int nbNodes = tri->NbNodes();
    int nbTri = tri->NbTriangles();
    for (int i = 1; i <= nbNodes; ++i) {
      gp_Pnt p = tri->Node(i).Transformed(trsf);
      int base = (vertexOffset + i - 1) * 3;
      result.verticesPtr_[base + 0] = static_cast<float>(p.X());
      result.verticesPtr_[base + 1] = static_cast<float>(p.Y());
      result.verticesPtr_[base + 2] = static_cast<float>(p.Z());
    }
    bool isReversed = (face.Orientation() == TopAbs_REVERSED);
    for (int i = 1; i <= nbTri; ++i) {
      const Poly_Triangle& t = tri->Triangle(i);
      int n1, n2, n3;
      t.Get(n1, n2, n3);
      uint32_t a = vertexOffset + n1 - 1;
      uint32_t b = vertexOffset + n2 - 1;
      uint32_t c = vertexOffset + n3 - 1;
      int base = (triOffset + i - 1) * 3;
      if (isReversed) {
        result.trianglesPtr_[base + 0] = a;
        result.trianglesPtr_[base + 1] = c;
        result.trianglesPtr_[base + 2] = b;
      } else {
        result.trianglesPtr_[base + 0] = a;
        result.trianglesPtr_[base + 1] = b;
        result.trianglesPtr_[base + 2] = c;
      }
    }
    int gbase = faceGroupIdx * 3;
    result.faceGroupsPtr_[gbase + 0] = triOffset * 3;
    result.faceGroupsPtr_[gbase + 1] = nbTri * 3;
    result.faceGroupsPtr_[gbase + 2] = faceGroupIdx;
    vertexOffset += nbNodes;
    triOffset += nbTri;
    faceGroupIdx++;
  }
  return result;
}

inline PocSurfacePoles ReplicadAdapters::bsplineSurfacePolesAsArray(const Geom_BSplineSurface& src) {
  int rows = src.NbUPoles();
  int cols = src.NbVPoles();
  int total = rows * cols * 3;
  double* buf = static_cast<double*>(std::malloc(sizeof(double) * total));
  for (int r = 0; r < rows; ++r) {
    for (int c = 0; c < cols; ++c) {
      gp_Pnt p = src.Pole(r + 1, c + 1);
      int o = (r * cols + c) * 3;
      buf[o + 0] = p.X();
      buf[o + 1] = p.Y();
      buf[o + 2] = p.Z();
    }
  }
  return PocSurfacePoles(rows, cols, buf, total);
}

inline void ReplicadAdapters::bsplineSurfaceSetPolesFromArray(
  Geom_BSplineSurface& dst, int rows, int cols,
  intptr_t xyzPtr, int xyzLen)
{
  const double* xyz = reinterpret_cast<const double*>(xyzPtr);
  for (int r = 0; r < rows; ++r) {
    for (int c = 0; c < cols; ++c) {
      int o = (r * cols + c) * 3;
      gp_Pnt p(xyz[o + 0], xyz[o + 1], xyz[o + 2]);
      dst.SetPole(r + 1, c + 1, p);
    }
  }
}
