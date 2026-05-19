#!/usr/bin/python3

import hashlib
import os
import re
import subprocess
import json
import time
import multiprocessing
from itertools import chain
import yaml
import shutil
from cerberus import Validator
from argparse import ArgumentParser
from ocjs_bindgen.config.paths import OCJS_ROOT, BUILD_DIR, getFlatIncludePaths, PCH_FILE
from ocjs_bindgen.config.flags import WASM_EXCEPTION_FLAGS, USE_WASM_EXCEPTIONS, SIMD_FLAGS, EXTRA_COMPILE_FLAGS, validate_build_flags, BuildFlagMismatch
from filter.filterPackages import filterPackages
try:
    import provenance as prov
except ImportError:
    prov = None

_yaml_config_hash = ""

# Strict-types gate (R2.2) — when `OCJS_STRICT_TYPES=1` (default in the Docker
# image, opt-in on host builds) the link step refuses to ship a `.d.ts` that
# contains the silent failure modes produced when a reachable class is excluded
# from the build: a rewritten `: unknown` (the link-time post-processor
# detected an undeclared reference and substituted `unknown`) OR an
# `unbound_reference` diagnostic collected during codegen. Both signal that
# the YAML scope is missing a class some bound class's method signature
# references — typically a NCollection the R2 filter dropped because its R1
# source_classes tag didn't intersect the YAML scope, but in fact reachable
# through a method param/return on an in-scope class. The action is always
# the same: fix `_compute_yaml_class_scope` to include the reachable class.
#
# Tunable so that diagnostic non-shipping builds can opt out cleanly.
_STRICT_TYPES_REWRITE_BUDGET = 0
# Tokens used to detect `: unknown;` / `: unknown)` / `<unknown,...>` rewrites
# without false-positives on `Record<string, unknown>` (which appears verbatim
# in the hand-written `init(options?: ...)` signature and is NOT a rewrite).
_UNKNOWN_TOKEN_RE = re.compile(
  r"(?<![A-Za-z0-9_])unknown(?![A-Za-z0-9_])"
)
_RECORD_STRING_UNKNOWN_LITERAL = "Record<string, unknown>"


def _count_unknown_tokens(source: str) -> int:
  """Return the number of bare `unknown` identifier tokens in `source`,
  excluding the hand-written `Record<string, unknown>` init signature which
  contributes a known constant baseline of one occurrence per build."""
  hits = len(_UNKNOWN_TOKEN_RE.findall(source))
  # Subtract the literal that's emitted unconditionally by the init signature
  # template so a clean build reports zero rewrites instead of two.
  hits -= source.count(_RECORD_STRING_UNKNOWN_LITERAL)
  return max(0, hits)


def _enforce_strict_types_gate(
  *,
  typescriptDefinitionOutput: str,
  rewrites_to_unknown: int,
  diagnostics,
) -> None:
  """Fail-loud guard against silently broken .d.ts output.

  Runs after `_replace_undeclared_with_unknown` has finished its pass. When
  `OCJS_STRICT_TYPES=1` (Docker default), any rewrite-to-unknown or any
  unbound_reference diagnostic raises a self-contained, path-agnostic,
  actionable `RuntimeError` so the build fails before a poisoned artifact
  ships to consumers. The error message names the exact source of the bug
  (R2 filter under-reaching) and the exact file/function to fix.
  """
  if os.environ.get("OCJS_STRICT_TYPES") != "1":
    return
  unbound = diagnostics.get("unbound_reference") if diagnostics else None
  unbound = unbound or {}
  if rewrites_to_unknown <= _STRICT_TYPES_REWRITE_BUDGET and not unbound:
    return

  # Print a triage summary BEFORE raising so the engineer doesn't need to
  # re-run with OCJS_STRICT_TYPES=0 just to see what failed. Top 20 unbound
  # references by occurrence count, then a budget overrun line.
  print("\n=== OCJS_STRICT_TYPES gate failure summary ===", flush=True)
  print(
    f"  rewrites to 'unknown': {rewrites_to_unknown} "
    f"(budget: {_STRICT_TYPES_REWRITE_BUDGET})",
    flush=True,
  )
  print(f"  unbound class references: {len(unbound)} unique", flush=True)
  if unbound:
    print("  Top offenders (type spelling -> count):", flush=True)
    for type_info, count in sorted(unbound.items(), key=lambda x: -x[1])[:20]:
      print(f"    {type_info} ({count}x)", flush=True)
    if len(unbound) > 20:
      print(f"    ... and {len(unbound) - 20} more", flush=True)
  # Sample up to 10 lines that contain a freshly-rewritten `: unknown` so
  # the engineer can grep for them in the output. We can't reliably tell
  # which `: unknown` lines are new vs original after the rewrite is done,
  # so we list ALL `: unknown` occurrences as candidates — the budget
  # already filtered out the always-zero clean case.
  if rewrites_to_unknown > _STRICT_TYPES_REWRITE_BUDGET:
    candidates = []
    for line in typescriptDefinitionOutput.splitlines():
      if _UNKNOWN_TOKEN_RE.search(line) and _RECORD_STRING_UNKNOWN_LITERAL not in line:
        candidates.append(line.strip())
        if len(candidates) >= 10:
          break
    if candidates:
      print("  Sample lines with `unknown` rewrites:", flush=True)
      for c in candidates:
        print(f"    {c}", flush=True)

  raise RuntimeError(
    "Strict-types gate (OCJS_STRICT_TYPES=1) refused to ship the .d.ts: "
    f"detected {rewrites_to_unknown} method signatures whose types were "
    f"rewritten to bare 'unknown', and {len(unbound)} unbound class "
    "references collected during link-time codegen. This is the silent "
    "failure mode where the R2 NCollection link-time filter excludes a "
    "class that is genuinely reachable through an in-scope class's method "
    "signature, and the d.ts post-processor neutralises the dangling "
    "reference to keep TS valid — leaving consumers with TypeScript that "
    "compiles cleanly but crashes at runtime.\n"
    "\n"
    "Action: extend `_compute_yaml_class_scope` in "
    "ocjs_bindgen.link.yaml_build to include every class referenced by an "
    "in-scope class's method signatures, then re-run. The most common cause "
    "is a NCollection mangled name (e.g. NCollection_HArray1_gp_Pnt) "
    "appearing in the d.ts of an in-scope class but missing from the YAML "
    "scope's method-signature lift pass; the existing _NCOLLECTION_TOKEN_RE "
    "lift covers NCollection_ types but other reachable class families may "
    "need the same treatment. Set OCJS_STRICT_TYPES=0 to bypass for "
    "diagnostic non-shipping builds only — DO NOT ship the resulting "
    "artifacts to consumers."
  )


# Identifier-bounded regex used by `_compute_yaml_class_scope` to lift NCollection
# mentions out of in-scope class fragments' TypeScript signatures. Token must
# start with `NCollection_` on a word boundary and contain only word characters;
# matches stop at template angle brackets, parentheses, whitespace, or
# punctuation. The trailing `\b` allows the existing mangled spellings like
# `NCollection_DataMap_TCollection_AsciiString_TCollection_AsciiString` to be
# captured wholesale, including the auto-discovered nested forms
# (`NCollection_Array1_NCollection_Vec3_float`) — both shapes appear verbatim
# in the d.ts fragments and both are valid manifest mangled_name values that
# the R2 filter must keep when reachable through a method signature.
_NCOLLECTION_TOKEN_RE = re.compile(r"\bNCollection_[A-Za-z0-9_]+\b")

# PR 2.6 — link rewriter pipeline lives in ocjs_bindgen.link.rewrite.
# Re-export the legacy entry point so the merge driver below keeps its
# original call shape; the implementation is now a composable
# `LinkRewriter` chain that future audit passes (R6's
# `RedundantUnknownAliasDropper`) can plug into without re-touching the
# link driver.
from ocjs_bindgen.link.rewrite import (  # noqa: E402
  replace_undeclared_with_unknown as _replace_undeclared_with_unknown,
)


# Forward-declaration + inline-namespace preamble injected into BOTH the
# additionalBindCode TU AND every generated binding TU (via embindPreamble in
# generateBindings.py). The EM_JS *definition* lives only in the
# additionalBindCode TU (a regular C function — one definition only) so the
# linker resolves the symbol once; the per-binding TUs see the namespace
# helpers and an extern "C" forward decl. Without this in the binding
# preamble, every binding that references `::ocjs::getRbvDispose()` fails to
# compile with "no member named 'ocjs' in the global namespace" and the
# linker dead-code-eliminates the EM_JS symbol from the final JS glue.
OCJS_RBV_PREAMBLE = r"""
#include <emscripten/val.h>

extern "C" void ocjs_register_rbv_dispose();

namespace ocjs {
  // Magic-static + cached val: registration runs exactly once per TU on first
  // call, after the emscripten runtime is up. Subsequent calls return the
  // cached val handle directly — no JS<->WASM crossings per RBV call.
  // `ocjs_register_rbv_dispose` is idempotent (assigns to Module), so multiple
  // TU-local registrations are safe.
  inline ::emscripten::val getRbvDispose() {
    static const auto _init = []() { ocjs_register_rbv_dispose(); return 0; }();
    (void)_init;
    static ::emscripten::val cached = ::emscripten::val::module_property("__ocjsRbvDispose__");
    return cached;
  }
  inline ::emscripten::val getSymbolDispose() {
    static ::emscripten::val cached = ::emscripten::val::global("Symbol")["dispose"];
    return cached;
  }
}
"""

BUILTIN_ADDITIONAL_BIND_CODE = r"""
#include <TopoDS.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_CompSolid.hxx>
#include <TopoDS_Compound.hxx>
#include <TColStd_IndexedDataMapOfStringString.hxx>
#include <Standard_Failure.hxx>
#include <emscripten/em_js.h>
""" + OCJS_RBV_PREAMBLE + r"""

// Shared disposer for val::object() RBV containers. Authored via EM_JS so the
// JS body is emitted at link time (CSP-strict / -sDYNAMIC_EXECUTION=0 compatible).
// The disposer is UNBOUND — `using` invokes it as a method call so `this` is
// naturally the container, sidestepping the V8 13.6 Function.prototype.bind
// `using` rejection. See docs/research/ocjs-unified-rbv-blueprint.md Appendix 5.
//
// Idempotency and alias-safety: Embind retains the `.delete` method on the
// prototype after the underlying instance is destroyed, so a naïve
// `typeof v.delete === 'function'` guard does NOT prevent a second call from
// throwing `BindingError: <T> instance already deleted`. Two cases hit this
// in practice: (a) a caller invokes `result[Symbol.dispose]()` manually and
// then `using` re-disposes at scope exit; (b) Input-Passthrough RBV legitimately
// produces aliased handles across sibling containers that disposed earlier.
// We make the disposer truly one-shot by (1) swallowing a redundant `.delete()`
// throw and (2) clearing the slot via `this[k] = undefined` so subsequent
// iterations find nothing to delete.
EM_JS(void, ocjs_register_rbv_dispose, (), {
  Module["__ocjsRbvDispose__"] = function () {
    for (const k in this) {
      if (Object.prototype.hasOwnProperty.call(this, k)) {
        const v = this[k];
        if (v && typeof v.delete === 'function') {
          try { v.delete(); } catch {}
          this[k] = undefined;
        }
      }
    }
  };
});

struct TopoDS_Bind_ {};
class OCJS {
public:
  static Standard_Failure* getStandard_FailureData(intptr_t exceptionPtr) {
    return reinterpret_cast<Standard_Failure*>(exceptionPtr);
  }
  static bool exceptionsEnabled() {
#ifdef OCJS_EXCEPTIONS_ENABLED
    return true;
#else
    return false;
#endif
  }
};
using namespace emscripten;
EMSCRIPTEN_BINDINGS(ocjs_builtins) {
  class_<OCJS>("OCJS")
    .class_function("getStandard_FailureData", &OCJS::getStandard_FailureData, allow_raw_pointers())
    .class_function("exceptionsEnabled", &OCJS::exceptionsEnabled)
    ;
  class_<NCollection_IndexedDataMap<TCollection_AsciiString, TCollection_AsciiString>>("TColStd_IndexedDataMapOfStringString")
    .constructor<>()
    ;
  class_<TopoDS_Bind_>("TopoDS")
    .class_function("Edge", optional_override([](const TopoDS_Shape& s) -> TopoDS_Edge { return TopoDS::Edge(s); }))
    .class_function("Wire", optional_override([](const TopoDS_Shape& s) -> TopoDS_Wire { return TopoDS::Wire(s); }))
    .class_function("Face", optional_override([](const TopoDS_Shape& s) -> TopoDS_Face { return TopoDS::Face(s); }))
    .class_function("Vertex", optional_override([](const TopoDS_Shape& s) -> TopoDS_Vertex { return TopoDS::Vertex(s); }))
    .class_function("Shell", optional_override([](const TopoDS_Shape& s) -> TopoDS_Shell { return TopoDS::Shell(s); }))
    .class_function("Solid", optional_override([](const TopoDS_Shape& s) -> TopoDS_Solid { return TopoDS::Solid(s); }))
    .class_function("Compound", optional_override([](const TopoDS_Shape& s) -> TopoDS_Compound { return TopoDS::Compound(s); }))
    ;
}
"""


def _collect_compiled_symbols(libraryBasePath) -> set:
  compiled = set()
  compiled_dir = libraryBasePath + "/compiled-bindings"
  if not os.path.isdir(compiled_dir):
    compiled_dir = libraryBasePath + "/bindings"
  for dirpath, dirnames, filenames in os.walk(compiled_dir):
    for item in filenames:
      if item.endswith(".cpp.o"):
        compiled.add(item[:-6])
  return compiled

def verifyBindings(bindings, libraryBasePath) -> bool:
  compiled = _collect_compiled_symbols(libraryBasePath)
  missing = [b for b in bindings if b["symbol"] not in compiled]
  if missing:
    missing_names = [b["symbol"] for b in missing]
    print(f"WARNING: {len(missing)} of {len(bindings)} requested bindings have no compiled .o file:", flush=True)
    for name in sorted(missing_names)[:20]:
      print(f"  - {name}", flush=True)
    if len(missing_names) > 20:
      print(f"  ... and {len(missing_names) - 20} more", flush=True)
    strict = os.environ.get("OCJS_STRICT_VERIFY", "0") == "1"
    if strict:
      raise Exception(f"{len(missing)} requested bindings missing. Set OCJS_STRICT_VERIFY=0 to proceed with available bindings.")

# R2 — `_auto_symbols` is now a per-build set computed inside `main()` from
# the intersection of the global manifest with the consumer YAML's reachable
# class scope (R1 source tagging + ancestor lift + custom sentinel). The
# module-level binding remains as the default `shouldProcessSymbol` reads
# from until `main()` overrides it; an empty default ensures the legacy
# "include every auto-discovered NCollection" behaviour is *not* available
# unless `main()` runs.
_auto_symbols: set = set()


def _load_full_manifest_symbols(build_dir) -> set:
  """Return EVERY mangled name in `ncollection-manifest.json`, unfiltered.

  Used only by the stale-fragment cleanup in `main()` — a fragment whose
  stem matches any entry in the global manifest is non-stale across runs
  (even if it's not in the current YAML's reachable set). The per-YAML
  link-time filter (`_filter_auto_symbols_by_scope`) is a separate
  concern; the cleanup uses this broader test so cross-YAML cache reuse
  of auto-discovered NCollection fragments stays correct.
  """
  manifest_path = os.path.join(build_dir, "ncollection-manifest.json")
  if os.path.isfile(manifest_path):
    with open(manifest_path) as f:
      return set(json.load(f).get("symbols", []))
  return set()


# R3 — kept in sync with `discover.CUSTOM_CODE_SOURCE_TAG`. Duplicated as
# a literal here to avoid forcing the link driver to import from discover
# (which would transitively pull libclang into every link).
_CUSTOM_CODE_SOURCE_TAG = "__custom__"


def _compute_yaml_class_scope(buildConfig, libraryBasePath) -> set:
  """Return the set of class names reachable from the consumer YAML.

  Scope =
    - mainBuild.bindings ∪ extraBuilds.bindings (the symbols the consumer
      explicitly requests),
    - the ancestor chains serialised in each matching `*.d.ts.json`
      fragment (so a YAML that binds `BRepBuilderAPI_MakeEdge` automatically
      brings in `BRepBuilderAPI_MakeShape` and `BRepBuilderAPI_Command` —
      classes whose NCollection-touching methods are inherited and therefore
      reachable from JS),
    - every custom-code class compiled into `build/bindings/myMain.h/`
      (these classes are linked into the bundle by the additionalCppCode
      pipeline, so any NCollection they reference is reachable),
    - the `__custom__` sentinel (R3) so future discoveries tagged with
      `CUSTOM_CODE_SOURCE_TAG` survive unconditionally.

  The link-time filter (`_filter_auto_symbols_by_scope`) keeps a manifest
  entry iff at least one of its `source_classes` is in this set.
  """
  scope: set = set()
  for build_block in [buildConfig["mainBuild"], *buildConfig.get("extraBuilds", [])]:
    scope.update(b["symbol"] for b in build_block["bindings"])

  bindings_root = os.path.join(libraryBasePath, "bindings")
  # Ancestor lift — walk every `.d.ts.json` fragment and, if its stem name is
  # in scope, union its serialised `ancestors` chains into scope. We scan the
  # whole tree once (O(|fragments|)) rather than per-symbol because the
  # bindings tree has no symbol→path index.
  #
  # Method-signature lift (R2.1) — in the same pass, scan each in-scope
  # fragment's TS payload for `NCollection_*` mentions and union them into
  # scope. This catches the failure mode where an in-scope class has a
  # method returning or taking an NCollection whose R1 `source_classes` tag
  # does NOT include the in-scope class (the typedef-alias-origin is some
  # other OCCT class like `TColgp_HArray1OfPnt`), which the source-only
  # intersection in `_filter_auto_symbols_by_scope` would otherwise drop —
  # silently downgrading the method's TS signature to `: number` / `: unknown`.
  # The token regex is identifier-bounded so embedded NCollection mentions
  # inside parameter spellings (e.g. `Handle_NCollection_...`) are caught.
  scope_at_start = frozenset(scope)
  if os.path.isdir(bindings_root):
    for dirpath, _dirnames, filenames in os.walk(bindings_root):
      for fname in filenames:
        if not fname.endswith(".d.ts.json"):
          continue
        stem = fname[:-len(".d.ts.json")]
        if stem not in scope_at_start:
          continue
        try:
          with open(os.path.join(dirpath, fname)) as f:
            frag = json.load(f)
        except Exception:
          continue
        for ancestor_chain in (frag.get("ancestors") or {}).values():
          if isinstance(ancestor_chain, list):
            scope.update(ancestor_chain)
        dts_payload = frag.get(".d.ts", "") or ""
        if "NCollection_" in dts_payload:
          scope.update(_NCOLLECTION_TOKEN_RE.findall(dts_payload))

  # Custom-code classes — every `build/bindings/myMain.h/*.d.ts.json` was
  # produced by the consumer's `additionalCppCode` pipeline OR by the
  # auto-NCollection bind generator (cross-YAML cache reuse). Only the
  # former are consumer-defined classes whose methods can reference
  # NCollections; skip `NCollection_*` stems to keep scope semantically
  # tight (R2 source intersections never match an NCollection name —
  # source_classes are always OCCT class names — so the prefix-skip is
  # purely cosmetic but stops misleading "|scope|=…" log inflation).
  custom_root = os.path.join(bindings_root, "myMain.h")
  if os.path.isdir(custom_root):
    for fname in os.listdir(custom_root):
      if not fname.endswith(".d.ts.json"):
        continue
      stem = fname[:-len(".d.ts.json")]
      if stem.startswith("NCollection_"):
        continue
      scope.add(stem)

  scope.add(_CUSTOM_CODE_SOURCE_TAG)
  return scope


def _filter_auto_symbols_by_scope(manifest_path: str, yaml_scope: set) -> set:
  """Return the manifest-entry subset whose `source_classes` intersect
  `yaml_scope`, plus the transitive closure over nested
  ``NCollection<NCollection<…>>`` references in `args`.

  Fail-loud if any manifest declaration is missing the R1 `source_classes`
  field — there is no backwards-compat fallback (per audit's
  "no shortcuts on unreleased APIs" principle); the only valid response is
  to regenerate the manifest via `nx run ocjs:generate`.
  """
  if not os.path.isfile(manifest_path):
    return set()
  with open(manifest_path) as f:
    manifest = json.load(f)
  decls = manifest.get("declarations", [])
  missing_src = [d["mangled_name"] for d in decls if "source_classes" not in d]
  if missing_src:
    raise RuntimeError(
      f"ncollection-manifest.json is missing R1 'source_classes' on "
      f"{len(missing_src)} entries (first: {missing_src[0]}). "
      f"Regenerate via `nx run ocjs:generate` to pick up the new schema."
    )
  kept: set = set()
  for d in decls:
    # Keep-condition 1 — the entry's R1 source-class tag (where the
    # typedef alias is defined, e.g. `TColgp_HArray1OfPnt`) intersects
    # the YAML's reachable-class scope. Catches consumers that bind the
    # alias-origin class explicitly.
    if set(d["source_classes"]) & yaml_scope:
      kept.add(d["mangled_name"])
      continue
    # Keep-condition 2 (R2.1 — method-signature reachability) — the
    # entry's mangled name is itself in scope because an in-scope class's
    # method signature mentions it. This catches the failure mode where a
    # NCollection is reachable through a return/param type but whose R1
    # source_classes never name the in-scope class (e.g. `Poly_Triangulation`
    # exposes `MapNodeArray(): NCollection_HArray1_gp_Pnt` but the latter's
    # source_classes is `[TColgp_HArray1OfPnt]`). `_compute_yaml_class_scope`
    # lifts these mentions into `yaml_scope` via `_NCOLLECTION_TOKEN_RE` so
    # the intersection here resolves correctly without re-parsing C++.
    if d["mangled_name"] in yaml_scope:
      kept.add(d["mangled_name"])
  # Transitive closure: NCollection<…NCollection_X…> is kept iff every
  # nested NCollection arg is itself kept. The args field stores raw
  # template-arg spellings; nested NCollections appear with the
  # `NCollection_` mangled prefix as their argument text only when the
  # outer NCollection is templated on another mangled alias — most of
  # the time args reference primitive OCCT classes, so this loop
  # typically runs once and exits.
  changed = True
  while changed:
    changed = False
    for d in decls:
      if d["mangled_name"] in kept:
        continue
      nested = {a for a in d["args"] if a.startswith("NCollection_")}
      if nested and nested.issubset(kept):
        kept.add(d["mangled_name"])
        changed = True
  return kept

# R6 (post-R1 cleanup) — The historical `_EMBIND_OCTYPE_ALIAS_TYPENAME_SKIPS`
# guard list existed to block alias-typedef NCollections (BRepGraph_FacesOfWire,
# BRepGraph_WiresOfEdge, BRepGraph_Compounds*) from being registered twice
# in Embind. Once R5's `_dedupe_by_canonical_args` in `discover.py` started
# collapsing every alias form to its canonical (container, canonical-args)
# key, those names stopped appearing as `mangled_name` entries in the
# manifest entirely — verified empirically against `build/ncollection-manifest.json`.
# The constant and its `shouldProcessSymbol` branch were dead code; removed.
def shouldProcessSymbol(symbol: str, bindings) -> bool:
  if len(bindings) == 0:
    return True
  if symbol in _auto_symbols:
    return True
  entry = next((b for b in bindings if b["symbol"] == symbol), None)
  if not entry is None:
    return True
  return False

def _warn_consistency(build):
  """Warn (non-fatal) if consumer emccFlags and compile config are mismatched."""
  import sys
  yaml_flags = build.get("emccFlags", [])
  yaml_has_wasm_exc = "-fwasm-exceptions" in yaml_flags
  yaml_has_js_exc = "-fexceptions" in yaml_flags
  yaml_disables_exc = any("-sDISABLE_EXCEPTION_CATCHING=1" in f for f in yaml_flags)
  yaml_has_simd = "-msimd128" in yaml_flags
  env_exc = os.environ.get("OCJS_EXCEPTIONS", "0") == "1"
  env_simd = os.environ.get("OCJS_SIMD", "0") == "1"

  if env_exc and yaml_disables_exc:
    print(
      f"WARNING: Compiled with OCJS_EXCEPTIONS=1 but emccFlags has -sDISABLE_EXCEPTION_CATCHING=1. "
      f"These are contradictory -- link may not handle exceptions correctly.",
      file=sys.stderr, flush=True,
    )
  if not env_exc and (yaml_has_wasm_exc or yaml_has_js_exc):
    print(
      f"WARNING: Compiled with OCJS_EXCEPTIONS=0 but emccFlags has exception flags. "
      f"Link-time exception support without compile-time support may cause issues.",
      file=sys.stderr, flush=True,
    )
  if env_simd and not yaml_has_simd:
    print(
      f"WARNING: Compiled with OCJS_SIMD=1 but emccFlags lacks -msimd128. "
      f"wasm-opt will enable SIMD, but link may miss relaxed-simd optimizations.",
      file=sys.stderr, flush=True,
    )


_KNOWN_HEAP_METHODS = frozenset({
  'HEAP8', 'HEAPU8', 'HEAP16', 'HEAPU16',
  'HEAP32', 'HEAPU32', 'HEAPF32', 'HEAPF64',
})

_HEAP_JSDOC = {
  'HEAP8':   'Signed 8-bit integer view of the WASM linear memory. Index by byte offset.',
  'HEAPU8':  'Unsigned 8-bit integer view of the WASM linear memory. Index by byte offset.',
  'HEAP16':  'Signed 16-bit integer view of the WASM linear memory. Index by byte offset / 2.',
  'HEAPU16': 'Unsigned 16-bit integer view of the WASM linear memory. Index by byte offset / 2.',
  'HEAP32':  'Signed 32-bit integer view of the WASM linear memory. Index by byte offset / 4.',
  'HEAPU32': 'Unsigned 32-bit integer view of the WASM linear memory. Index by byte offset / 4.',
  'HEAPF32': '32-bit floating-point view of the WASM linear memory. Index by byte offset / 4.',
  'HEAPF64': '64-bit floating-point view of the WASM linear memory. Index by byte offset / 8.',
}

def _parse_exported_runtime_methods(emcc_flags):
  """Extract runtime method names from -sEXPORTED_RUNTIME_METHODS in emccFlags."""
  for flag in emcc_flags:
    if 'EXPORTED_RUNTIME_METHODS' in flag:
      match = re.search(r'\[(.+)\]', flag)
      if match:
        return [m.strip().strip("'\"") for m in match.group(1).split(',')]
  return ['FS']


def runBuild(build, libraryBasePath):
  try:
    validate_build_flags()
  except BuildFlagMismatch as e:
    print(str(e), flush=True)
    raise SystemExit(1)
  _warn_consistency(build)

  def getAdditionalBindCodeO():
    combined = BUILTIN_ADDITIONAL_BIND_CODE
    if "additionalBindCode" in build:
      combined += "\n" + build["additionalBindCode"]
    try:
      os.mkdir(libraryBasePath + "/additionalBindCode")
    except Exception:
      pass
    additionalBindCodeFileName = libraryBasePath + "/additionalBindCode/" + build["name"] + ".cpp"
    f = open(additionalBindCodeFileName, "w")
    f.write(combined)
    f.close()
    print("building " + additionalBindCodeFileName)
    OPT_LEVEL = os.environ.get("OCJS_OPT", "-O0")
    USE_LTO = os.environ.get("OCJS_LTO", "0") == "1"
    exception_flags = WASM_EXCEPTION_FLAGS
    command = [
      "emcc",
      "-std=c++17",
      *(["-flto"] if USE_LTO else []),
      *exception_flags,
      *SIMD_FLAGS,
      *EXTRA_COMPILE_FLAGS,
      "-DIGNORE_NO_ATOMICS=1",
      "-DOCCT_NO_PLUGINS",
      "-frtti",
      "-DHAVE_RAPIDJSON",
      OPT_LEVEL,
      *(["-pthread"] if os.environ["THREADING"] == "multi-threaded" else []),
      *(["-include-pch", PCH_FILE] if os.path.exists(PCH_FILE) else []),
      *["-I" + p for p in getFlatIncludePaths()],
      "-c", additionalBindCodeFileName,
    ]
    subprocess.check_call([
      *command,
      "-o", additionalBindCodeFileName + ".o",
    ])
    return additionalBindCodeFileName + ".o"
  additionalBindCodeO = getAdditionalBindCodeO()
  print("Running build: " + build["name"], flush=True)
  bindingsO = []
  _AUTO_BINDING_DIRS = {"myMain.h"}
  compiled_bindings = libraryBasePath + "/compiled-bindings"
  if not os.path.isdir(compiled_bindings):
    compiled_bindings = libraryBasePath + "/bindings"
  for dirpath, dirnames, filenames in os.walk(compiled_bindings):
    rel_parts = dirpath.replace(compiled_bindings + "/", "").split("/")
    skip = any(not filterPackages(p) and p not in _AUTO_BINDING_DIRS for p in rel_parts if p)
    if skip:
      dirnames.clear()
      continue
    for item in filenames:
      if item.endswith(".cpp.o") and shouldProcessSymbol(item[:-6], build["bindings"]):
        bindingsO.append(dirpath + "/" + item)
  # One object per basename: prevents duplicate embind static init if the same symbol
  # ever appears under multiple directory paths (stable order — first path wins).
  _bindings_by_base = {}
  for o_path in bindingsO:
    _bindings_by_base.setdefault(os.path.basename(o_path), o_path)
  bindingsO = list(_bindings_by_base.values())
  sourcesO = []
  cmake_lib_marker = libraryBasePath + "/.cmake-lib-dir"
  if os.path.exists(cmake_lib_marker):
    with open(cmake_lib_marker) as f:
      cmake_lib_dir = f.read().strip()
    if os.path.isdir(cmake_lib_dir):
      for item in sorted(os.listdir(cmake_lib_dir)):
        if item.endswith(".a"):
          toolkit_name = item.replace("lib", "").replace(".a", "")
          if filterPackages(toolkit_name):
            sourcesO.append(os.path.join(cmake_lib_dir, item))
      print(f"Using {len(sourcesO)} CMake static libraries from {cmake_lib_dir} (filtered by filterPackages)", flush=True)
    else:
      raise Exception(f"CMake lib dir from marker does not exist: {cmake_lib_dir}")
  else:
    for dirpath, dirnames, filenames in os.walk(libraryBasePath + "/sources"):
      rel_parts = dirpath.replace(libraryBasePath + "/sources/", "").split("/")
      skip = any(not filterPackages(p) for p in rel_parts if p)
      if skip:
        dirnames.clear()
        continue
      for item in filenames:
        if item in [
          "XBRepMesh.o",
        ]:
          continue
        if item.endswith(".o"):
          sourcesO.append(dirpath + "/" + item)
  allowed_undef_flags = []
  for sym in build.get("allowedUndefinedSymbols", []):
    allowed_undef_flags.extend(["-Wl,--allow-undefined-symbol=" + sym])

  emcc_flags = build.get("emccFlags", [])
  has_opt = any(f.startswith("-O") for f in emcc_flags)
  has_lto = "-flto" in emcc_flags
  has_malloc = any(f.startswith("-sMALLOC=") for f in emcc_flags)

  fill_flags = []
  if not has_opt:
    fill_flags.append(os.environ.get("OCJS_LINK_OPT", os.environ.get("OCJS_OPT", "-O3")))
  if not has_lto and os.environ.get("OCJS_LTO", "0") == "1":
    fill_flags.append("-flto")
  if not has_malloc:
    malloc_choice = os.environ.get("OCJS_MALLOC", "dlmalloc")
    fill_flags.append(f"-sMALLOC={malloc_choice}")

  output_dir = os.environ.get("OCJS_OUTPUT_DIR", os.getcwd())
  linkCmd = [
    "emcc", "-lembind",
    *([additionalBindCodeO] if additionalBindCodeO else []),
    *bindingsO, *sourcesO,
    "-o", output_dir + "/" + build["name"],
    *(["-pthread"] if os.environ["THREADING"] == "multi-threaded" else []),
    *fill_flags,
    *emcc_flags,
    *allowed_undef_flags,
  ]
  if os.environ.get("OCJS_CLOSURE", "false") == "true":
    linkCmd.extend(["--closure", "1"])
  print(f"Linking {len(bindingsO)} bindings + {len(sourcesO)} sources ...", flush=True)
  link_start = time.time()
  subprocess.check_call(linkCmd)
  link_duration = time.time() - link_start

  wasmFile = output_dir + "/" + os.path.splitext(build["name"])[0] + ".wasm"
  emsdk = os.environ.get("EMSDK", "")
  wasmOptPath = shutil.which("wasm-opt") or (os.path.join(emsdk, "upstream", "bin", "wasm-opt") if emsdk else None)

  sizeBefore = os.path.getsize(wasmFile) if os.path.exists(wasmFile) else 0
  sizeAfter = sizeBefore
  wasm_opt_duration = 0
  wasm_opt_flag_list = []

  wasm_opt_level = os.environ.get("OCJS_WASM_OPT_LEVEL", "-O3")
  skip_wasm_opt = os.environ.get("OCJS_SKIP_WASM_OPT", "0") == "1"
  if os.path.exists(wasmFile) and wasmOptPath and os.path.exists(wasmOptPath) and wasm_opt_level and not skip_wasm_opt:
    print(f"Running wasm-opt on {wasmFile} ({sizeBefore / (1024*1024):.1f} MB)...", flush=True)
    wasm_opt_flag_list = [wasm_opt_level, "--strip-debug", "--strip-producers", "--enable-mutable-globals", "--enable-bulk-memory", "--enable-sign-ext", "--enable-nontrapping-float-to-int", "--traps-never-happen"]
    if os.environ.get("OCJS_CONVERGE", "false") == "true":
      wasm_opt_flag_list.append("--converge")
    # --closed-world disabled: interacts badly with exception handling code present in non-No_Exception builds
    # wasm_opt_flag_list.append("--closed-world")
    wasmOptCmd = [wasmOptPath] + wasm_opt_flag_list
    wasmOptCmd.append("--enable-exception-handling")
    wasm_opt_flag_list.append("--enable-exception-handling")
    if os.environ.get("OCJS_SIMD", "0") == "1":
      wasmOptCmd.append("--enable-simd")
      wasm_opt_flag_list.append("--enable-simd")
      if os.environ.get("OCJS_RELAXED_SIMD", "0") == "1":
        wasmOptCmd.append("--enable-relaxed-simd")
        wasm_opt_flag_list.append("--enable-relaxed-simd")
    if os.environ.get("THREADING") == "multi-threaded":
      wasmOptCmd.append("--enable-threads")
      wasm_opt_flag_list.append("--enable-threads")
    binaryen_extra_passes = os.environ.get("BINARYEN_EXTRA_PASSES", "").strip()
    if binaryen_extra_passes:
      for pass_name in (s.strip() for s in binaryen_extra_passes.split(",")):
        if pass_name:
          wasm_opt_flag_list.append(pass_name)
          wasmOptCmd.append(pass_name)
    wasmOptCmd.extend([wasmFile, "-o", wasmFile])
    opt_start = time.time()
    subprocess.check_call(wasmOptCmd)
    wasm_opt_duration = time.time() - opt_start
    sizeAfter = os.path.getsize(wasmFile)
    reduction = (1 - sizeAfter / sizeBefore) * 100 if sizeBefore > 0 else 0
    print(f"wasm-opt: {sizeBefore / (1024*1024):.1f} MB -> {sizeAfter / (1024*1024):.1f} MB ({reduction:.1f}% reduction)", flush=True)

  symbol_list = [b["symbol"] for b in build["bindings"]]
  if prov is not None:
    prov.add_linking(
      yaml_config=os.path.basename(build["name"]),
      yaml_hash=_yaml_config_hash,
      bound_symbols=len(symbol_list),
      symbol_list=symbol_list,
      emcc_flags=list(fill_flags) + list(emcc_flags),
      link_duration=link_duration,
      wasm_opt_flags=wasm_opt_flag_list,
      pre_opt_size=sizeBefore,
      post_opt_size=sizeAfter,
      wasm_opt_duration=wasm_opt_duration,
    )

  print("Build finished", flush=True)


def _collect_dts_fragments(buildConfig, libraryBasePath):
  """Walk bindings dir and collect all .d.ts.json fragments matching the YAML bindings."""
  typescriptDefinitions = []
  allBindings = list(chain(buildConfig["mainBuild"]["bindings"], *list(map(lambda x: x["bindings"], buildConfig["extraBuilds"]))))
  _AUTO_BINDING_DIRS = {"myMain.h"}
  for dirpath, dirnames, filenames in os.walk(libraryBasePath + "/bindings"):
    rel_parts = dirpath.replace(libraryBasePath + "/bindings/", "").split("/")
    skip = any(not filterPackages(p) and p not in _AUTO_BINDING_DIRS for p in rel_parts if p)
    if skip:
      dirnames.clear()
      continue
    for item in filenames:
      if item.endswith(".d.ts.json") and shouldProcessSymbol(item[:-10], allBindings):
        f = open(dirpath + "/" + item, "r")
        typescriptDefinitions.append(json.loads(f.read()))
  return typescriptDefinitions


def main():
  from ocjs_bindgen.pipeline.generate import generateCustomCodeBindings
  from compileBindings import compileCustomCodeBindings

  parser = ArgumentParser()
  parser.add_argument(dest="filename", help="Custom build input file (.yml)", metavar="FILE.yml")
  parser.add_argument("--dts-only", action="store_true",
                       help="Regenerate only the .d.ts file from existing .d.ts.json fragments (no compile/link)")
  args = parser.parse_args()
  libraryBasePath = os.environ.get("BUILD_DIR", OCJS_ROOT + "/build")

  global _yaml_config_hash
  with open(args.filename, "rb") as yf:
    _yaml_config_hash = hashlib.sha256(yf.read()).hexdigest()[:12]
  buildConfig = yaml.safe_load(open(args.filename, "r"))
  schema = eval(open(OCJS_ROOT + "/src/customBuildSchema.py", "r").read())
  v = Validator(schema)
  if not v.validate(buildConfig, schema):
    raise Exception(v.errors)
  buildConfig = v.normalized(buildConfig)

  if not args.dts_only:
    # Stale-fragment cleanup uses the FULL manifest, not the per-YAML
    # filtered set — auto-discovered NCollection fragments must survive
    # cross-YAML cache reuse even if a given consumer YAML doesn't link
    # them. Per-YAML filtering happens later in `runBuild` via R2.
    full_manifest_symbols = _load_full_manifest_symbols(BUILD_DIR)
    custom_dir = libraryBasePath + "/bindings/myMain.h"
    if os.path.isdir(custom_dir):
      for f in os.listdir(custom_dir):
        stem = f.split(".")[0]
        if stem not in full_manifest_symbols:
          os.remove(os.path.join(custom_dir, f))

    additionalCppCode = buildConfig["additionalCppCode"]

    yaml_dir = os.path.dirname(os.path.abspath(args.filename))
    for cpp_file in buildConfig.get("additionalCppFiles", []):
      resolved = os.path.join(yaml_dir, cpp_file) if not os.path.isabs(cpp_file) else cpp_file
      if not os.path.isfile(resolved):
        raise FileNotFoundError(f"additionalCppFiles: file not found: {resolved} (from '{cpp_file}')")
      with open(resolved, "r") as f:
        additionalCppCode += "\n" + f.read()

    # R2 — the global `_auto_symbols` default is empty; custom-code
    # generation needs the FULL manifest set as `known_exports` so the
    # generator can resolve cross-references to NCollection types that
    # the consumer's custom code uses (whether or not the link filter
    # ultimately keeps them — anything actually used at compile/link
    # time will be tagged by R1 from an OCCT source class that's in
    # YAML scope).
    global _auto_symbols
    full_set = _load_full_manifest_symbols(BUILD_DIR)

    print("Generating custom code bindings...", flush=True)
    known_exports = {
      b["symbol"]
      for b in chain(
        buildConfig["mainBuild"]["bindings"],
        *(x["bindings"] for x in buildConfig["extraBuilds"]),
      )
    } | full_set
    generateCustomCodeBindings(additionalCppCode, known_exports=known_exports)
    print("Compiling custom code bindings...", flush=True)
    compileCustomCodeBindings({
      "threading": os.environ['THREADING'],
    })
    print("Custom code bindings done.", flush=True)

    verifyBindings(buildConfig["mainBuild"]["bindings"], libraryBasePath)
    for extraBuild in buildConfig["extraBuilds"]:
      verifyBindings(extraBuild, libraryBasePath)
    print("All bindings verified.", flush=True)

    # R2 — compute YAML reachability scope AFTER custom-code generation
    # (so `build/bindings/myMain.h/*.d.ts.json` fragments exist and the
    # scope picks up custom-class names), then narrow the auto-discovered
    # NCollection set to entries whose source_classes intersect it. The
    # narrowed set is consumed by `shouldProcessSymbol` inside `runBuild`.
    yaml_scope = _compute_yaml_class_scope(buildConfig, libraryBasePath)
    manifest_path = os.path.join(BUILD_DIR, "ncollection-manifest.json")
    _auto_symbols = _filter_auto_symbols_by_scope(manifest_path, yaml_scope)
    print(
      f"NCollection link filter (R2): kept {len(_auto_symbols)} / "
      f"{len(full_set)} auto-discovered entries "
      f"(dropped {len(full_set) - len(_auto_symbols)} unreachable from YAML scope "
      f"|scope|={len(yaml_scope)})",
      flush=True,
    )

    runBuild(buildConfig["mainBuild"], libraryBasePath)
    for extraBuild in buildConfig["extraBuilds"]:
      runBuild(extraBuild, libraryBasePath)

  typescriptDefinitions = _collect_dts_fragments(buildConfig, libraryBasePath)

  if buildConfig["generateTypescriptDefinitions"]:
    typescriptDefinitionOutput = ""
    typescriptExports = []
    ancestorChains: dict = {}
    for dts in typescriptDefinitions:
      typescriptDefinitionOutput += dts[".d.ts"]
      for export in dts["exports"]:
        typescriptExports.append({
          "export": export,
          "kind": dts["kind"],
        })
      for cls, ancestor_chain in (dts.get("ancestors") or {}).items():
        ancestorChains.setdefault(cls, ancestor_chain)

    # Declarations for built-in types provided via BUILTIN_ADDITIONAL_BIND_CODE
    # PR 1.8 — `declarations/` lives at `src/declarations/`; resolve via the
    # module-level `OCJS_ROOT` (imported at top of file).
    declarations_dir = os.path.join(OCJS_ROOT, 'src', 'declarations')

    with open(os.path.join(declarations_dir, 'builtin-bindings.d.ts'), 'r') as f:
      typescriptDefinitionOutput += f.read() + "\n\n"
    typescriptExports.extend([
      {"export": "TColStd_IndexedDataMapOfStringString", "kind": "class"},
      {"export": "TopoDS", "kind": "class"},
      {"export": "OCJS", "kind": "class"},
    ])

    with open(os.path.join(declarations_dir, 'emscripten-fs.d.ts'), 'r') as f:
      typescriptDefinitionOutput += f.read() + "\n\n"

    runtime_methods = _parse_exported_runtime_methods(
      buildConfig["mainBuild"].get("emccFlags", [])
    )
    heap_methods_requested = [m for m in runtime_methods if m in _KNOWN_HEAP_METHODS]
    if heap_methods_requested:
      with open(os.path.join(declarations_dir, 'emscripten-runtime.d.ts'), 'r') as f:
        typescriptDefinitionOutput += f.read() + "\n\n"

    # Auto-generated `export namespace <prefix> { ... }` blocks were removed in
    # v3.0 (see CHANGELOG). Consumers must now use the flat `gp_Pnt`,
    # `TopoDS_Edge`, ... names directly. The hand-written `TopoDS` runtime API
    # in builtin-bindings.d.ts is unaffected.

    main_flags = buildConfig["mainBuild"].get("emccFlags", [])
    uses_native_wasm_eh = any('-fwasm-exceptions' in f for f in main_flags)
    exports_eh_helpers = any('-sEXPORT_EXCEPTION_HANDLING_HELPERS' in f for f in main_flags)

    if uses_native_wasm_eh and not exports_eh_helpers:
      # Hard fail: native wasm EH without the runtime helpers is a footgun -- the
      # JS module will catch WebAssembly.Exception but consumers cannot decode it
      # (no getExceptionMessage). Force the YAML to make this explicit.
      raise ValueError(
        "mainBuild.emccFlags contains '-fwasm-exceptions' but not "
        "'-sEXPORT_EXCEPTION_HANDLING_HELPERS'. Add the helpers flag so JS "
        "consumers can decode caught WebAssembly.Exception via getExceptionMessage(), "
        "or remove '-fwasm-exceptions' if exception handling is intentionally "
        "compiled-out."
      )

    if uses_native_wasm_eh and exports_eh_helpers:
      typescriptDefinitionOutput += \
        "/**\n" + \
        " * Extract the exception type and message from a caught `WebAssembly.Exception`.\n" + \
        " *\n" + \
        " * Only available in builds compiled with `-fwasm-exceptions` (native WASM exception handling).\n" + \
        " *\n" + \
        " * @param ex - The caught `WebAssembly.Exception` object.\n" + \
        " * @returns A `[type, message]` tuple where `type` is the C++ exception class name\n" + \
        " *   (e.g. `'Standard_DomainError'`) and `message` is the exception text.\n" + \
        " */\n" + \
        "export declare function getExceptionMessage(ex: WebAssembly.Exception): [string, string];\n" + \
        "/**\n" + \
        " * Increment the reference count of a `WebAssembly.Exception` to prevent premature disposal.\n" + \
        " *\n" + \
        " * Call this when storing an exception reference beyond its catch scope.\n" + \
        " *\n" + \
        " * @param ex - The exception whose refcount to increment.\n" + \
        " */\n" + \
        "export declare function incrementExceptionRefcount(ex: WebAssembly.Exception): void;\n" + \
        "/**\n" + \
        " * Decrement the reference count of a `WebAssembly.Exception`, freeing it when count reaches zero.\n" + \
        " *\n" + \
        " * @param ex - The exception whose refcount to decrement.\n" + \
        " */\n" + \
        "export declare function decrementExceptionRefcount(ex: WebAssembly.Exception): void;\n\n"
      typescriptExports.append({"export": "getExceptionMessage", "kind": "function"})
      typescriptExports.append({"export": "incrementExceptionRefcount", "kind": "function"})
      typescriptExports.append({"export": "decrementExceptionRefcount", "kind": "function"})

    runtime_lines = []
    if 'FS' in runtime_methods:
      runtime_lines.append('  /** Emscripten virtual filesystem for reading/writing files in the WASM heap. */')
      runtime_lines.append('  FS: typeof FS;')
    for m in heap_methods_requested:
      doc = _HEAP_JSDOC.get(m, f'{m} view of the WASM linear memory.')
      runtime_lines.append(f'  /** {doc} */')
      runtime_lines.append(f'  {m}: typeof {m};')
    if 'wasmMemory' in runtime_methods:
      runtime_lines.append('  /**')
      runtime_lines.append('   * The live `WebAssembly.Memory` instance backing the WASM linear memory.')
      runtime_lines.append('   *')
      runtime_lines.append('   * Use `wasmMemory.buffer` to obtain the current `ArrayBuffer` after any')
      runtime_lines.append('   * call that may have grown memory (e.g. allocations during `extract()`).')
      runtime_lines.append('   * Cached `HEAP*` views may be detached after growth — taking fresh views')
      runtime_lines.append('   * off `wasmMemory.buffer` is the safe pattern.')
      runtime_lines.append('   */')
      runtime_lines.append('  wasmMemory: WebAssembly.Memory;')
    runtime_type = '{\n' + '\n'.join(runtime_lines) + '\n}' if runtime_lines else '{}'

    runtime_desc_parts = []
    if 'FS' in runtime_methods:
      runtime_desc_parts.append('the Emscripten virtual filesystem (`oc.FS`)')
    if heap_methods_requested:
      runtime_desc_parts.append('WASM heap views (' + ', '.join(f'`oc.{m}`' for m in heap_methods_requested) + ')')
    if 'wasmMemory' in runtime_methods:
      runtime_desc_parts.append('the live `WebAssembly.Memory` (`oc.wasmMemory`)')
    runtime_desc = ' and '.join(runtime_desc_parts) if runtime_desc_parts else 'Emscripten runtime methods'

    seen_export_names = set()
    deduped_exports = []
    for export_entry in typescriptExports:
      name = export_entry["export"]
      if name in seen_export_names:
        continue
      seen_export_names.add(name)
      deduped_exports.append(export_entry)

    typescriptDefinitionOutput += \
      "\n/**\n" + \
      " * Union of the Emscripten runtime exports and all bound OCCT classes, enums, and functions.\n" + \
      " *\n" + \
      " * Returned by {@link init | `init`} after the WASM module is fully loaded. Access any\n" + \
      " * OCCT binding as a property (e.g. `oc.BRepPrimAPI_MakeBox`) and use\n" + \
      " * " + runtime_desc + ".\n" + \
      " */\n" + \
      "export type OpenCascadeInstance = " + runtime_type + " & {\n  " + ";\n  ".join(map(lambda x: x["export"] + ": typeof " + x["export"], deduped_exports)) + ";\n" + \
      "};\n\n" + \
      "/**\n" + \
      " * Initialize the OpenCASCADE WASM module and return the fully populated instance.\n" + \
      " *\n" + \
      " * Downloads, compiles, and instantiates the WASM binary. The returned\n" + \
      " * `OpenCascadeInstance` provides access to all bound OCCT classes and the\n" + \
      " * Emscripten virtual filesystem.\n" + \
      " *\n" + \
      " * @param options - Emscripten module overrides (e.g. `locateFile`, `print`, `instantiateWasm`).\n" + \
      " * @returns The initialized instance with all OCCT bindings and the `FS` namespace.\n" + \
      " */\n" + \
      "export default function init(options?: Record<string, unknown>): Promise<OpenCascadeInstance>;\n"

    # PR 1.6 — Diagnostics live on the injected service. Read via the
    # process-wide singleton to preserve the legacy shared-bucket behaviour.
    from ocjs_bindgen.diagnostics import DIAGNOSTICS
    unrecognized = DIAGNOSTICS.get("unrecognized_template")
    if unrecognized:
      print(f"\n=== UNRECOGNIZED TEMPLATE TYPES ({len(unrecognized)} unique) ===", flush=True)
      for type_info, count in sorted(unrecognized.items(), key=lambda x: -x[1])[:15]:
        print(f"  {type_info} ({count}x)", flush=True)
      if len(unrecognized) > 15:
        print(f"  ... and {len(unrecognized) - 15} more", flush=True)
      print("These template types have no known typedef/using-alias.", flush=True)
      print("Auto-discovery should capture NCollection types; check discover.py for missing patterns.\n", flush=True)

    # Post-process to neutralize references to types not actually emitted in
    # this build. Fragments are pre-generated against the FULL bindgen filter,
    # so a per-build subset YAML (e.g. replicad_single) inherits references like
    # `Standard_Type` that the subset never declares. Replace each with `unknown`
    # (no value at runtime, structural fallback at type level) to keep the
    # generated `.d.ts` semantically valid (zero TS2304/TS2552 diagnostics).
    declared_names = {x["export"] for x in deduped_exports}
    declared_names.update(
      re.findall(r"^export\s+(?:declare\s+)?type\s+([A-Za-z_][A-Za-z0-9_]*)", typescriptDefinitionOutput, re.MULTILINE)
    )
    declared_names.update(
      re.findall(r"^export\s+(?:declare\s+)?interface\s+([A-Za-z_][A-Za-z0-9_]*)", typescriptDefinitionOutput, re.MULTILINE)
    )
    pre_rewrite_unknown_count = _count_unknown_tokens(typescriptDefinitionOutput)
    typescriptDefinitionOutput = _replace_undeclared_with_unknown(
      typescriptDefinitionOutput,
      declared_names=declared_names,
      ancestor_chains=ancestorChains,
    )
    post_rewrite_unknown_count = _count_unknown_tokens(typescriptDefinitionOutput)
    rewrites_to_unknown = max(0, post_rewrite_unknown_count - pre_rewrite_unknown_count)

    _enforce_strict_types_gate(
      typescriptDefinitionOutput=typescriptDefinitionOutput,
      rewrites_to_unknown=rewrites_to_unknown,
      diagnostics=DIAGNOSTICS,
    )

    typescriptDefinitionsFile = open(os.getcwd() + "/" + os.path.splitext(buildConfig["mainBuild"]["name"])[0] + ".d.ts", "w")
    typescriptDefinitionsFile.write(typescriptDefinitionOutput)
    print("TypeScript definitions written.", flush=True)

if __name__ == "__main__":
  multiprocessing.set_start_method("fork")
  main()
