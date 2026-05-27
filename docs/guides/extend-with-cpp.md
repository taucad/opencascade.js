# Extending the bindings with custom C++

OCCT exposes hundreds of free functions, POD structs, and helper utilities that the bindgen does not (and cannot) reach automatically. When you need one of them, or when you want to expose a wrapper class around an OCCT API for ergonomic reasons, the YAML config gives you three mechanisms:

1. **`additionalCppCode`** — inline C++ embedded directly in the YAML scalar
2. **`additionalCppFiles`** — one or more `.cpp` files concatenated onto `additionalCppCode`
3. **`mainBuild.additionalBindCode`** — per-build raw `EMSCRIPTEN_BINDINGS(...)` registrations

This guide is a decision tree across the three, followed by a full worked example of each.

## Decision tree

```
Are you adding new C++ implementation code (a wrapper class, free function, POD)?
├── YES → Will the implementation grow beyond ~100 lines or want syntax highlighting?
│        ├── YES → additionalCppFiles
│        └── NO  → additionalCppCode (inline)
└── NO  → You are only adding raw embind registrations on existing symbols
         → mainBuild.additionalBindCode
```

The three mechanisms compose. A typical custom binding ships a `.cpp` file (`additionalCppFiles`) plus an `EMSCRIPTEN_BINDINGS(...)` block (`additionalBindCode`) that registers what the `.cpp` defined.

## Mechanism 1: `additionalCppCode` (inline)

Use this for short snippets that belong with the YAML for context — handle typedefs, a single free function, a small POD.

```yaml
additionalCppCode: |
  #include <Standard_Real.hxx>

  Standard_Real addReals(Standard_Real a, Standard_Real b) {
    return a + b;
  }

mainBuild:
  name: my_build
  bindings:
    # ... your bindings ...
  additionalBindCode: |
    EMSCRIPTEN_BINDINGS(my_build_extras) {
      emscripten::function("addReals", &addReals);
    }
```

Now `oc.addReals(1.5, 2.25)` returns `3.75` in JS.

`additionalCppCode` is the shipped mechanism for the V8-compatibility wrappers in `full.yml` (`TopoDS_Cast`, `OCJS_ShapeHasher`, `BRepMesh_IncrementalMeshWrapper`, the `OCJS` exception-decoder class).

## Mechanism 2: `additionalCppFiles` (multi-file)

When the wrapper grows past ~100 lines, or when you want the source in real `.cpp` files (editor support, easier review, the ability to share helper code across multiple YAML configs), move it to `additionalCppFiles`.

`wrappers/fair-curve.cpp`:

```cpp
#include <FairCurve_MinimalVariation.hxx>
#include <Geom_BSplineCurve.hxx>
#include <gp_Pnt2d.hxx>

opencascade::handle<Geom_BSplineCurve> computeFairCurve(
  const gp_Pnt2d& p1,
  const gp_Pnt2d& p2,
  Standard_Real heightOfBatten,
  Standard_Real slopeOfBatten)
{
  FairCurve_MinimalVariation builder(p1, p2, heightOfBatten, slopeOfBatten);
  builder.Compute();
  return builder.Curve();
}
```

`my-config.yml`:

```yaml
additionalCppCode: |
  typedef opencascade::handle<Geom_BSplineCurve> Handle_Geom_BSplineCurve;

additionalCppFiles:
  - wrappers/fair-curve.cpp

mainBuild:
  name: my_build
  bindings:
    - symbol: FairCurve_MinimalVariation
    - symbol: Geom_BSplineCurve
    - symbol: gp_Pnt2d
  additionalBindCode: |
    EMSCRIPTEN_BINDINGS(my_build_faircurve) {
      emscripten::function("computeFairCurve", &computeFairCurve);
    }
```

The `additionalCppCode` block and the contents of `wrappers/fair-curve.cpp` are concatenated (in that order) into a single TU before custom-binding generation runs. NCollection / Handle types referenced from the wrapper file are picked up by the discovery pass the same way they would be from inline `additionalCppCode`.

Paths in `additionalCppFiles` are resolved relative to the YAML file's directory. A missing file fails-loud with `FileNotFoundError: additionalCppFiles: file not found: <resolved> (from '<as-written>')`.

## Mechanism 3: `mainBuild.additionalBindCode` (raw embind)

Use this when the bindgen cannot emit the registration you need. Common cases:

- Binding a free function (the bindgen registers classes, not free functions)
- Defining a `value_object<T>` POD that you authored in `additionalCppCode` / `additionalCppFiles`
- Registering an `emscripten::vector` / `emscripten::map` for a container that NCollection auto-discovery does not cover

```yaml
additionalCppCode: |
  struct PointXY { double X; double Y; };

mainBuild:
  name: my_build
  additionalBindCode: |
    EMSCRIPTEN_BINDINGS(my_build_pointxy) {
      emscripten::value_object<PointXY>("PointXY")
        .field("X", &PointXY::X)
        .field("Y", &PointXY::Y);
    }
```

The block is written into `<libraryBasePath>/additionalBindCode/<build.name>.cpp`, compiled with the same `emccFlags` as the binding objects, and linked into the WASM module. The TU sees the same preamble as every auto-generated binding TU (`<emscripten/bind.h>`, the `::ocjs::` RBV helpers), so `emscripten::val`, `EMSCRIPTEN_BINDINGS` macros, and the RBV envelope helpers are all in scope.

Every `EMSCRIPTEN_BINDINGS(<name>)` group **must use a unique name** across this block and any auto-generated binding TUs; embind enforces uniqueness at module load time.

## Worked example: a wrapper class with constructor + methods

A typical "wrap an OCCT API for ergonomics" case combines all three mechanisms.

`wrappers/shape-cast.cpp`:

```cpp
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>

class ShapeCast {
public:
  static TopoDS_Edge toEdge(const TopoDS_Shape& s) { return TopoDS::Edge(s); }
  static TopoDS_Wire toWire(const TopoDS_Shape& s) { return TopoDS::Wire(s); }
  static TopoDS_Face toFace(const TopoDS_Shape& s) { return TopoDS::Face(s); }
  static TopoDS_Vertex toVertex(const TopoDS_Shape& s) { return TopoDS::Vertex(s); }
};
```

`my-config.yml`:

```yaml
additionalCppCode: |
  typedef opencascade::handle<TopoDS_TShape> Handle_TopoDS_TShape;

additionalCppFiles:
  - wrappers/shape-cast.cpp

mainBuild:
  name: my_build
  bindings:
    - symbol: TopoDS_Shape
    - symbol: TopoDS_Edge
    - symbol: TopoDS_Wire
    - symbol: TopoDS_Face
    - symbol: TopoDS_Vertex
  additionalBindCode: |
    EMSCRIPTEN_BINDINGS(my_build_shape_cast) {
      emscripten::class_<ShapeCast>("ShapeCast")
        .class_function("toEdge", &ShapeCast::toEdge)
        .class_function("toWire", &ShapeCast::toWire)
        .class_function("toFace", &ShapeCast::toFace)
        .class_function("toVertex", &ShapeCast::toVertex);
    }
```

Usage from JS:

```ts
const edge = oc.ShapeCast.toEdge(genericShape);
```

## Pitfalls

1. **Duplicate `EMSCRIPTEN_BINDINGS` group names** crash the module at load time. Pick a unique suffix (`<your_build_name>_<feature>`) and stay disciplined.
2. **Forgetting to bind the underlying OCCT class** in `bindings:` causes the wrapper to compile but the runtime cast to throw. Always list both the wrapper and the OCCT class it depends on.
3. **Using `Handle<T>` without the typedef** in `additionalCppCode` works in C++ but produces no useful JS shape. Add `typedef opencascade::handle<T> Handle_T;` for any handle type the wrapper exposes.
4. **Pasting a fully-qualified path into `additionalCppFiles`** is supported but discouraged — relative paths from the YAML file are more portable across checkouts.

## Related references

- [YAML Schema Reference](../reference/yaml-schema.md) — schema for `additionalCppCode`, `additionalCppFiles`, `additionalBindCode`
- [`build-configs/full.yml`](../../build-configs/full.yml) — concrete examples of inline wrappers in production use (`TopoDS_Cast`, `OCJS_ShapeHasher`, `BRepMesh_IncrementalMeshWrapper`)
- [Embind reference](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html) — the upstream `<emscripten/bind.h>` surface that `additionalBindCode` exposes
