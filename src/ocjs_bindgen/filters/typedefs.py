"""Typedef filter (semantic / AST-driven only)."""

import re


_NESTED_TPL_PATTERN = re.compile(r"^[A-Za-z_]\w*::[A-Za-z_]\w*<")

_STDLIB_NS_PREFIXES = (
  "std::",
  "__1::",
  "__gnu_cxx::",
  "__cxxabiv1::",
  "emscripten::",
)


def filterTypedef(typedef, additionalInfo=None):
  if "::Iterator" in typedef.underlying_typedef_type.spelling:
    return False

  underlying = typedef.underlying_typedef_type.spelling
  if typedef.location.file.name == "myMain.h" or underlying.startswith((
    "opencascade::handle",
    "handle",
    "NCollection",
    "GeomLProp_",
  )):
    return True

  if underlying.startswith(_STDLIB_NS_PREFIXES):
    return False

  if _NESTED_TPL_PATTERN.match(underlying):
    return True

  return False
