# OCCT V8 + Emscripten 5 Migration Guide

This document covers the migration of opencascade.js from OCCT V7.6.2 + Emscripten 3.x to OCCT V8.0.0-RC4 + Emscripten 5.0.1.

## Overview

| Component     | Before                              | After                          |
|---------------|-------------------------------------|--------------------------------|
| OCCT          | 7.6.2                               | 8.0.0-RC4                      |
| Emscripten    | 3.1.14                              | 5.0.1 (LLVM 17)               |
| Exceptions    | JS invoke trampolines (`-fexceptions`) | Native WASM EH (`-fwasm-exceptions`) |
| LTO           | Enabled (`-flto`)                   | Disabled at compile time       |
| Optimization  | `-O3` (link only)                   | Configurable per-stage         |

## Exception Handling Migration

### Before: JavaScript Invoke Trampolines

In V7.6.2 with Emscripten 3.x, C++ exceptions were handled by wrapping every function call that might throw in a JavaScript "invoke" trampoline:

```
C++ throw → Emscripten runtime intercepts → JavaScript invoke_* wrapper → setjmp/longjmp or try/catch in JS
```

This added ~80-90% binary size overhead because every potentially-throwing call site required both the native code and a JS-side wrapper function.

### After: Native WASM Exception Handling

Emscripten 5.x supports the WebAssembly Exception Handling proposal (Phase 4), which moves try/catch/throw into the WASM instruction set:

```
C++ throw → WASM throw instruction → WASM catch instruction → C++ catch handler
```

The binary size overhead drops to ~12-15% (gzipped) because no JS trampolines are generated. The happy path (no exceptions thrown) has zero overhead.

**Browser support**: 94.5%+ (Chrome 95+, Firefox 100+, Safari 15.2+)

### Migration Steps

1. Replace `-fexceptions` with `-fwasm-exceptions` in `emccFlags`
2. Remove `-sDISABLE_EXCEPTION_CATCHING=0` (no longer needed)
3. Add `-sEXPORT_EXCEPTION_HANDLING_HELPERS` if you decode exceptions in JS
4. Set `OCJS_EXCEPTIONS=1` when compiling with `build-wasm.sh`

## OCCT V8 API Breaking Changes

These 10 systemic changes affect all opencascade.js consumers upgrading from V7.6.2:

### 1. `TopoDS_Shape::HashCode` Removed

OCCT V8 removes the member function `TopoDS_Shape::HashCode(upperBound)` in favor of `std::hash<TopoDS_Shape>`.

**Workaround**: Use the `OCJS_ShapeHasher` wrapper class:

```cpp
class OCJS_ShapeHasher {
public:
  static int HashCode(const TopoDS_Shape& shape, int upperBound) {
    if (upperBound <= 0) return 0;
    size_t h = std::hash<TopoDS_Shape>{}(shape);
    return static_cast<int>((h % static_cast<size_t>(upperBound)) + 1);
  }
};
```

Add to your YAML bindings:
```yaml
- symbol: OCJS_ShapeHasher
```

### 2. `TopoDS` Namespace Not Directly Bindable

The `TopoDS` namespace (containing `TopoDS::Vertex()`, `TopoDS::Edge()`, etc.) cannot be bound directly via Embind because it's a namespace, not a class.

**Workaround**: Use the `TopoDS_Cast` wrapper class:

```cpp
class TopoDS_Cast {
public:
  static TopoDS_Vertex Vertex(const TopoDS_Shape& S) { return TopoDS::Vertex(S); }
  static TopoDS_Edge Edge(const TopoDS_Shape& S) { return TopoDS::Edge(S); }
  static TopoDS_Wire Wire(const TopoDS_Shape& S) { return TopoDS::Wire(S); }
  static TopoDS_Face Face(const TopoDS_Shape& S) { return TopoDS::Face(S); }
  static TopoDS_Shell Shell(const TopoDS_Shape& S) { return TopoDS::Shell(S); }
  static TopoDS_Solid Solid(const TopoDS_Shape& S) { return TopoDS::Solid(S); }
  static TopoDS_Compound Compound(const TopoDS_Shape& S) { return TopoDS::Compound(S); }
  static TopoDS_CompSolid CompSolid(const TopoDS_Shape& S) { return TopoDS::CompSolid(S); }
};
```

### 3. `BRepMesh_IncrementalMesh` Constructor Changed

The V8 constructor signature changed (parameter order/types differ). The 5-argument convenience constructor no longer exists.

**Workaround**: Use `BRepMesh_IncrementalMeshWrapper`:

```cpp
class BRepMesh_IncrementalMeshWrapper {
public:
  BRepMesh_IncrementalMeshWrapper(
    const TopoDS_Shape& theShape,
    const double theLinDeflection,
    const bool isRelative,
    const double theAngDeflection,
    const bool isInParallel);
  bool IsDone() const;
  bool IsModified() const;
  int GetStatusFlags() const;
};
```

### 4. `Handle_*` Types Need Explicit Typedef

OCCT V8 no longer auto-generates `Handle_ClassName` typedefs. Every handle type used in bindings must be explicitly typedef'd in `additionalCppCode`:

```yaml
additionalCppCode: |
  typedef opencascade::handle<Geom_Curve> Handle_Geom_Curve;
  typedef opencascade::handle<Geom_Surface> Handle_Geom_Surface;
  // ... for each Handle type in your bindings
```

### 5. `Bnd_Box::Get()` Removed

The method `Bnd_Box::Get(xmin, ymin, zmin, xmax, ymax, zmax)` was removed.

**Replacement**: Use `CornerMin()` and `CornerMax()`:

```javascript
// Before (V7.6.2)
box.Get(xmin, ymin, zmin, xmax, ymax, zmax);

// After (V8)
const min = box.CornerMin();
const max = box.CornerMax();
```

### 6. `Poly_Triangulation` Normals API Changed

Normal access on `Poly_Triangulation` changed from `HasNormals()` + `Normal(index)` returning by reference to a different access pattern.

**V8 approach**: Use the `InternalNormals()` or per-node normal accessors.

### 7. `Poly_PolygonOnTriangulation::Nodes()` Removed

The method `Nodes()` returning a `TColStd_Array1OfInteger` was removed.

**Replacement**: Use `NbNodes()` and `Node(i)` to iterate:

```javascript
// Before (V7.6.2)
const nodes = polygon.Nodes();

// After (V8)
for (let i = 1; i <= polygon.NbNodes(); i++) {
  const nodeIndex = polygon.Node(i);
}
```

### 8. Constructor Renumbering

Emscripten's binding generator appends `_N` suffixes to overloaded constructors. OCCT V8 added/removed/reordered constructors in many classes, changing the suffix numbers.

**Common examples**:

| Class     | V7.6.2       | V8          |
|-----------|-------------|-------------|
| `gp_Ax2`  | `gp_Ax2_3`  | `gp_Ax2_4` |
| `gp_Dir`  | `gp_Dir_3`  | `gp_Dir_4` |
| `gp_Pnt`  | `gp_Pnt_3`  | `gp_Pnt_4` |

**How to find the right constructor**: Check the generated `.d.ts` file for the correct overload number.

### 9. Method Renaming (Overload Suffixes)

Similar to constructors, some methods had their overload suffixes change:

```javascript
// Example
// V7.6.2: obj.SetValue(...)
// V8:     obj.SetValue_1(...)
```

Check the `.d.ts` file for the correct suffix.

### 10. `Bnd_Box2d::Get()` Removed

Same as `Bnd_Box::Get()` — the 2D variant was also removed.

**Replacement**: Use individual corner accessors or `CornerMin()`/`CornerMax()` equivalents.

## Emscripten Flag Changes

### Removed Flags

- `-sUSE_ES6_IMPORT_META=0` — no longer needed in Emscripten 5.x
- `-sDISABLE_EXCEPTION_CATCHING=0` — replaced by `-fwasm-exceptions`

### New/Changed Flags

- `-fwasm-exceptions` — native WASM exception handling
- `-sEXPORT_EXCEPTION_HANDLING_HELPERS` — expose exception decode helpers to JS
- `-sERROR_ON_UNDEFINED_SYMBOLS=0` — replaces `-sLLD_REPORT_UNDEFINED`

### Memory Flags

Memory settings remain the same but are now more consistently enforced:

```yaml
- -sINITIAL_MEMORY=100MB
- -sMAXIMUM_MEMORY=4GB
- -sALLOW_MEMORY_GROWTH=1
```

## Performance

Benchmarks comparing V7.6.2 to V8 (single-threaded, noLTO, `-O3` link):

| Category        | Avg Improvement |
|-----------------|-----------------|
| Primitives      | -3% to +2%      |
| Booleans        | 22-31% faster   |
| Fillets         | 16-19% faster   |
| Sketches        | 9-13% faster    |
| Complex models  | 23-29% faster   |

V8's boolean operations (`BOPAlgo`) show the largest improvement at 22-31% faster.

## Size Comparison (Gzipped)

| Build                    | V7.6.2    | V8        | Change  |
|--------------------------|-----------|-----------|---------|
| Single (no exceptions)   | 6.05 MB   | 5.65 MB   | -6.6%   |
| With exceptions          | 10.42 MB  | 6.35 MB   | -39.1%  |
| Exception overhead       | +72.2%    | +12.4%    |         |
