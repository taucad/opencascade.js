"""Auto-discovery of NCollection template instantiations from bound class method signatures.

Scans the AST of bound OCCT classes to find NCollection template instantiations
used in method parameters and return types, then generates modern C++ `using`
declarations and a manifest for the link step.
"""
import clang.cindex
import json
import os
import re

NCOLLECTION_CONTAINERS = frozenset({
    "NCollection_Array1", "NCollection_Array2",
    "NCollection_HArray1", "NCollection_HArray2",
    "NCollection_Sequence", "NCollection_HSequence",
    "NCollection_List", "NCollection_Map",
    "NCollection_DataMap", "NCollection_IndexedMap",
    "NCollection_IndexedDataMap",
    "NCollection_Vector", "NCollection_DynamicArray",
    "NCollection_DoubleMap",
})

CONTAINER_ALIASES = {
    "NCollection_Vector": "NCollection_DynamicArray",
}


def mangle_template_name(container, arg_spellings):
    """Convert a template instantiation to a valid C++ identifier.

    Recursively strips all nested template syntax, converting angle brackets
    and separators into underscores to produce a flat, valid C++ identifier.

    Examples:
        NCollection_Array1, ["gp_Pnt"] -> "NCollection_Array1_gp_Pnt"
        NCollection_Sequence, ["occ::handle<Geom_Curve>"] -> "NCollection_Sequence_handle_Geom_Curve"
        NCollection_Array1, ["NCollection_Vec3<float>"] -> "NCollection_Array1_NCollection_Vec3_float"
    """
    parts = [container]
    for arg in arg_spellings:
        clean = arg.replace("occ::handle<", "handle_").replace("opencascade::handle<", "handle_")
        clean = re.sub(r"[<>,*&]", "_", clean)
        clean = clean.replace("::", "_").replace(" ", "")
        clean = clean.replace("const", "")
        clean = re.sub(r"_+", "_", clean).strip("_")
        if not clean:
            return None
        parts.append(clean)
    return "_".join(parts)


def _extract_template_args(clang_type):
    """Extract template argument spellings from a clang type."""
    num_args = clang_type.get_num_template_arguments()
    if num_args <= 0:
        return []
    args = []
    for i in range(num_args):
        arg_type = clang_type.get_template_argument_type(i)
        spelling = arg_type.spelling
        if not spelling:
            spelling = arg_type.get_canonical().spelling
        if spelling:
            args.append(spelling)
    return args


def _is_globally_accessible(arg_type):
    """Check whether a template argument type is accessible at file/namespace scope.

    Rejects types nested inside classes (e.g., Poly_CoherentTriangulation::TwoIntegers)
    or typedef aliases only visible within non-global namespaces that the using
    declaration site cannot reach.
    """
    decl = arg_type.get_declaration()
    if not decl or not decl.spelling:
        decl = arg_type.get_canonical().get_declaration()
    if not decl or not decl.spelling:
        return True

    parent = decl.semantic_parent
    if not parent:
        return True

    if parent.kind == clang.cindex.CursorKind.CLASS_DECL:
        return False
    if parent.kind == clang.cindex.CursorKind.STRUCT_DECL:
        return False
    return True


def _scan_type_for_ncollection(clang_type, needed):
    """Check if a type is or contains an NCollection template instantiation."""
    t = clang_type
    if t.kind == clang.cindex.TypeKind.LVALUEREFERENCE:
        t = t.get_pointee()
    if t.kind == clang.cindex.TypeKind.RVALUEREFERENCE:
        t = t.get_pointee()
    if t.kind == clang.cindex.TypeKind.POINTER:
        t = t.get_pointee()

    spelling = t.spelling.replace("const ", "").strip()

    decl = t.get_declaration()
    if not decl or not decl.spelling:
        canonical = t.get_canonical()
        decl = canonical.get_declaration()
        if not decl or not decl.spelling:
            return

    container = CONTAINER_ALIASES.get(decl.spelling, decl.spelling)
    if container not in NCOLLECTION_CONTAINERS:
        if t.get_num_template_arguments() > 0:
            for i in range(t.get_num_template_arguments()):
                inner = t.get_template_argument_type(i)
                _scan_type_for_ncollection(inner, needed)
        return

    arg_spellings = _extract_template_args(t)
    if not arg_spellings:
        return

    for i in range(t.get_num_template_arguments()):
        arg_t = t.get_template_argument_type(i)
        if not _is_globally_accessible(arg_t):
            return
        canonical = arg_t.get_canonical()
        if canonical.kind == clang.cindex.TypeKind.POINTER:
            return

    mangled = mangle_template_name(container, arg_spellings)
    if mangled is None:
        return
    needed.add((mangled, container, tuple(arg_spellings)))


def _scan_class_methods(class_cursor, needed):
    """Scan all public methods of a class for NCollection types."""
    for child in class_cursor.get_children():
        if child.kind == clang.cindex.CursorKind.CXX_METHOD:
            if child.access_specifier != clang.cindex.AccessSpecifier.PUBLIC:
                continue
            _scan_type_for_ncollection(child.result_type, needed)
            for arg in child.get_arguments():
                _scan_type_for_ncollection(arg.type, needed)
        elif child.kind == clang.cindex.CursorKind.CONSTRUCTOR:
            if child.access_specifier != clang.cindex.AccessSpecifier.PUBLIC:
                continue
            for arg in child.get_arguments():
                _scan_type_for_ncollection(arg.type, needed)


_HARRAY_TO_ARRAY = {
    "NCollection_HArray1": "NCollection_Array1",
    "NCollection_HArray2": "NCollection_Array2",
    "NCollection_HSequence": "NCollection_Sequence",
}


def discover_ncollection_types(tuInfo, filter_classes_fn):
    """Scan bound class methods for NCollection template instantiations.

    Returns a set of (mangled_name, container, arg_spellings_tuple) tuples.
    """
    needed = set()
    for child in tuInfo.allChildren:
        if not filter_classes_fn(child, False):
            continue
        _scan_class_methods(child, needed)

    augmented = set()
    for mangled_name, container, arg_spellings in needed:
        augmented.add((mangled_name, container, arg_spellings))
        inner_container = _HARRAY_TO_ARRAY.get(container)
        if inner_container:
            inner_mangled = mangle_template_name(inner_container, list(arg_spellings))
            if inner_mangled:
                augmented.add((inner_mangled, inner_container, arg_spellings))

    return augmented


def generate_using_declarations(discovered):
    """Generate C++ using declarations for discovered NCollection types.

    Returns a newline-joined string of sorted using declarations.
    """
    if not discovered:
        return ""
    lines = []
    for (mangled_name, container, arg_spellings) in discovered:
        full_type = f"{container}<{', '.join(arg_spellings)}>"
        lines.append(f"using {mangled_name} = {full_type};")
    return "\n".join(sorted(lines))


def write_manifest(discovered, build_dir):
    """Write the NCollection manifest JSON for the link step."""
    manifest = {
        "symbols": sorted(mangled for mangled, _, _ in discovered),
        "declarations": [],
    }
    for mangled, container, args in sorted(discovered):
        manifest["declarations"].append({
            "mangled_name": mangled,
            "container": container,
            "args": list(args),
        })
    os.makedirs(build_dir, exist_ok=True)
    manifest_path = os.path.join(build_dir, "ncollection-manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"NCollection manifest: {len(discovered)} types -> {manifest_path}", flush=True)
    return manifest_path
