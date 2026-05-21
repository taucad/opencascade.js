"""Canonical-fallback resolver strategy.

The tail of the legacy ``TypescriptBindings.resolve_type`` — when every
prior strategy returns ``None`` the resolver falls back to canonical-name
matching, builtin-kind mapping, qualified-member walking and a final
``unknown`` sink (which feeds the diagnostics report).

The body is a literal extraction of lines 4455-4490 of the pre-refactor
``resolve_type`` so behaviour is byte-identical. PR 2.6 will revisit the
``unknown`` sink under a composable rewriter chain.
"""

from __future__ import annotations


def resolve_canonical_fallback(self, t, decl, canonical, kind, templateDecl=None, templateArgs=None):
    """Canonical-name / builtin-kind / qualified-member fallback path.

    Mirrors the tail of the legacy ``resolve_type``. Returns the resolved
    TypeScript type string. Always returns a value (the final sink is
    ``"unknown"``).
    """
    from ocjs_bindgen.codegen.bindings import TypescriptBindings

    spelling = self._strip_type_qualifiers_str(t.spelling)
    resolved = self.resolveWithCanonicalFallback(spelling, t, templateDecl, templateArgs)
    resolved = self._strip_type_qualifiers_str(resolved)
    resolved = self.convertBuiltinTypes(resolved)

    if resolved in ("number", "string", "boolean", "void"):
        return resolved
    if (
        resolved
        and resolved != ""
        and "(" not in resolved
        and ":" not in resolved
        and "<" not in resolved
        and "[" not in resolved
        and self._is_known_export_name(resolved)
    ):
        return resolved

    if resolved and "::" in resolved and "(" not in resolved:
        member_result = self._resolve_qualified_member_type(resolved, templateDecl, templateArgs)
        if member_result:
            return member_result

    canonical_spelling = self._strip_type_qualifiers_str(canonical.spelling)
    canonical_spelling = self.convertBuiltinTypes(canonical_spelling)
    if canonical_spelling in ("number", "string", "boolean", "void"):
        return canonical_spelling
    if (
        canonical_spelling
        and "(" not in canonical_spelling
        and ":" not in canonical_spelling
        and "<" not in canonical_spelling
    ):
        if (
            canonical_spelling in self.exports
            or canonical_spelling in TypescriptBindings._known_export_names
        ):
            return canonical_spelling

    if (
        decl
        and decl.spelling
        and (decl.spelling in self.exports or decl.spelling in TypescriptBindings._known_export_names)
    ):
        return decl.spelling

    self._collect_any("unbound_reference", f"{t.spelling} (canonical: {canonical.spelling})")
    return "unknown"
