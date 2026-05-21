"""Template-type resolver strategy.

Mirrors the legacy ``TypescriptBindings._resolve_template_type`` and
``_resolve_template_arg`` line-for-line. Behaviour preserved bit-for-bit;
the move is purely physical so canonical-key augmentation can land here
in one place.
"""

from __future__ import annotations

import clang.cindex


def resolve_template_type(self, clang_type, templateDecl=None, templateArgs=None):
    """Resolve template types via AST using generic C++ type resolution.

    Resolution order:

    1. Check original declaration spelling against known typedefs (catches using-aliases)
    2. Canonicalize if needed, then resolve via:

       a. ``handle<T>`` unwrapping (smart pointer)
       b. ``Vec`` tuple mapping (fixed-arity numeric vectors)
       c. Template class itself is exported or a known typedef name
       d. STL type mappings
       e. General typedef/using-alias lookup (resolves ALL container types)

    3. Generic guardrail: collect unrecognized template types
    """
    from ocjs_bindgen.codegen.bindings import TypescriptBindings

    if TypescriptBindings._known_typedef_names is None:
        TypescriptBindings._known_typedef_names = set()
        for td in self.tuInfo.typedefs:
            TypescriptBindings._known_typedef_names.add(td.spelling)
        for td in self.tuInfo.templateTypedefs:
            TypescriptBindings._known_typedef_names.add(td.spelling)

    t = clang_type
    numArgs = t.get_num_template_arguments()
    if numArgs <= 0:
        orig_decl = clang_type.get_declaration()
        if orig_decl and orig_decl.spelling:
            # Typedefs whose canonical type is a builtin primitive must NOT be
            # returned verbatim — `size_t`, `uint8_t`, `Standard_Real`, etc.
            # all resolve to numeric/string TS types via the downstream
            # builtin path.
            canonical_kind = clang_type.get_canonical().kind
            is_primitive_typedef = (
                canonical_kind in self._BUILTIN_NUMERIC_KINDS
                or canonical_kind in self._BUILTIN_STRING_KINDS
                or canonical_kind == clang.cindex.TypeKind.BOOL
                or canonical_kind == clang.cindex.TypeKind.VOID
                or orig_decl.spelling in self._NUMERIC_TYPES
                or orig_decl.spelling in self._STRING_TYPES
                or orig_decl.spelling in self._BOOLEAN_TYPES
            )
            if not is_primitive_typedef:
                if orig_decl.spelling in self.exports:
                    return orig_decl.spelling
                # Do NOT return a typedef name that isn't actually emitted as
                # an export — that produces a dangling reference (TS2304).
                # Fall through to the canonical type so unbound typedefs
                # resolve to the underlying class.
        t = clang_type.get_canonical()
        numArgs = t.get_num_template_arguments()
        if numArgs <= 0:
            return None

    decl = t.get_declaration()
    if not decl:
        return None
    container = self._CONTAINER_ALIASES.get(decl.spelling, decl.spelling)

    if (
        container not in self.exports
        and container not in self._VEC_TUPLES
        and container != "handle"
    ):
        if decl.kind in (
            clang.cindex.CursorKind.TYPEDEF_DECL,
            clang.cindex.CursorKind.TYPE_ALIAS_DECL,
        ):
            canonical_t = t.get_canonical()
            canonical_decl = canonical_t.get_declaration()
            if (
                canonical_decl
                and canonical_decl.spelling
                and canonical_decl.spelling != container
            ):
                container = self._CONTAINER_ALIASES.get(
                    canonical_decl.spelling, canonical_decl.spelling
                )
                t = canonical_t

    parent = decl.semantic_parent
    if container == "handle" and parent and parent.spelling in ("opencascade", "occ"):
        inner = t.get_template_argument_type(0)
        if inner.spelling:
            return self.resolve_type(inner, templateDecl, templateArgs)
        canonical_inner = inner.get_canonical()
        if canonical_inner.spelling:
            return self.resolve_type(canonical_inner, templateDecl, templateArgs)
        decl_inner = inner.get_declaration()
        if decl_inner and decl_inner.spelling and decl_inner.spelling in self.exports:
            return decl_inner.spelling
        self._collect_any("handle_inner_unresolvable", t.spelling)
        return "any"

    if container in self._VEC_TUPLES:
        return self._VEC_TUPLES[container]

    # Only return container if it actually appears as an emitted export.
    # Typedef names like `XCAFDoc_PartId` (alias for TCollection_AsciiString)
    # are NOT emitted, so returning them produces TS2304 dangling references.
    # Fall through to the canonical-fallback resolution path instead.
    if container in self.exports or container in TypescriptBindings._known_export_names:
        return container

    stl_result = self._resolve_stl_type(container, t, templateDecl, templateArgs)
    if stl_result is not None:
        return stl_result

    typedef_name = self._find_typedef_for_container(container, t)
    if typedef_name:
        return typedef_name

    numArgs_resolve = t.get_num_template_arguments()
    if numArgs_resolve > 0:
        resolved_args = []
        all_resolved = True
        for i in range(numArgs_resolve):
            arg_type = t.get_template_argument_type(i)
            arg_spelling = arg_type.spelling if arg_type else ""
            arg_canonical = arg_type.get_canonical().spelling if arg_type else ""
            if not arg_type or (not arg_spelling and not arg_canonical):
                all_resolved = False
                break
            resolved_arg = self._resolve_template_arg(arg_type, templateDecl, templateArgs)
            if not resolved_arg or resolved_arg == "any" or "type-parameter-" in resolved_arg:
                all_resolved = False
                break
            resolved_args.append(resolved_arg)
        if all_resolved and resolved_args:
            mangled = container + "_" + "_".join(resolved_args)
            if mangled in self.exports or mangled in TypescriptBindings._known_export_names:
                return mangled

    self._collect_any("unrecognized_template", t.spelling)
    return "any"


def resolve_template_arg(self, arg_type, templateDecl=None, templateArgs=None):
    """Resolve a single template argument type, handling ``type-parameter-N-M`` substitution."""
    import re as _re

    from ocjs_bindgen.codegen.bindings import Bindings

    canonical = arg_type.get_canonical()
    spelling = canonical.spelling if canonical.spelling else arg_type.spelling
    if not spelling:
        spelling = arg_type.spelling
    if templateArgs and spelling and "type-parameter-" in spelling:
        if Bindings._TYPE_PARAM_RE is None:
            Bindings._TYPE_PARAM_RE = _re.compile(r"type-parameter-(\d+)-(\d+)")
        m = Bindings._TYPE_PARAM_RE.search(spelling)
        if m:
            depth, index = int(m.group(1)), int(m.group(2))
            if depth == 0:
                argValues = list(templateArgs.values())
                if index < len(argValues):
                    concrete = argValues[index]
                    resolved = self.resolve_type(concrete, templateDecl, templateArgs)
                    if resolved and resolved != "any":
                        return resolved
    result = self.resolve_type(arg_type, templateDecl, templateArgs)
    if result and result != "any" and "type-parameter-" not in result:
        return result
    return None
