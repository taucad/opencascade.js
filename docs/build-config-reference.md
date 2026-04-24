# Build Configuration Reference

YAML build configs define what gets included in your opencascade.js WASM binary: which OCCT classes are exposed to JavaScript, what C++ wrapper code to inject, and what Emscripten linker flags to use.

## File Location

Consumer YAML configs (which symbols to bind, which `emccFlags` to pass at link) live in `build-configs/`. Compile-time configurations (which optimization flags drive `emcc`/`wasm-opt`) live in [`configurations.json`](../build-configs/configurations.json) — see [BUILD_SYSTEM.md](../BUILD_SYSTEM.md) for the full key reference.

```
build-configs/
  full.yml             # All symbols, native WASM exceptions with getExceptionMessage helpers
  configurations.json  # Named compile-time configurations (default, O0-debug, O3-wasm-exc-simd, ...)
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

extraBuilds:                   # Additional build variants (optional, same schema as mainBuild)
  - name: <string>
    bindings: [...]
    emccFlags: [...]

additionalCppCode: |           # C++ code compiled into bindings (typedefs, wrappers)
  typedef opencascade::handle<Geom_Curve> Handle_Geom_Curve;
  class MyWrapper { ... };

generateTypescriptDefinitions: true  # Generate .d.ts file (default: true)
```

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

Compile-time configurations control optimization, exception mode, SIMD, BigInt, and other compiler/linker behavior — independently of which symbols the YAML config binds. They live in [`configurations.json`](../build-configs/configurations.json) and are selected with `--config`:

```bash
./build-wasm.sh --config default full build-configs/full.yml
```

The currently shipped configurations are `default`, `O0-debug`, `O3-wasm-exc-simd`, `O3-noLTO-simd`, and `Os-noLTO-simd`. Add a new entry to `configurations.json` to define your own. See [BUILD_SYSTEM.md](../BUILD_SYSTEM.md) for the full key reference.
