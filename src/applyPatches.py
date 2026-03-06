#!/usr/bin/python3

"""
Apply patches to OCCT V8 source files for Embind compatibility.

Replaces problematic C++ `using` declarations with explicit forwarding methods,
which is required for Emscripten's Embind to properly generate bindings.

Targets OCCT V8's modular directory layout (src/Module/Toolkit/Package/).
"""

import os
import re

OCCT_ROOT = os.environ.get("OCCT_ROOT", "/occt")
OCCT_SRC = OCCT_ROOT + "/src/"

_file_index = None

def _build_file_index():
  """Walk the OCCT source tree once and build a filename -> [paths] lookup."""
  global _file_index
  if _file_index is not None:
    return
  _file_index = {}
  for dirpath, dirnames, filenames in os.walk(OCCT_SRC):
    for fname in filenames:
      _file_index.setdefault(fname, []).append(os.path.join(dirpath, fname))

def find_file(filename):
  """Find a file in the OCCT V8 source tree (O(1) lookup after first call)."""
  _build_file_index()
  return _file_index.get(filename, [])


def patch_file(filepath, old_text, new_text):
  """Replace text in a file. Returns True if patch was applied."""
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


def apply_using_statement_patches():
  """Replace `using Base::Method;` with explicit forwarding methods for Embind."""
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
  ]

  # BRepAlgoAPI_Algo.hxx has many using declarations -- handle separately
  patches.append({
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
  })

  print("Applying using-statement patches...")
  for patch in patches:
    files = find_file(patch["file"])
    if not files:
      print(f"  ERROR: {patch['file']} not found in OCCT source tree!")
      continue
    for filepath in files:
      patch_file(filepath, patch["old"], patch["new"])


def apply_occt_v8_bugfixes():
  """Fix bugs in OCCT V8 rc source that prevent compilation."""
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
    files = find_file(patch["file"])
    if not files:
      print(f"  ERROR: {patch['file']} not found in OCCT source tree!")
      continue
    for filepath in files:
      patch_file(filepath, patch["old"], patch["new"])


def apply_macro_undefs():
  """Add #undef for macros that leak from .lxx inline implementation files."""
  undef_patches = [
    {
      "file": "IntCurve_IntConicConic.lxx",
      "undef": ["CONSTRUCTOR", "PERFORM"],
    },
  ]

  print("Applying macro #undef patches...")
  for patch in undef_patches:
    files = find_file(patch["file"])
    if not files:
      print(f"  ERROR: {patch['file']} not found!")
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


if __name__ == "__main__":
  apply_using_statement_patches()
  apply_occt_v8_bugfixes()
  apply_macro_undefs()
