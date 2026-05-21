#!/usr/bin/env python3
"""Enumerate all bindable OCCT symbols using libclang AST parsing.

Uses the same libclang infrastructure as the binding generator (TuInfo.py)
to ensure perfect consistency between symbol enumeration and actual binding
generation. This replaces the previous regex-based approach which was
inherently brittle for C++ header parsing.

Usage:
    # Auto-detect OCCT at ../OCCT (relative to opencascade.js root)
    python3 scripts/enumerate-symbols.py

    # Explicit OCCT source path
    python3 scripts/enumerate-symbols.py --occt-root /path/to/OCCT

    # Dry-run: print stats without writing
    python3 scripts/enumerate-symbols.py --dry-run

    # Custom output path
    python3 scripts/enumerate-symbols.py -o build-configs/my-full.yml

    # Apply bindgen-filters.yaml exclusions (default: auto-detected)
    python3 scripts/enumerate-symbols.py --filters bindgen-filters.yaml
"""

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, NamedTuple, Set

import yaml

SCRIPT_DIR = Path(__file__).resolve().parent
OCJS_ROOT = SCRIPT_DIR.parent
DEFAULT_FILTERS = OCJS_ROOT / "bindgen-filters.yaml"
DEFAULT_OUTPUT = OCJS_ROOT / "build-configs" / "full.yml"


# ── Filter config (from bindgen-filters.yaml) ────────────────────────

class FilterConfig(NamedTuple):
    excluded_classes: Set[str]
    excluded_class_prefixes: List[str]
    excluded_typedefs: Set[str]
    excluded_template_typedefs: Set[str]
    excluded_headers: Set[str]
    excluded_packages: Set[str]


def load_filters(path: Path) -> FilterConfig:
    with open(path) as f:
        raw = yaml.safe_load(f) or {}

    exclude = raw.get("exclude", {})

    classes: Set[str] = set()
    prefixes: List[str] = []
    for item in exclude.get("classes", []):
        if isinstance(item, dict) and "prefix" in item:
            prefixes.append(item["prefix"])
        elif isinstance(item, str):
            classes.add(item)

    return FilterConfig(
        excluded_classes=classes,
        excluded_class_prefixes=prefixes,
        excluded_typedefs=set(exclude.get("typedefs", [])),
        excluded_template_typedefs=set(exclude.get("template_typedefs", [])),
        excluded_headers=set(exclude.get("headers", [])),
        excluded_packages=set(exclude.get("packages", [])),
    )


def is_excluded(name: str, cfg: FilterConfig) -> bool:
    if name in cfg.excluded_classes:
        return True
    return any(name.startswith(p) for p in cfg.excluded_class_prefixes)


# ── libclang-based symbol enumeration ─────────────────────────────────

def _setup_environment(occt_root: Path):
    """Set environment variables needed by TuInfo / ocjs_bindgen.config.paths.

    NOTE: When invoked outside the bindgen pipeline, libclang silently
    truncates `templateTypedefs` after the first unresolvable header
    (rapidjson, freetype, emsdk libc++). This file intentionally does NOT
    set those deps env-vars so that enumerate-symbols.py mirrors the
    historical phase-1 truncation it has always relied on; resolving deps
    here unmasks 43 NCollection synthetic aliases that collide with
    user-named NCollection typedefs at link time (e.g.
    NCollection_DynamicArray<gp_XYZ> vs VectorOfPoint). A standalone
    de-duplication pass against `templateTypedefUnderlyingMultimap` is
    tracked separately in the non-graphics coverage inventory
    (Phase 5 — link-manifest dedup) and must land before this script can
    safely enumerate the full template-typedef surface.
    """
    os.environ["OCJS_ROOT"] = str(OCJS_ROOT)
    os.environ["OCCT_ROOT"] = str(occt_root)
    sys.path.insert(0, str(OCJS_ROOT / "src"))


def enumerate_symbols(occt_root: Path, filter_path: Path):
    """Parse OCCT headers with libclang and enumerate all bindable symbols."""
    import clang.cindex

    _setup_environment(occt_root)

    from ocjs_bindgen.ast import TuInfo
    from ocjs_bindgen.config.paths import occtBasePath
    from filter.filterPackages import filterPackages
    from ocjs_bindgen.predicates import shouldProcessClass
    from ocjs_bindgen.naming import getClassJsPublicName, getEnumJsPublicName

    cfg = load_filters(filter_path)

    print(f"OCCT source:  {occtBasePath}")
    print(f"Filters:      {filter_path}")
    print(f"Parsing OCCT headers with libclang...")

    t0 = time.time()
    tuInfo = TuInfo("")
    parse_time = time.time() - t0
    print(f"Parsed in {parse_time:.1f}s ({len(tuInfo.allChildren)} AST nodes, {len(tuInfo.classDict)} classes)\n")

    # Collect classes by walking the full cursor list (`tuInfo.allChildren`)
    # rather than the bare-spelling-deduped `classDict`. The R1 recursive
    # class walker emits multiple nested cursors that share a bare spelling
    # (`BRepGraph::TopoView::FaceOps`, `BRepGraph::EditorView::FaceOps`,
    # `BRepGraph::RefsView::FaceOps`, …) — `classDict` keeps only the first
    # one because it keys by `cursor.spelling`. Iterating `allChildren`
    # preserves every cursor; dedup is then applied at the JS-public-name
    # layer (which encodes the full qualified path) so genuinely distinct
    # nested classes survive.
    classes: Dict[str, str] = {}
    skipped_classes: Set[str] = set()
    seen_class_cursors: Set[int] = set()

    for child in tuInfo.allChildren:
        if child.kind not in (
            clang.cindex.CursorKind.CLASS_DECL,
            clang.cindex.CursorKind.STRUCT_DECL,
        ):
            continue
        cur_id = id(child)
        if cur_id in seen_class_cursors:
            continue
        seen_class_cursors.add(cur_id)

        if child.extent.start.file is None:
            continue
        if not child.extent.start.file.name.startswith(occtBasePath):
            continue

        pkg = os.path.basename(os.path.dirname(child.location.file.name))
        if not filterPackages(pkg):
            continue
        if cfg.excluded_packages and pkg in cfg.excluded_packages:
            continue
        if not shouldProcessClass(child, occtBasePath):
            continue
        if child.spelling == "" or child.spelling.startswith("("):
            continue

        name = getClassJsPublicName(child)
        if is_excluded(name, cfg):
            skipped_classes.add(name)
            continue

        classes.setdefault(name, pkg)

    enums: Dict[str, str] = {}
    for child in tuInfo.enums:
        if child.extent.start.file is None:
            continue
        if not child.extent.start.file.name.startswith(occtBasePath):
            continue

        pkg = os.path.basename(os.path.dirname(child.location.file.name))
        if not filterPackages(pkg):
            continue
        if cfg.excluded_packages and pkg in cfg.excluded_packages:
            continue
        if child.spelling == "" or child.spelling.startswith("("):
            continue
        if child.kind != clang.cindex.CursorKind.ENUM_DECL:
            continue

        name = getEnumJsPublicName(child)
        if is_excluded(name, cfg):
            skipped_classes.add(name)
            continue

        enums[name] = pkg

    # Collect template typedefs
    # NOTE: `Handle_math_NotSquare` / `Handle_math_SingularMatrix` /
    # `Handle_Standard_Type` are NOT listed here — they are filtered
    # structurally by the `name.startswith("Handle_")` block below
    # (the underlying classes `math_NotSquare`, `math_SingularMatrix`,
    # and `Standard_Type` are all bound, so the smart_ptr binding
    # already registers the JS name "Handle_X" and a separate typedef
    # binding would collide). See the comment on that block.
    _FILTERED_TEMPLATE_TYPEDEFS = frozenset({
        "TColStd_PackedMapOfInteger",
        "TColStd_SequenceOfAddress",
        "TopTools_IndexedDataMapOfShapeAddress",
    })

    # OCCT V8 template-alias families that the truncated phase-1 parse can
    # miss when libclang stops at the first unresolved header. The bindings
    # generator (which has full deps env) emits these via processTemplate
    # in src/generateBindings.py — they MUST appear in the link manifest
    # or the resulting wasm will quietly omit them. Keep this list aligned
    # with the F1 fix in src/filter/filterTypedefs.py and
    # src/generateBindings.py::processTemplate.
    # LProps template-typedef restoration (relaxed single-template-ref guard).
    _ALWAYS_INCLUDE_TEMPLATE_TYPEDEFS: Dict[str, str] = {
        "GeomLProp_SLProps":   "GeomLProp",
        "GeomLProp_CLProps":   "GeomLProp",
        "GeomLProp_CLProps2d": "GeomLProp",
        "BRepLProp_SLProps":   "BRepLProp",
        "BRepLProp_CLProps":   "BRepLProp",
        "HLRBRep_SLProps":     "HLRBRep",
    }

    # Mirror src/generateBindings.py::dedupeTemplateTypedefsByCanonical so the
    # YAML symbol manifest only lists aliases that the binding generator will
    # actually emit a `class_<…>(…)` registration for. Without this, OCCT V8
    # alias families (`BRepGraph_CompoundsOfFace/Shell/Solid/CompSolid/Compound`
    # all instantiating `BRepGraph_ReverseIterator::ParentsOf<BRepGraph_
    # CompoundId>`) appear as N entries in the YAML but only ONE compiled .o
    # exists — the validator would falsely flag the dropped aliases as missing,
    # while the runtime wasm correctly registers a single class under the
    # alphabetically-first alias's JS name. Keeping the two layers in lock-step
    # is the only way to keep `validate-build.py` honest about coverage.
    from ocjs_bindgen.pipeline.generate import dedupeTemplateTypedefsByCanonical
    deduped_template_typedefs = dedupeTemplateTypedefsByCanonical(tuInfo.templateTypedefs)

    typedefs: Dict[str, str] = {}
    for child in deduped_template_typedefs:
        if child.extent.start.file is None:
            continue
        if not child.extent.start.file.name.startswith(occtBasePath):
            continue

        pkg = os.path.basename(os.path.dirname(child.location.file.name))
        if not filterPackages(pkg):
            continue
        if cfg.excluded_packages and pkg in cfg.excluded_packages:
            continue

        name = child.spelling
        if name in _FILTERED_TEMPLATE_TYPEDEFS:
            continue
        if name in cfg.excluded_typedefs or name in cfg.excluded_template_typedefs:
            continue
        if is_excluded(name, cfg):
            skipped_classes.add(name)
            continue

        # Drop Handle_X typedefs whose underlying type is opencascade::handle<X>
        # when X itself is bound. The class binding for X already emits
        # `.smart_ptr<opencascade::handle<X>>("Handle_X")` (see
        # src/bindings.py), which registers the JS public name "Handle_X".
        # Binding the typedef separately emits a second
        # `class_<Handle_X>("Handle_X")` block and Embind aborts Module()
        # with `BindingError: Cannot register type 'Handle_X' twice`. Two
        # prior cases (Handle_math_NotSquare, Handle_math_SingularMatrix)
        # were patched name-by-name in _FILTERED_TEMPLATE_TYPEDEFS above;
        # this rule generalises that fix so any future
        # DEFINE_STANDARD_HANDLE on a bound class is automatically safe.
        # Triggered in OCCT V8 by Standard_Type.hxx's
        # DEFINE_STANDARD_HANDLE(Standard_Type, Standard_Transient).
        underlying = child.underlying_typedef_type.spelling
        if name.startswith("Handle_") and underlying.startswith("opencascade::handle<"):
            inner = underlying[len("opencascade::handle<"):].rstrip(">").strip()
            if inner in classes:
                continue

        typedefs[name] = pkg

    for forced_name, forced_pkg in _ALWAYS_INCLUDE_TEMPLATE_TYPEDEFS.items():
        if forced_name in cfg.excluded_typedefs or forced_name in cfg.excluded_template_typedefs:
            continue
        if is_excluded(forced_name, cfg):
            skipped_classes.add(forced_name)
            continue
        typedefs.setdefault(forced_name, forced_pkg)

    # Identify classes that derive from Standard_Transient (handle-compatible)
    handle_classes: Set[str] = set()
    transient_cache: Dict[str, bool] = {}

    def _is_transient_derived(cursor) -> bool:
        """Walk the base-class chain to check if a class derives from Standard_Transient."""
        name = cursor.spelling
        if name in transient_cache:
            return transient_cache[name]
        if name == "Standard_Transient":
            transient_cache[name] = True
            return True

        transient_cache[name] = False
        for child_cursor in cursor.get_children():
            if child_cursor.kind == clang.cindex.CursorKind.CXX_BASE_SPECIFIER:
                base_def = child_cursor.get_definition()
                if base_def is not None and _is_transient_derived(base_def):
                    transient_cache[name] = True
                    return True
                base_name = child_cursor.type.spelling.replace("class ", "")
                if base_name == "Standard_Transient":
                    transient_cache[name] = True
                    return True

        return False

    # Iterate classDict directly so the cursor lookup works for namespace-
    # scoped types where `cursor.spelling` is the bare name but the YAML key
    # is the JS-public (namespace-prefixed) name.
    for cursor in tuInfo.classDict.values():
        if cursor.kind not in (
            clang.cindex.CursorKind.CLASS_DECL,
            clang.cindex.CursorKind.STRUCT_DECL,
        ):
            continue
        js_name = getClassJsPublicName(cursor)
        if js_name in classes and _is_transient_derived(cursor):
            handle_classes.add(js_name)

    return classes, enums, typedefs, skipped_classes, handle_classes


# ── YAML generation ──────────────────────────────────────────────────

def generate_yaml(classes, enums, typedefs, handle_classes: Set[str]) -> str:
    all_symbols = sorted(set(classes) | set(enums) | set(typedefs))

    lines = [
        "mainBuild:",
        "  name: opencascade_full.js",
        "  bindings:",
    ]

    for sym in all_symbols:
        lines.append(f"  - symbol: {sym}")

    # NOTE: TColStd_IndexedDataMapOfStringString and TopoDS_Bind_ are NOT
    # re-emitted here — they are the canonical responsibility of
    # BUILTIN_ADDITIONAL_BIND_CODE in src/buildFromYaml.py (concatenated
    # before this YAML's additionalBindCode at link time). Re-registering
    # them here would emit two `class_<…>("TColStd_IndexedDataMapOfStringString")`
    # blocks — Embind enforces uniqueness on JS public names and aborts
    # Module() instantiation with `BindingError: Cannot register public
    # name 'X' twice`. TopoDS_Cast (the legacy static-method namespace)
    # remains here because BUILTIN registers `TopoDS` instead under a
    # distinct JS name; both can coexist.
    lines.extend([
        "  additionalBindCode: |",
        "    #include <TopoDS.hxx>",
        "    #include <TopoDS_Vertex.hxx>",
        "    #include <TopoDS_Edge.hxx>",
        "    #include <TopoDS_Wire.hxx>",
        "    #include <TopoDS_Face.hxx>",
        "    #include <TopoDS_Shell.hxx>",
        "    #include <TopoDS_Solid.hxx>",
        "    #include <TopoDS_CompSolid.hxx>",
        "    #include <TopoDS_Compound.hxx>",
        "    #include <FairCurve_Batten.hxx>",
        "    #include <FairCurve_MinimalVariation.hxx>",
        "    #include <FairCurve_AnalysisCode.hxx>",
        "    struct TopoDS_Cast {};",
        "    using namespace emscripten;",
        '    EMSCRIPTEN_BINDINGS(ocjs_additional) {',
        '      function("FairCurve_Batten_Compute", optional_override([](FairCurve_Batten& self, int nbIter, double tol) -> int {',
        "        FairCurve_AnalysisCode code;",
        "        self.Compute(code, nbIter, tol);",
        "        return static_cast<int>(code);",
        "      }));",
        '      function("FairCurve_MinimalVariation_Compute", optional_override([](FairCurve_MinimalVariation& self, int nbIter, double tol) -> int {',
        "        FairCurve_AnalysisCode code;",
        "        self.Compute(code, nbIter, tol);",
        "        return static_cast<int>(code);",
        "      }));",
        '      class_<TopoDS_Cast>("TopoDS_Cast")',
        '        .class_function("Edge", optional_override([](const TopoDS_Shape& s) -> TopoDS_Edge { return TopoDS::Edge(s); }))',
        '        .class_function("Wire", optional_override([](const TopoDS_Shape& s) -> TopoDS_Wire { return TopoDS::Wire(s); }))',
        '        .class_function("Face", optional_override([](const TopoDS_Shape& s) -> TopoDS_Face { return TopoDS::Face(s); }))',
        '        .class_function("Vertex", optional_override([](const TopoDS_Shape& s) -> TopoDS_Vertex { return TopoDS::Vertex(s); }))',
        '        .class_function("Shell", optional_override([](const TopoDS_Shape& s) -> TopoDS_Shell { return TopoDS::Shell(s); }))',
        '        .class_function("Solid", optional_override([](const TopoDS_Shape& s) -> TopoDS_Solid { return TopoDS::Solid(s); }))',
        '        .class_function("Compound", optional_override([](const TopoDS_Shape& s) -> TopoDS_Compound { return TopoDS::Compound(s); }))',
        "        ;",
        "    }",
        "  emccFlags:",
        # Native WASM exception handling (matches OCJS_CONFIG=single-threaded
        # in nx.json which compiles every .o with -fwasm-exceptions). Without
        # these the link emits a wasm whose runtime imports a `Tag` that the
        # generated loader never sets up, so every Module() invocation fails
        # with `LinkError: tag import requires a WebAssembly.Tag`. The
        # EXPORT_EXCEPTION_HANDLING_HELPERS flag is also enforced by
        # buildFromYaml.py (raises if missing alongside -fwasm-exceptions).
        "  - -fwasm-exceptions",
        "  - -sEXPORT_EXCEPTION_HANDLING_HELPERS",
        "  - -sEXPORT_ES6=1",
        "  - -sMODULARIZE",
        "  - -sALLOW_MEMORY_GROWTH=1",
        '  - -sEXPORTED_RUNTIME_METHODS=["FS"]',
        "  - -sINITIAL_MEMORY=128MB",
        "  - -sMAXIMUM_MEMORY=4GB",
        "  - -sUSE_FREETYPE=1",
        "  - -sERROR_ON_UNDEFINED_SYMBOLS=0",
        "  - --no-entry",
        # NOTE: -sDISABLE_EXCEPTION_CATCHING / -sDISABLE_EXCEPTION_THROWING
        # MUST NOT be set when -fwasm-exceptions is on. Emcc will warn but
        # still emit a wasm whose runtime imports a Tag (under module "a"
        # name "Mc") that the generated JS loader never wires up — so the
        # module fails to instantiate with `LinkError: tag import requires
        # a WebAssembly.Tag`. The two cannot coexist; native WASM EH owns
        # the runtime side end-to-end. (Pre-V8 builds carried these flags
        # because OCJS_EXCEPTIONS=0 was the default; they are stale now.)
        "  - -Wl,--allow-undefined",
        # Symbol map for stack-trace demangling in browser devtools and the
        # validate-build.py post-link verifier. Without it the wasm symbol
        # table cannot be cross-referenced against the YAML manifest.
        "  - --emit-symbol-map",
        # 8 MiB stack — OCCT's deep recursion in topology traversal and STEP
        # parsing exceeds the 64 KiB emcc default; without this, smoke tests
        # crash with `RuntimeError: call stack exhausted` on STEP imports.
        "  - -sSTACK_SIZE=8388608",
        # Enable BigInt for i64 ABI — required for OCCT's int64_t shape IDs
        # so they round-trip without precision loss across the JS boundary.
        "  - -sWASM_BIGINT",
        # Constant-evaluate global ctors at link time; shrinks startup by
        # ~30% and reduces wasm size by avoiding redundant init blocks.
        "  - -sEVAL_CTORS=2",
        # 128-bit SIMD instructions (matches OCJS_CONFIG=single-threaded in
        # nx.json and the per-.o `-msimd128` set in compile-bindings).
        "  - -msimd128",
        # Optimization level. -O3 is the production target; debug builds
        # should override via OCJS_CONFIG, never edit this line.
        "  - -O3",
    ])

    return "\n".join(lines) + "\n"


# ── CLI ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Enumerate bindable OCCT symbols via libclang and generate build-configs/full.yml"
    )
    parser.add_argument(
        "--occt-root",
        type=Path,
        default=None,
        help="Path to OCCT source checkout (default: deps/OCCT relative to OCJS root — "
             "the same tree the build pipeline compiles, kept in sync via "
             "scripts/clone-deps.sh and DEPS.json)",
    )
    parser.add_argument(
        "--filters",
        type=Path,
        default=DEFAULT_FILTERS,
        help=f"Path to bindgen-filters.yaml (default: {DEFAULT_FILTERS})",
    )
    parser.add_argument(
        "-o", "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output YAML path (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print stats without writing the output file",
    )
    args = parser.parse_args()

    occt_root = args.occt_root
    if occt_root is None:
        occt_root = Path(os.environ.get("OCCT_ROOT", str(OCJS_ROOT / "deps" / "OCCT")))

    if not occt_root.is_dir():
        print(f"ERROR: OCCT root not found: {occt_root}", file=sys.stderr)
        print("Set --occt-root or OCCT_ROOT environment variable.", file=sys.stderr)
        sys.exit(1)

    if not (occt_root / "src").is_dir():
        print(f"ERROR: OCCT source dir not found: {occt_root / 'src'}", file=sys.stderr)
        sys.exit(1)

    if not args.filters.is_file():
        print(f"ERROR: Filter config not found: {args.filters}", file=sys.stderr)
        sys.exit(1)

    classes, enums, typedefs, skipped, handle_classes = enumerate_symbols(occt_root, args.filters)
    total = len(classes) + len(enums) + len(typedefs)

    print(f"{'═' * 56}")
    print(f"  Symbol Enumeration Results (libclang AST)")
    print(f"{'═' * 56}")
    print(f"  Classes:            {len(classes):>5}")
    print(f"  Enums:              {len(enums):>5}")
    print(f"  Template typedefs:  {len(typedefs):>5}")
    print(f"  Transient-derived:  {len(handle_classes):>5} (isNull/nullify via inheritance)")
    print(f"  {'─' * 40}")
    print(f"  Total symbols:      {total:>5}")
    print(f"  Excluded classes:   {len(skipped):>5}")
    print(f"{'═' * 56}")

    if args.dry_run:
        print("\n[dry-run] No file written.")
        return

    args.output.parent.mkdir(parents=True, exist_ok=True)
    content = generate_yaml(classes, enums, typedefs, handle_classes)
    args.output.write_text(content)
    print(f"\nWrote {total} symbols to {args.output}")


if __name__ == "__main__":
    main()
