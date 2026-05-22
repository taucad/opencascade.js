# Trimming symbols: from full.yml to a consumer-sized build

`opencascade_full.wasm` (the published tarball default) binds ~4,400 OCCT classes and weighs roughly 27 MB. Most consumers need a fraction of that surface — a STEP round-tripper might touch ~120 classes; a glTF mesher even fewer. Trimming the YAML symbol list both shrinks the WASM payload and reduces consumer startup time.

This guide walks the end-to-end trim workflow with a worked example.

## Size budget

Each bound class contributes roughly 15-25 KB to the linked WASM (the variance comes from vtable size, number of overloads, and how many Doxygen JSDoc strings get emitted into the `.d.ts`). A reasonable target by use case:

| Use case                                        | Approximate symbol count | Approximate WASM size |
| ----------------------------------------------- | ------------------------ | --------------------- |
| Single-format viewer (read STEP → render mesh)  | 80-150                   | 2-4 MB                |
| Round-trip pipeline (STEP/IGES + edit + write)  | 200-400                  | 5-10 MB               |
| Full code-CAD tool (booleans + fillets + sweep) | 600-1,200                | 12-20 MB              |
| Reference / kitchen sink                        | 4,400 (`full.yml`)       | ~27 MB                |

Numbers are after `-O3 -msimd128 -sWASM_BIGINT -sEVAL_CTORS=2` with `OCJS_LTO=0` (the shipped config). Add 20-40% to those sizes if you turn LTO on; expect a smaller binary but slower build.

## Workflow

### 1. Start from `build-configs/full.yml`

```bash
cp build-configs/full.yml build-configs/my-config.yml
```

The file lists every bound class under `mainBuild.bindings:`. Each entry has the shape `- symbol: <ClassName>`.

### 2. Delete the classes you don't need

Open `build-configs/my-config.yml` and remove every line whose class your consumer never touches. There is no transitive closure to compute — handle typedefs for the surviving classes' `NCollection_*` and `Handle<T>` members are auto-discovered at codegen time, so you only have to list the classes you actually instantiate or pass references to.

### 3. Validate

```bash
./build-wasm.sh validate build-configs/my-config.yml
```

`validate` parses the YAML against [`src/customBuildSchema.py`](../../src/customBuildSchema.py) and fails non-zero on any malformed entry, unknown key, or duplicated symbol. It does not run the C++ pipeline.

### 4. Link

```bash
./build-wasm.sh link build-configs/my-config.yml
```

Link reuses cached `.o` files for every class still bound, so a trim that strips half of `full.yml` typically completes in 60-180 seconds. The output appears alongside the YAML config: `my-config.wasm`, `my-config.js`, `my-config.d.ts`.

If you removed a class that another bound class transitively needs (an OCCT subsystem dependency that bindgen does not auto-discover), the link step fails with an `undefined symbol` error pointing at the missing class. Add it back to the YAML and re-run.

## Worked example: STEP round-tripper

Start with `full.yml` and keep only the bindings sufficient to:

- read a STEP file (`STEPControl_Reader`)
- iterate the shape graph (`TopExp_Explorer`, `TopoDS_Shape` and friends)
- write a STEP file (`STEPControl_Writer`)
- decode exceptions (`OCJS::getStandard_FailureData`)

A minimal `step-roundtrip.yml` keeps roughly the following families:

```yaml
mainBuild:
  name: step_roundtrip.js
  bindings:
    # Standard / Message
    - symbol: Standard_Failure
    - symbol: Standard_OutOfRange
    - symbol: Standard_NullObject
    - symbol: Message_ProgressRange
    - symbol: Message_ProgressIndicator
    # TCollection (strings)
    - symbol: TCollection_AsciiString
    - symbol: TCollection_ExtendedString
    # TopoDS / TopExp (shape graph)
    - symbol: TopoDS
    - symbol: TopoDS_Shape
    - symbol: TopoDS_Compound
    - symbol: TopoDS_Solid
    - symbol: TopoDS_Shell
    - symbol: TopoDS_Face
    - symbol: TopoDS_Wire
    - symbol: TopoDS_Edge
    - symbol: TopoDS_Vertex
    - symbol: TopExp
    - symbol: TopExp_Explorer
    # gp (primitives)
    - symbol: gp_Pnt
    - symbol: gp_Dir
    - symbol: gp_Vec
    - symbol: gp_Ax2
    # STEPControl
    - symbol: STEPControl_Reader
    - symbol: STEPControl_Writer
    - symbol: STEPControl_StepModelType
    - symbol: IFSelect_ReturnStatus
    - symbol: Interface_Static
  emccFlags:
    - -O3
    - -msimd128
    - -sWASM_BIGINT
    - -sEVAL_CTORS=2
    - -sMODULARIZE=1
    - -sEXPORT_ES6=1
    - -sENVIRONMENT=web,worker,node
    - -sALLOW_MEMORY_GROWTH=1
```

Validate + link:

```bash
./build-wasm.sh validate build-configs/step-roundtrip.yml
./build-wasm.sh link build-configs/step-roundtrip.yml
```

On a warm cache, the link step lands in roughly a minute. Expect a binary in the 1.5-3 MB range.

## When trimming feeds back into your design

A trimmed binary makes the dependency graph of your application explicit. If you find yourself adding a class to your YAML to recover from a link error, treat that as a signal: either the class is genuinely part of your call graph, or your application is reaching into an OCCT subsystem it doesn't actually need. The second case is worth investigating before bloating the binary further.

## Related references

- [YAML Schema Reference](../reference/yaml-schema.md) — full YAML schema (every key and its semantics)
- [Custom emcc flags](./custom-emcc-flags.md) — tuning `emccFlags` after you have the right symbol set
- [`build-configs/full.yml`](../../build-configs/full.yml) — canonical full-binding YAML used by the published tarball
- [`build-configs/configurations.json`](../../build-configs/configurations.json) — named compile-time configurations (`single-threaded`, `single-threaded-smallest`, `multi-threaded`, `debug`)
