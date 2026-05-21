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
    """Extract template argument spellings from a clang type.

    Always prefers the canonical spelling, which is namespace-qualified for
    types declared inside a namespace (e.g. `ExtremaPC::ExtremumResult`).
    The naked `arg_type.spelling` would return the lookup-context-relative
    name (`ExtremumResult` when scanned from inside `ExtremaPC::Result`),
    and emitting an unqualified `using NCollection_…<ExtremumResult>;` at
    global scope in `myMain.h` would fail to compile.
    """
    num_args = clang_type.get_num_template_arguments()
    if num_args <= 0:
        return []
    args = []
    for i in range(num_args):
        arg_type = clang_type.get_template_argument_type(i)
        canonical = arg_type.get_canonical()
        spelling = canonical.spelling or arg_type.spelling
        if spelling:
            args.append(spelling)
    return args


def _is_globally_accessible(arg_type, template_typedef_names=None):
    """Check whether a template argument type is accessible at file/namespace scope.

    Rejects types nested inside classes (e.g., Poly_CoherentTriangulation::TwoIntegers)
    or typedef aliases only visible within non-global namespaces that the using
    declaration site cannot reach.

    Lifts the rejection when the enclosing class is itself a
    `tuInfo.templateTypedefs` instantiation. Such types acquire a global
    file-scope name through the alias (e.g.
    ``BRepGraph_ReverseIterator<FaceOfWireRefTraits>`` is reached via the
    ``BRepGraph_FacesOfEdge`` typedef), so a ``using`` declaration at file
    scope can name them via the alias.
    """
    decl = arg_type.get_declaration()
    if not decl or not decl.spelling:
        decl = arg_type.get_canonical().get_declaration()
    if not decl or not decl.spelling:
        return True

    parent = decl.semantic_parent
    if not parent:
        return True

    if parent.kind in (clang.cindex.CursorKind.CLASS_DECL, clang.cindex.CursorKind.STRUCT_DECL):
        # Admit when the enclosing class is a known template-typedef
        # instantiation (its alias is at file scope, so we can name it).
        if template_typedef_names is not None and parent.spelling in template_typedef_names:
            return True
        return False
    return True


def _scan_type_for_ncollection(clang_type, needed, template_typedef_names=None, source_class=None):
    """Check if a type is or contains an NCollection template instantiation.

    `source_class` tags every discovered NCollection with the bound class
    whose method/field signature contained it. The link step uses these
    tags to compute per-YAML reachability — an NCollection whose source
    class is not in the consumer YAML's scope is dropped at link time,
    preventing per-YAML overbinding into unrelated OCCT packages.
    """
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
                _scan_type_for_ncollection(inner, needed, template_typedef_names, source_class)
        return

    arg_spellings = _extract_template_args(t)
    if not arg_spellings:
        return

    for i in range(t.get_num_template_arguments()):
        arg_t = t.get_template_argument_type(i)
        if not _is_globally_accessible(arg_t, template_typedef_names):
            return
        canonical = arg_t.get_canonical()
        if canonical.kind == clang.cindex.TypeKind.POINTER:
            return

    mangled = mangle_template_name(container, arg_spellings)
    if mangled is None:
        return
    needed.add((mangled, container, tuple(arg_spellings), source_class or "<anon>"))


def _scan_class_methods(class_cursor, needed, template_typedef_names=None, source_override=None):
    """Scan all public methods, constructors, and FIELD_DECLs of a class for NCollection types.

    Public FIELD_DECLs matter because Embind exposes them via `.property(...)`,
    and the wrapping NCollection type must be registered for JS access to work
    (otherwise `Cannot access X.field due to unbound types` at runtime). OCCT
    V8's namespace-scoped result/config structs (e.g. `ExtremaPC::Result.Extrema`)
    rely on this path.

    `source_override` lets the template-typedef pass tag discoveries with
    the typedef name (`BRepGraph_FacesOfEdge`) instead of the underlying
    template class (`BRepGraph_ReverseIterator`) so the link filter
    intersects against names a consumer YAML can actually bind. Defaults
    to `class_cursor.spelling` for the primary discovery pass.
    """
    source = source_override or (class_cursor.spelling or "<anon>")
    for child in class_cursor.get_children():
        if child.kind == clang.cindex.CursorKind.CXX_METHOD:
            if child.access_specifier != clang.cindex.AccessSpecifier.PUBLIC:
                continue
            _scan_type_for_ncollection(child.result_type, needed, template_typedef_names, source)
            for arg in child.get_arguments():
                _scan_type_for_ncollection(arg.type, needed, template_typedef_names, source)
        elif child.kind == clang.cindex.CursorKind.CONSTRUCTOR:
            if child.access_specifier != clang.cindex.AccessSpecifier.PUBLIC:
                continue
            for arg in child.get_arguments():
                _scan_type_for_ncollection(arg.type, needed, template_typedef_names, source)
        elif child.kind == clang.cindex.CursorKind.FIELD_DECL:
            if child.access_specifier != clang.cindex.AccessSpecifier.PUBLIC:
                continue
            _scan_type_for_ncollection(child.type, needed, template_typedef_names, source)


_HARRAY_TO_ARRAY = {
    "NCollection_HArray1": "NCollection_Array1",
    "NCollection_HArray2": "NCollection_Array2",
    "NCollection_HSequence": "NCollection_Sequence",
}

# Mangled NCollection names that are also registered manually in
# BUILTIN_ADDITIONAL_BIND_CODE (src/buildFromYaml.py). Embind requires each
# C++ type to be registered exactly once; auto-emitting these collides at
# Module() instantiation with `BindingError: Cannot register type ... twice`.
# The manual stubs preserve the OCCT-deprecated public names that downstream
# consumers (smoke tests, @taucad/runtime) call into via
# `oc.TColStd_IndexedDataMapOfStringString()`. Skip auto-discovery here so
# the manual binding remains the sole registration site.
_BUILTIN_BIND_CONFLICTS = frozenset({
    "NCollection_IndexedDataMap_TCollection_AsciiString_TCollection_AsciiString",
})


def _scan_template_typedef_methods(tuInfo, template_typedef, needed, template_typedef_names, source_override=None):
    """Discover NCollection types reachable through a template typedef.

    Resolves the typedef's template (e.g.
    ``BRepGraph_FacesOfEdge = BRepGraph_ReverseIterator<FaceOfWireRefTraits>``)
    via the same ``processTemplate`` codepath used by codegen, augments
    the substitution map with canonical ``type-parameter-N-M`` keys, then
    scans the underlying template class's method signatures with the
    substitution applied. NCollection types that depend on the substituted parameters
    (e.g. ``NCollection_DynamicArray<typename TraitsT::ParentId>``)
    enter the manifest as concrete instantiations
    (``NCollection_DynamicArray<BRepGraphInc_FaceRef>``).

    The substitution rewrites the AST-extracted argument spellings; we
    don't need to walk the template's body recursively because any NCollection
    used in a method signature is already visible via the existing
    `_scan_class_methods` traversal — the only thing missing was the
    substitution layer.
    """
    # Imported lazily so `discover` doesn't pull in the whole pipeline at
    # module import time (the pipeline imports discover via codegen).
    from ocjs_bindgen.pipeline.generate import processTemplate, SkipException
    from ocjs_bindgen.ast.template_args import augment_template_args_with_canonical

    try:
        templateClass, templateArgs = processTemplate(template_typedef)
    except SkipException:
        return
    except Exception:
        return
    augmented_args = augment_template_args_with_canonical(templateArgs, templateClass)

    # Tag discoveries with the typedef name so the link filter intersects
    # against names a consumer YAML can actually bind. An explicit
    # source_override (e.g. CUSTOM_CODE_SOURCE_TAG) wins.
    typedef_source = source_override or template_typedef.spelling or "<anon>"
    raw = set()
    _scan_class_methods(templateClass, raw, template_typedef_names, source_override=typedef_source)
    if not raw:
        return

    for mangled_name, container, arg_spellings, _orig_source in raw:
        substituted_args = tuple(
            _substitute_arg_spelling(spelling, augmented_args)
            for spelling in arg_spellings
        )
        if any(s is None for s in substituted_args):
            continue
        if any("type-parameter-" in s for s in substituted_args):
            continue
        new_mangled = mangle_template_name(container, list(substituted_args))
        if new_mangled is None:
            continue
        needed.add((new_mangled, container, substituted_args, typedef_source))


def _substitute_arg_spelling(spelling, template_args):
    """Substitute every key in `template_args` against `spelling`.

    Returns the substituted spelling, or ``None`` if nothing remains
    after stripping `typename` qualifiers and the spelling still
    contains an unresolved template parameter (the caller treats that as
    "skip this instantiation").
    """
    if not template_args or not spelling:
        return spelling
    out = spelling
    # Source-name + canonical-key substitution. We iterate sorted-by-length
    # descending so longer names (`TheItemType`) match before shorter ones
    # (`T`) which would otherwise trigger spurious replacements.
    for key in sorted(template_args, key=len, reverse=True):
        sub = getattr(template_args[key], "spelling", None) or str(template_args[key])
        if not sub:
            continue
        # Word-boundary substitution mirrors `replace_template_args` in
        # `ocjs_bindgen/ast/template_args.py` so the same semantics apply.
        out = re.sub(r"\b" + re.escape(key) + r"\b", sub, out)
    out = out.replace("typename ", "").strip()
    return out or None


CUSTOM_CODE_SOURCE_TAG = "__custom__"


def discover_ncollection_types(tuInfo, filter_classes_fn, source_override=None):
    """Scan bound class methods for NCollection template instantiations.

    Returns a set of (mangled_name, container, arg_spellings_tuple, sources_tuple)
    quadruples.

    Two passes:
      1. Direct scan of every bound class's methods (legacy behaviour).
      2. Substitute template typedefs (``using BRepGraph_FacesOfEdge
         = BRepGraph_ReverseIterator<FaceOfWireRefTraits>;``) and rescan
         the underlying template class with the concrete substitution
         applied. This surfaces NCollection containers parameterised on
         the substituted Traits members
         (``NCollection_DynamicArray<BRepGraphInc_FaceRef>``).

    ``source_override`` lets a caller force every discovery's
    ``source_classes`` to a single sentinel name. Pass
    ``CUSTOM_CODE_SOURCE_TAG`` ("__custom__") when running discovery
    against a consumer's ``additionalCppCode`` / ``myMain.h`` so the
    link-step reachability filter — which always seeds the YAML scope
    with that sentinel — retains every custom-code NCollection regardless
    of which OCCT classes the consumer YAML names. Without an override,
    each discovery is tagged with its originating bound class's spelling.
    """
    template_typedef_names = {td.spelling for td in tuInfo.templateTypedefs if td.spelling}

    needed = set()
    for child in tuInfo.allChildren:
        if not filter_classes_fn(child, False):
            continue
        _scan_class_methods(child, needed, template_typedef_names, source_override=source_override)

    # Second pass — substitute through every template typedef.
    for template_typedef in tuInfo.templateTypedefs:
        _scan_template_typedef_methods(
            tuInfo,
            template_typedef,
            needed,
            template_typedef_names,
            source_override=source_override,
        )

    augmented = set()
    for mangled_name, container, arg_spellings, source_class in needed:
        if mangled_name in _BUILTIN_BIND_CONFLICTS:
            continue
        augmented.add((mangled_name, container, arg_spellings, source_class))
        inner_container = _HARRAY_TO_ARRAY.get(container)
        if inner_container:
            inner_mangled = mangle_template_name(inner_container, list(arg_spellings))
            if inner_mangled and inner_mangled not in _BUILTIN_BIND_CONFLICTS:
                # HArray-twin inherits the originating source class so the
                # link filter applies symmetrically to both forms.
                augmented.add((inner_mangled, inner_container, arg_spellings, source_class))

    # Canonical-args dedup.
    #
    # The first pass discovers `NCollection_DynamicArray<BRepGraph_SolidId>`
    # (the alias-form), the typedef-substitution pass discovers
    # `NCollection_DynamicArray<BRepGraph_NodeId::Typed<...::Kind::Solid>>`
    # (the substituted form). Both `using` declarations name the same
    # underlying C++ type, so a fragment is emitted for each and Embind's
    # `class_<>` registration produces two `raw_destructor<X>` explicit
    # specializations for the same X — wasm-ld bails with a duplicate-symbol
    # error.
    #
    # Resolve by collapsing entries whose args reduce to the same canonical
    # spelling. The alias map is built from `tuInfo.templateTypedefs`
    # (`using BRepGraph_SolidId = BRepGraph_NodeId::Typed<...>;`) — repeated
    # word-boundary substitution chases multi-step aliases until the spelling
    # is stable. Order-independent: the first manifest entry seen for a given
    # canonical key wins, the rest are dropped.
    return _dedupe_by_canonical_args(augmented, tuInfo)


def _build_typedef_alias_map(tuInfo):
    """Map every `using A = B;` template-typedef to its underlying spelling.

    Used by `_dedupe_by_canonical_args` to collapse manifest entries whose
    args differ only in alias spelling — without this, the typedef-
    substitution second pass can produce a second NCollection<X>
    registration under a different mangled name for the same C++ type X,
    triggering wasm-ld duplicate symbol errors at link time.
    """
    alias_map = {}
    for td in tuInfo.templateTypedefs:
        name = (td.spelling or "").strip()
        if not name:
            continue
        try:
          underlying = td.underlying_typedef_type
        except Exception:
          underlying = None
        if underlying is None:
            continue
        underlying_spelling = (underlying.spelling or "").strip()
        if not underlying_spelling or underlying_spelling == name:
            continue
        alias_map[name] = underlying_spelling
    return alias_map


def _normalize_arg(arg, alias_map):
    """Resolve every alias in `arg` until the spelling reaches a fixed point."""
    if not arg or not alias_map:
        return arg
    prev = None
    cur = arg
    # Cap iterations as a defensive guard against pathological alias cycles
    # (`using A = B; using B = A;` shouldn't compile, but better safe than
    # spinning forever in a discover pass).
    for _ in range(8):
        prev = cur
        for alias in sorted(alias_map, key=len, reverse=True):
            cur = re.sub(r"\b" + re.escape(alias) + r"\b", alias_map[alias], cur)
        if cur == prev:
            return cur
    return cur


def _dedupe_by_canonical_args(entries, tuInfo):
    """Collapse manifest entries that share the same canonical args.

    Returns a `set` of `(mangled_name, container, arg_spellings, sources_tuple)`
    quadruples where each canonical (container, normalized-args) key appears
    exactly once. The same canonical NCollection may be discovered from
    multiple bound classes (e.g. `NCollection_Array1_TopoDS_Shape` reached
    from `TopoDS_Iterator`, `TopoDS_HShape`, …); we aggregate every source
    class into the winner's `sources_tuple` so the link-step reachability
    filter keeps the entry as long as *any* of its source classes is in
    the consumer YAML scope. Preserves the first-seen entry per key —
    sorting the input by mangled name keeps the output deterministic
    across runs.
    """
    alias_map = _build_typedef_alias_map(tuInfo)
    seen = {}      # key -> (mangled, container, args)
    sources = {}   # key -> set[str]
    for entry in sorted(entries):
        mangled, container, args, source = entry
        canonical_args = tuple(_normalize_arg(a, alias_map) for a in args)
        key = (container, canonical_args)
        if key not in seen:
            seen[key] = (mangled, container, args)
        sources.setdefault(key, set()).add(source)
    out = set()
    for key, (mangled, container, args) in seen.items():
        out.add((mangled, container, args, tuple(sorted(sources[key]))))
    return out


def generate_using_declarations(discovered):
    """Generate C++ using declarations for discovered NCollection types.

    Returns a newline-joined string of sorted using declarations.
    """
    if not discovered:
        return ""
    lines = []
    for entry in discovered:
        # Entries are 4-tuples (mangled, container, args, sources).
        # `using` declarations only need the first three; sources are
        # consumed by `write_manifest` for the link-step filter.
        mangled_name, container, arg_spellings = entry[0], entry[1], entry[2]
        full_type = f"{container}<{', '.join(arg_spellings)}>"
        lines.append(f"using {mangled_name} = {full_type};")
    return "\n".join(sorted(lines))


def write_manifest(discovered, build_dir):
    """Write the NCollection manifest JSON for the link step.

    Every declaration carries `source_classes: list[str]` (sorted,
    deduped) listing the bound class names whose method/field signatures
    caused the NCollection to be discovered. The link step reads this to
    intersect against the consumer YAML's reachable class scope; entries
    with empty intersection are dropped from the per-YAML link command.
    """
    manifest = {
        "symbols": sorted(entry[0] for entry in discovered),
        "declarations": [],
    }
    for entry in sorted(discovered):
        # Entries are 4-tuples: (mangled, container, args, sources).
        mangled, container, args, sources = entry
        manifest["declarations"].append({
            "mangled_name": mangled,
            "container": container,
            "args": list(args),
            "source_classes": list(sources),
        })
    os.makedirs(build_dir, exist_ok=True)
    manifest_path = os.path.join(build_dir, "ncollection-manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"NCollection manifest: {len(discovered)} types -> {manifest_path}", flush=True)
    return manifest_path
