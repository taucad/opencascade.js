# Build Configuration Reference

YAML build configs define what gets included in your opencascade.js WASM binary: which OCCT classes are exposed to JavaScript, what C++ wrapper code to inject, and what Emscripten linker flags to use.

## File Location

Consumer YAML configs (which symbols to bind, which `emccFlags` to pass at link) live in `build-configs/`. Compile-time configurations (which optimization flags drive `emcc`/`wasm-opt`) live in [`configurations.json`](../../build-configs/configurations.json) — see [BUILD_SYSTEM.md](../../BUILD_SYSTEM.md) for the full key reference.

```
build-configs/
  full.yml             # All symbols, native WASM exceptions with getExceptionMessage helpers
  configurations.json  # Named compile-time configurations (single-threaded, single-threaded-smallest, multi-threaded, debug)
```

## YAML Schema

```yaml
mainBuild:
  name: <string>              # Output filename (without extension)
  bindings:                    # List of OCCT classes to bind
    - symbol: <ClassName>
  emccFlags:                   # Emscripten linker flags
    - <flag>
  additionalBindCode: |        # Extra embind registration C++ code (optional)
    EMSCRIPTEN_BINDINGS(custom) { ... }
  allowedUndefinedSymbols:     # Symbols to leave unresolved at link time (optional)
    - <symbol>

extraBuilds:                   # Additional build variants (optional, same schema as mainBuild)
  - name: <string>
    bindings: [...]
    emccFlags: [...]
    additionalBindCode: |
      ...
    allowedUndefinedSymbols: [...]

additionalCppCode: |           # Inline C++ compiled into the bindings TU (typedefs, wrappers)
  typedef opencascade::handle<Geom_Curve> Handle_Geom_Curve;
  class MyWrapper { ... };

additionalCppFiles:            # Multi-file C++ sources concatenated into bindings (optional)
  - path/to/extra.cpp

generateTypescriptDefinitions: true  # Generate .d.ts file (default: true)
```

Every key is described below; the canonical Cerberus definition lives in [`src/customBuildSchema.py`](../../src/customBuildSchema.py).

## Bindings

The `bindings` list is an allowlist of OCCT classes exposed to JavaScript via Embind. Only classes listed here (and their transitive base classes) are accessible at runtime.

### Adding a Symbol

```yaml
bindings:
  - symbol: BRepPrimAPI_MakeBox
```

The symbol name must match exactly the C++ class name as it appears in the generated binding `.cpp` files under `build/bindings/`.

### Symbol Categories

| Category                   | Example                    | Notes |
|----------------------------|----------------------------|-------|
| OCCT classes               | `gp_Pnt`, `TopoDS_Shape`  | Core geometry and topology |
| Algorithm classes          | `BRepAlgoAPI_Cut`          | Boolean operations, fillets, etc. |
| Data exchange              | `STEPControl_Reader`       | STEP/STL/IGES import/export |
| Handle types               | `Handle_Geom_Curve`        | Must be typedef'd in `additionalCppCode` |
| Custom wrappers            | `TopoDS_Cast`, `OCJS_ShapeHasher` | V8 compatibility wrappers |
| Enum types                 | `TopAbs_ShapeEnum`         | C++ enums |

### Base Class Requirements

Embind requires all base classes in the inheritance chain to be bound. If you bind `BRepBuilderAPI_MakeEdge`, you also need:
- `BRepBuilderAPI_MakeShape`
- `BRepBuilderAPI_Command`

Check the OCCT documentation or the generated `.d.ts` for the class hierarchy.

## Handle Types

OCCT uses `opencascade::handle<T>` (reference-counted smart pointers) extensively. To bind a handle type:

1. Add the typedef in `additionalCppCode`:

```yaml
additionalCppCode: |
  typedef opencascade::handle<Geom_Curve> Handle_Geom_Curve;
```

2. Add the handle symbol to bindings:

```yaml
bindings:
  - symbol: Handle_Geom_Curve
```

Both steps are required. Common handle types needed:

```yaml
additionalCppCode: |
  typedef opencascade::handle<Geom_Curve> Handle_Geom_Curve;
  typedef opencascade::handle<Geom_Surface> Handle_Geom_Surface;
  typedef opencascade::handle<Geom_BSplineCurve> Handle_Geom_BSplineCurve;
  typedef opencascade::handle<Geom2d_Curve> Handle_Geom2d_Curve;
  typedef opencascade::handle<Poly_Triangulation> Handle_Poly_Triangulation;
  typedef opencascade::handle<TDocStd_Document> Handle_TDocStd_Document;
  typedef opencascade::handle<XSControl_WorkSession> Handle_XSControl_WorkSession;
```

## emccFlags

Emscripten linker flags control the final WASM binary. Common flags:

### Module Format

```yaml
- -sEXPORT_ES6=1              # ESM module output
- -sEXPORTED_RUNTIME_METHODS=["FS"]  # Expose Emscripten filesystem API
- --no-entry                   # No main() function
```

### Memory

```yaml
- -sINITIAL_MEMORY=100MB      # Starting heap size
- -sMAXIMUM_MEMORY=4GB        # Max heap (with growth enabled)
- -sALLOW_MEMORY_GROWTH=1     # Enable dynamic heap growth
```

### Optimization

```yaml
- -O3                          # Link-time optimization level
- -flto                        # Enable LTO for dead-code elimination
```

### Exception Handling

For builds **without** exceptions:
```yaml
- -sDISABLE_EXCEPTION_CATCHING=1
```

For builds **with** native WASM exceptions:
```yaml
- -fwasm-exceptions
- -sEXPORT_EXCEPTION_HANDLING_HELPERS
```

### Dependencies

```yaml
- -sUSE_FREETYPE=1             # Link FreeType (for font rendering in OCCT)
- -sERROR_ON_UNDEFINED_SYMBOLS=0  # Allow undefined symbols (some OCCT deps optional)
```

## additionalCppCode

Custom C++ code compiled as part of the bindings. Used for:

1. **Handle typedefs** (see above)
2. **V8 compatibility wrappers** (`TopoDS_Cast`, `OCJS_ShapeHasher`, `BRepMesh_IncrementalMeshWrapper`)
3. **Serialization helpers** (`BRepToolsWrapper`, `GeomToolsWrapper`)
4. **Exception decoding** (`OCJS` class with `getStandard_FailureData`)

The code is injected into a generated `.cpp` file and compiled with the same flags as bindings.

## additionalCppFiles

Top-level list of additional C++ source files concatenated onto `additionalCppCode` before custom-binding generation runs. Use this when the wrapper code grows too large for an inline YAML scalar (a single embedded class definition with members, friend declarations, and inline implementations easily passes 200 lines) or when you want syntax highlighting / editor support in real `.cpp` files.

### Schema

```yaml
additionalCppFiles:
  - <path>
```

- `<path>` is resolved relative to the YAML file's directory. Absolute paths are also accepted.
- The file contents are appended to `additionalCppCode` in the order listed.
- `additionalCppCode` (inline) wins on conflict because it precedes the file contents in the concatenated TU.
- A missing file fails-loud with `FileNotFoundError: additionalCppFiles: file not found: <resolved> (from '<as-written>')`.

### Example

```yaml
additionalCppCode: |
  typedef opencascade::handle<Geom_BSplineSurface> Handle_Geom_BSplineSurface;

additionalCppFiles:
  - wrappers/fair-curve.cpp
  - wrappers/shape-cast.cpp
```

This produces a single TU equivalent to:

```cpp
typedef opencascade::handle<Geom_BSplineSurface> Handle_Geom_BSplineSurface;
// contents of wrappers/fair-curve.cpp
// contents of wrappers/shape-cast.cpp
```

The discovery pass runs against the concatenated source, so NCollection / Handle types referenced from the wrapper files are picked up the same way they are from inline `additionalCppCode`.

## mainBuild.additionalBindCode

Embedded-as-string C++ block appended to the per-build embind registration TU **after** the autogenerated `EMSCRIPTEN_BINDINGS(...)` blocks. Use this when you need raw embind registrations that the codegen cannot emit on your behalf — typically:

- A free function bound with `function(...)`
- A `value_object<T>(...).field(...)...` block for a POD struct that you authored in `additionalCppCode` (or `additionalCppFiles`)
- A `register_vector<T>("VectorT")` / `register_map<K, V>("MapKV")` for a JS-side container that is not covered by NCollection auto-discovery

### Schema

```yaml
mainBuild:
  # ...
  additionalBindCode: |
    EMSCRIPTEN_BINDINGS(custom_extras) {
      emscripten::function("addInts", &addInts);
    }
```

- Lives **inside** the `mainBuild` (or `extraBuilds[*]`) block — it is per-build, not global.
- The block is written into `<libraryBasePath>/additionalBindCode/<build.name>.cpp`, compiled with the same `emccFlags` as the binding objects, and linked into the WASM module.
- The TU sees the same preamble as every binding TU (`<emscripten/bind.h>`, the `::ocjs::` RBV helpers, the `OCJS_RBV_PREAMBLE` forward declarations), so `EMSCRIPTEN_BINDINGS` macros and `emscripten::val` are in scope.
- Each `EMSCRIPTEN_BINDINGS(<name>)` group **must use a unique name** across this block and any builtin / auto-generated binding TUs; embind enforces uniqueness at module load time.

### Example: bind a free function

```yaml
additionalCppCode: |
  #include <Standard_Real.hxx>

  Standard_Real addReals(Standard_Real a, Standard_Real b) { return a + b; }

mainBuild:
  name: my_build
  additionalBindCode: |
    EMSCRIPTEN_BINDINGS(my_build_extras) {
      emscripten::function("addReals", &addReals);
    }
```

After build, `oc.addReals(1.5, 2.25)` returns `3.75` in JS.

### Example: bind a `value_object` POD

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

## mainBuild.allowedUndefinedSymbols

Per-build allowlist of symbols that the WASM linker is permitted to leave unresolved. The default `emccFlags` set `-sERROR_ON_UNDEFINED_SYMBOLS=1`, which fails-loud on any unresolved reference. `allowedUndefinedSymbols` carves out a per-build exception list that is appended to the link command as `-sERROR_ON_UNDEFINED_SYMBOLS=0`-equivalent suppressions for the listed names only — every other symbol still triggers a link error.

### Schema

```yaml
mainBuild:
  # ...
  allowedUndefinedSymbols:
    - <mangled_symbol_name>
```

- Lives **inside** the `mainBuild` (or `extraBuilds[*]`) block.
- Names use the C++ mangled form as emitted by `emcc`. Find them in the link error output (the diagnostic prints each unresolved symbol on its own line).
- Each entry is appended once to the link command (deduped); ordering is preserved.

### When to use it

Most OCCT subsystems are self-contained. Reach for `allowedUndefinedSymbols` only when:

1. A consumer YAML binds a class that transitively references a thread-local / weak-symbol helper not present in your build (e.g. an OCCT debug-trace symbol that is stripped in `OCCT_NO_DUMP` builds).
2. You are linking a custom C++ module that calls into a runtime helper resolved by JS-side glue rather than by the WASM linker.

Prefer fixing the missing-symbol root cause (binding the upstream class, adding the missing `.cpp` to `additionalCppFiles`, or removing the dead reference) before reaching for this allowlist; every entry is a latent runtime trap if the symbol is actually invoked.

### Example

```yaml
mainBuild:
  name: my_build
  emccFlags:
    - -sERROR_ON_UNDEFINED_SYMBOLS=1
  allowedUndefinedSymbols:
    - _ZN15Standard_Atomic5IncrEv
```

## Creating a Custom Config

To create a minimal config with only the symbols you need:

1. Start from `full.yml` as a reference
2. Remove symbols you don't use from `bindings`
3. (Most cases) handle typedefs for NCollection and `Handle<T>` types are auto-discovered in v3, so manual `additionalCppCode` edits are usually unnecessary. Edit only when you hit a missing-handle linker error.
4. Keep base class symbols (check class hierarchy)
5. Validate: `./build-wasm.sh validate build-configs/my-config.yml`
6. Build: `./build-wasm.sh link build-configs/my-config.yml`

### Example: Minimal Boolean Operations

```yaml
mainBuild:
  name: my_custom_build
  bindings:
    - symbol: gp_Pnt
    - symbol: gp_Dir
    - symbol: gp_Ax2
    - symbol: TopoDS_Shape
    - symbol: TopoDS_Solid
    - symbol: BRepPrimAPI_MakeBox
    - symbol: BRepPrimAPI_MakeCylinder
    - symbol: BRepPrimAPI_MakeOneAxis
    - symbol: BRepAlgoAPI_Cut
    - symbol: BRepAlgoAPI_Fuse
    - symbol: BRepAlgoAPI_Common
    - symbol: BRepAlgoAPI_BooleanOperation
    - symbol: BRepAlgoAPI_BuilderAlgo
    - symbol: BRepAlgoAPI_Algo
    - symbol: BOPAlgo_Options
    - symbol: BRepBuilderAPI_MakeShape
    - symbol: BRepBuilderAPI_Command
    - symbol: TopAbs_ShapeEnum
  emccFlags:
    - -flto
    - -sEXPORT_ES6=1
    - -sALLOW_MEMORY_GROWTH=1
    - -sEXPORTED_RUNTIME_METHODS=["FS"]
    - -sINITIAL_MEMORY=100MB
    - -sMAXIMUM_MEMORY=4GB
    - -sUSE_FREETYPE=1
    - -sERROR_ON_UNDEFINED_SYMBOLS=0
    - --no-entry
    - -O3
    - -sDISABLE_EXCEPTION_CATCHING=1
additionalCppCode: ""
```

## Configurations

Compile-time configurations control optimization, exception mode, SIMD, BigInt, and other compiler/linker behavior — independently of which symbols the YAML config binds. They live in [`configurations.json`](../../build-configs/configurations.json) and are selected with `--config`:

```bash
./build-wasm.sh --config single-threaded full build-configs/full.yml
```

The currently shipped configurations are `single-threaded`, `single-threaded-smallest`, `multi-threaded`, and `debug`. All four ship with native WASM exceptions, `EVAL_CTORS=2`, and Closure on; they differ on opt level, threading, and wasm-opt budget. Add a new entry to `configurations.json` to define your own. See [BUILD_SYSTEM.md](../../BUILD_SYSTEM.md) for the full key reference.
