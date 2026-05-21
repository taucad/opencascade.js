"""Built-in type whitelists and primitive type predicates.

Extracted from `src/bindings.py` lines 70-107, 424-427 as part of Phase 1
PR 1.3 of the OCJS Bindgen Modular Refactor. The whitelists mirror the C++
language type catalogue (cppreference.com/w/cpp/language/types) and are kept
as plain lists rather than frozensets because some downstream call sites use
`in` against the canonical-type spelling (which has stable string form).

Behaviour preserved bit-for-bit from the legacy module.
"""

from __future__ import annotations

import clang.cindex

# Per https://en.cppreference.com/w/cpp/language/types
builtInTypes: list[str] = [
    # Integer types
    "int",
    "short",
    "short int",
    "signed short",
    "signed short int",
    "unsigned short",
    "unsigned short int",
    "int",
    "signed",
    "signed int",
    "unsigned",
    "unsigned int",
    "long",
    "long int",
    "signed long",
    "signed long int",
    "unsigned long",
    "unsigned long int",
    "long long",
    "long long int",
    "signed long long",
    "signed long long int",
    "unsigned long long",
    "unsigned long long int",
    # Boolean
    "bool",
    # Character
    "char",
    "signed char",
    "unsigned char",
    "wchar_t",
    "char16_t",
    "char32_t",
    "char8_t",
    # Floating point
    "float",
    "double",
    "long double",
]

cStringTypes: list[str] = [
    "const char *",
    "const char *const",
    "char *",
    "char *const",
]

unbindablePointerTypes: list[str] = [
    "const char16_t *",
    "const char16_t *const",
    "char16_t *",
    "char16_t *const",
]


def isCString(type) -> bool:
    """True iff `type`'s canonical spelling matches a C-string variant."""
    return type.get_canonical().spelling in cStringTypes


def isRawPointerParam(arg_type) -> bool:
    """True iff `arg_type` canonicalises to a raw pointer.

    Raw pointers cannot be passed from JS via `val::as<T*>()` — Embind forbids
    it — so any C++ argument whose canonical type is a pointer must take a
    different path (val-as-handle, val-as-array, or full elision).
    """
    return arg_type.get_canonical().kind == clang.cindex.TypeKind.POINTER
