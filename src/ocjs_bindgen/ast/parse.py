"""libclang translation-unit construction.

Single source of truth for `clang.cindex.Index.create()` + `index.parse()`.
Every other layer of the bindgen consumes the resulting TU through `TuInfo`
in `cursors.py`; nothing else should reach for libclang directly.

Behaviour preserved bit-for-bit from the legacy `TuInfo.parse` function as of
Phase 1 PR 1.2 of the OCJS Bindgen Modular Refactor.
"""

from __future__ import annotations

import clang.cindex

from ocjs_bindgen.config.paths import includePathArgs, ocAllIncludeStatements


def parse(additionalCppCode: str = ""):
    """Build the synthetic `myMain.h` TU that drives all bindgen.

    The TU's primary file is a virtual `myMain.h` whose contents are the
    sorted list of OCCT include statements (from
    `ocjs_bindgen.config.paths.ocAllIncludeStatements`) followed by any
    additional C++ supplied by the caller (e.g. NCollection `using`-decls
    emitted by the Phase 1 discovery scan, or YAML `additionalCppCode`).

    Diagnostics from libclang are printed verbatim — they are useful when
    debugging include-path or PCH issues but do not influence the bindgen
    output.
    """
    index = clang.cindex.Index.create()
    translationUnit = index.parse(
        "myMain.h",
        [
            "-x",
            "c++",
            "-stdlib=libc++",
            # Suppress libclang's default C++ stdlib search paths. Without
            # this, on Linux libclang ALSO adds GCC's libstdc++ paths
            # (/usr/lib/gcc/<triple>/N/include/c++/N/), which conflict with
            # the vendored LLVM 17 libc++ headers: <stdlib.h> resolves first
            # to libstdc++'s wrapper, which redeclares names the libc++
            # `__config` block reserves, producing thousands of cascading
            # "no member named X in namespace 'std'" errors and degrading
            # template returns to ': int' (Phase 7 failure cascade). Apple
            # macOS is unaffected because clang's default there only
            # searches Apple's libc++, which our explicit -I supersedes.
            "-nostdinc++",
            "-D__EMSCRIPTEN__",
        ]
        + includePathArgs,
        [["myMain.h", ocAllIncludeStatements + "\n" + additionalCppCode]],
    )

    if len(translationUnit.diagnostics) > 0:
        print("Diagnostic Messages:")
        for d in translationUnit.diagnostics:
            print("  " + d.format())

    return translationUnit
