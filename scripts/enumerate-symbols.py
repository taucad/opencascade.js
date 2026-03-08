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
    """Set environment variables needed by TuInfo/Common.py."""
    os.environ["OCJS_ROOT"] = str(OCJS_ROOT)
    os.environ["OCCT_ROOT"] = str(occt_root)
    sys.path.insert(0, str(OCJS_ROOT / "src"))


def enumerate_symbols(occt_root: Path, filter_path: Path):
    """Parse OCCT headers with libclang and enumerate all bindable symbols."""
    import clang.cindex

    _setup_environment(occt_root)

    from TuInfo import TuInfo
    from Common import occtBasePath
    from filter.filterPackages import filterPackages
    from bindings import shouldProcessClass

    cfg = load_filters(filter_path)

    print(f"OCCT source:  {occtBasePath}")
    print(f"Filters:      {filter_path}")
    print(f"Parsing OCCT headers with libclang...")

    t0 = time.time()
    tuInfo = TuInfo("")
    parse_time = time.time() - t0
    print(f"Parsed in {parse_time:.1f}s ({len(tuInfo.allChildren)} AST nodes)\n")

    # Collect classes using the same logic as generateBindings.py
    classes: Dict[str, str] = {}
    skipped_classes: Set[str] = set()

    for child in tuInfo.allChildren:
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

        name = child.spelling
        if is_excluded(name, cfg):
            skipped_classes.add(name)
            continue

        classes[name] = pkg

    # Collect enums
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

        name = child.spelling
        if is_excluded(name, cfg):
            skipped_classes.add(name)
            continue

        enums[name] = pkg

    # Collect template typedefs
    _FILTERED_TEMPLATE_TYPEDEFS = frozenset({
        "Handle_math_NotSquare",
        "Handle_math_SingularMatrix",
        "TColStd_PackedMapOfInteger",
        "TColStd_SequenceOfAddress",
        "TopTools_IndexedDataMapOfShapeAddress",
    })

    typedefs: Dict[str, str] = {}
    for child in tuInfo.templateTypedefs:
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

        typedefs[name] = pkg

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

    for name in list(classes.keys()):
        for child in tuInfo.allChildren:
            if child.spelling == name and child.kind in (
                clang.cindex.CursorKind.CLASS_DECL,
                clang.cindex.CursorKind.STRUCT_DECL,
            ):
                if _is_transient_derived(child):
                    handle_classes.add(name)
                break

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
        "    #include <TColStd_IndexedDataMapOfStringString.hxx>",
        "    struct TopoDS_Cast {};",
        "    using namespace emscripten;",
        '    EMSCRIPTEN_BINDINGS(ocjs_additional) {',
        '      class_<NCollection_IndexedDataMap<TCollection_AsciiString, TCollection_AsciiString>>("TColStd_IndexedDataMapOfStringString")',
        "        .constructor<>()",
        "        ;",
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
        "  - -sEXPORT_ES6=1",
        "  - -sMODULARIZE",
        "  - -sALLOW_MEMORY_GROWTH=1",
        '  - -sEXPORTED_RUNTIME_METHODS=["FS"]',
        "  - -sINITIAL_MEMORY=100MB",
        "  - -sMAXIMUM_MEMORY=4GB",
        "  - -sUSE_FREETYPE=1",
        "  - -sERROR_ON_UNDEFINED_SYMBOLS=0",
        "  - --no-entry",
        "  - -sDISABLE_EXCEPTION_CATCHING=1",
        "  - -Wl,--allow-undefined",
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
        help="Path to OCCT source checkout (default: ../OCCT relative to OCJS root)",
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
        occt_root = Path(os.environ.get("OCCT_ROOT", str(OCJS_ROOT.parent / "OCCT")))

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
