#!/usr/bin/env python3
"""Patch OCCT V8 source files for Embind compatibility.

Replaces problematic C++ `using Base::Method;` declarations with explicit
forwarding methods (Embind can't bind name-introducing `using` declarations),
applies V8-final bug fixes, and adds macro `#undef` guards for headers that
leak preprocessor symbols out of `.lxx` inline files.

Honors the `OCCT_ROOT` environment variable (matches the convention used by
every other patch in this directory). Idempotent — re-running on an already
patched tree is a no-op.

Migrated from `src/applyPatches.py`.
"""

import os
import sys


def _occt_src() -> str:
    occt_root = os.environ.get("OCCT_ROOT", "")
    if not occt_root:
        print("ERROR: OCCT_ROOT not set", file=sys.stderr)
        sys.exit(1)
    src = os.path.join(occt_root, "src")
    if not os.path.isdir(src):
        print(f"ERROR: {src} not found", file=sys.stderr)
        sys.exit(1)
    return src


_file_index: dict[str, list[str]] | None = None


def _build_file_index(occt_src: str) -> None:
    global _file_index
    if _file_index is not None:
        return
    _file_index = {}
    for dirpath, _, filenames in os.walk(occt_src):
        for fname in filenames:
            _file_index.setdefault(fname, []).append(os.path.join(dirpath, fname))


def find_file(occt_src: str, filename: str) -> list[str]:
    _build_file_index(occt_src)
    assert _file_index is not None
    return _file_index.get(filename, [])


def patch_file(filepath: str, old_text: str, new_text: str) -> bool:
    with open(filepath, "r") as f:
        content = f.read()
    if old_text not in content:
        if new_text in content:
            print(f"  Already patched: {filepath}")
            return True
        print(f"  WARNING: Expected text not found in {filepath}")
        return False
    content = content.replace(old_text, new_text)
    with open(filepath, "w") as f:
        f.write(content)
    print(f"  Patched: {filepath}")
    return True


def apply_using_statement_patches(occt_src: str) -> None:
    patches = [
        {
            "file": "AIS_Shape.hxx",
            "old": "  using AIS_InteractiveObject::BoundingBox;",
            "new": (
                "  // using AIS_InteractiveObject::BoundingBox;\n"
                "  void BoundingBox (Bnd_Box& theBndBox) override { AIS_InteractiveObject::BoundingBox(theBndBox); }"
            ),
        },
        {
            "file": "BlendFunc_ChamfInv.hxx",
            "old": "  using Blend_FuncInv::Set;",
            "new": (
                "  // using Blend_FuncInv::Set;\n"
                "  void Set (const bool OnFirst, const occ::handle<Adaptor2d_Curve2d>& COnSurf) override"
                " { BlendFunc_GenChamfInv::Set(OnFirst, COnSurf); }"
            ),
        },
        {
            "file": "BlendFunc_ConstThroatInv.hxx",
            "old": "  using Blend_FuncInv::Set;",
            "new": (
                "  // using Blend_FuncInv::Set;\n"
                "  void Set (const bool OnFirst, const occ::handle<Adaptor2d_Curve2d>& COnSurf) override"
                " { BlendFunc_GenChamfInv::Set(OnFirst, COnSurf); }"
            ),
        },
        {
            "file": "Graphic3d_Buffer.hxx",
            "old": "  using NCollection_Buffer::ChangeData;\n  using NCollection_Buffer::Data;",
            "new": (
                "  // using NCollection_Buffer::ChangeData;\n"
                "  // using NCollection_Buffer::Data;\n"
                "  const Standard_Byte* Data() const { return NCollection_Buffer::Data(); }\n"
                "  Standard_Byte* ChangeData() { return NCollection_Buffer::ChangeData(); }"
            ),
        },
        {
            "file": "V3d_DirectionalLight.hxx",
            "old": "  using Graphic3d_CLight::SetDirection;",
            "new": (
                "  // using Graphic3d_CLight::SetDirection;\n"
                "  void SetDirection (const gp_Dir& theDir) { Graphic3d_CLight::SetDirection(theDir); }\n"
                "  void SetDirection (double theVx, double theVy, double theVz)"
                " { Graphic3d_CLight::SetDirection(theVx, theVy, theVz); }"
            ),
        },
        {
            "file": "V3d_SpotLight.hxx",
            "old": (
                "  using Graphic3d_CLight::Position;\n"
                "  using Graphic3d_CLight::SetDirection;\n"
                "  using Graphic3d_CLight::SetPosition;"
            ),
            "new": (
                "  // using Graphic3d_CLight::Position;\n"
                "  // using Graphic3d_CLight::SetDirection;\n"
                "  // using Graphic3d_CLight::SetPosition;\n"
                "  void SetDirection (const gp_Dir& theDir) { Graphic3d_CLight::SetDirection(theDir); }\n"
                "  void SetDirection (double theVx, double theVy, double theVz)"
                " { Graphic3d_CLight::SetDirection(theVx, theVy, theVz); }\n"
                "  const gp_Pnt& Position() const { return Graphic3d_CLight::Position(); }\n"
                "  void Position (double& theX, double& theY, double& theZ) const"
                " { Graphic3d_CLight::Position(theX, theY, theZ); }\n"
                "  void SetPosition (const gp_Pnt& thePosition) { Graphic3d_CLight::SetPosition(thePosition); }\n"
                "  void SetPosition (double theX, double theY, double theZ)"
                " { Graphic3d_CLight::SetPosition(theX, theY, theZ); }"
            ),
        },
        {
            "file": "BRepAlgoAPI_Algo.hxx",
            "old": (
                "  using BOPAlgo_Options::Clear;\n"
                "  using BOPAlgo_Options::ClearWarnings;\n"
                "  using BOPAlgo_Options::DumpErrors;\n"
                "  using BOPAlgo_Options::DumpWarnings;\n"
                "  using BOPAlgo_Options::FuzzyValue;\n"
                "  using BOPAlgo_Options::GetReport;\n"
                "  using BOPAlgo_Options::HasError;\n"
                "  using BOPAlgo_Options::HasErrors;\n"
                "  using BOPAlgo_Options::HasWarning;\n"
                "  using BOPAlgo_Options::HasWarnings;\n"
                "  using BOPAlgo_Options::RunParallel;\n"
                "  using BOPAlgo_Options::SetFuzzyValue;\n"
                "  using BOPAlgo_Options::SetRunParallel;\n"
                "  using BOPAlgo_Options::SetUseOBB;"
            ),
            "new": (
                "  // using BOPAlgo_Options -- replaced with explicit forwarding for Embind\n"
                "  void Clear() override { BOPAlgo_Options::Clear(); }\n"
                "  void ClearWarnings() { BOPAlgo_Options::ClearWarnings(); }\n"
                "  void DumpErrors(Standard_OStream& theOS) const { BOPAlgo_Options::DumpErrors(theOS); }\n"
                "  void DumpWarnings(Standard_OStream& theOS) const { BOPAlgo_Options::DumpWarnings(theOS); }\n"
                "  double FuzzyValue() const { return BOPAlgo_Options::FuzzyValue(); }\n"
                "  const occ::handle<Message_Report>& GetReport () const { return BOPAlgo_Options::GetReport(); }\n"
                "  bool HasError (const occ::handle<Standard_Type>& theType) const { return BOPAlgo_Options::HasError(theType); }\n"
                "  bool HasErrors() const { return BOPAlgo_Options::HasErrors(); }\n"
                "  bool HasWarning (const occ::handle<Standard_Type>& theType) const { return BOPAlgo_Options::HasWarning(theType); }\n"
                "  bool HasWarnings() const { return BOPAlgo_Options::HasWarnings(); }\n"
                "  bool RunParallel() const { return BOPAlgo_Options::RunParallel(); }\n"
                "  void SetFuzzyValue(const double theFuzz) { BOPAlgo_Options::SetFuzzyValue(theFuzz); }\n"
                "  void SetRunParallel(const bool theFlag) { BOPAlgo_Options::SetRunParallel(theFlag); }\n"
                "  void SetUseOBB(const bool theUseOBB) { BOPAlgo_Options::SetUseOBB(theUseOBB); }"
            ),
        },
    ]

    print("Applying using-statement patches...")
    for patch in patches:
        files = find_file(occt_src, patch["file"])
        if not files:
            print(f"  ERROR: {patch['file']} not found in OCCT source tree!", file=sys.stderr)
            continue
        for filepath in files:
            patch_file(filepath, patch["old"], patch["new"])


def apply_occt_v8_bugfixes(occt_src: str) -> None:
    patches = [
        {
            "file": "MathLin_EigenSearch.hxx",
            "old": (
                "  MathUtils::Status          Status = MathUtils::Status::NotConverged;\n"
                "  std::optional<math_Vector> EigenValues;  //!< Computed eigenvalues"
            ),
            "new": (
                "  MathUtils::Status          Status = MathUtils::Status::NotConverged;\n"
                "  size_t                     NbIterations = 0; //!< Number of Jacobi rotations performed\n"
                "  std::optional<math_Vector> EigenValues;  //!< Computed eigenvalues"
            ),
        },
    ]

    print("Applying OCCT V8 bugfix patches...")
    for patch in patches:
        files = find_file(occt_src, patch["file"])
        if not files:
            print(f"  ERROR: {patch['file']} not found in OCCT source tree!", file=sys.stderr)
            continue
        for filepath in files:
            patch_file(filepath, patch["old"], patch["new"])


def apply_macro_undefs(occt_src: str) -> None:
    undef_patches = [
        {
            "file": "IntCurve_IntConicConic.lxx",
            "undef": ["CONSTRUCTOR", "PERFORM"],
        },
    ]

    print("Applying macro #undef patches...")
    for patch in undef_patches:
        files = find_file(occt_src, patch["file"])
        if not files:
            print(f"  ERROR: {patch['file']} not found!", file=sys.stderr)
            continue
        for filepath in files:
            with open(filepath, "r") as f:
                content = f.read()
            undefs = "\n".join(f"#undef {m}" for m in patch["undef"])
            if undefs in content:
                print(f"  Already patched: {filepath}")
                continue
            with open(filepath, "a") as f:
                f.write("\n" + undefs + "\n")
            print(f"  Patched: {filepath}")


def main() -> None:
    occt_src = _occt_src()
    apply_using_statement_patches(occt_src)
    apply_occt_v8_bugfixes(occt_src)
    apply_macro_undefs(occt_src)


if __name__ == "__main__":
    main()
