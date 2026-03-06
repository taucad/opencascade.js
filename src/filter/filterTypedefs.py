def filterTypedef(typedef, additionalInfo=None):
  # Name-based typedef exclusions are in bindgen-filters.yaml.
  # Only semantic/AST checks remain here.

  # ::Iterator typedefs cause extreme memory growth which fails the build
  if "::Iterator" in typedef.underlying_typedef_type.spelling:
    return False

  if typedef.location.file.name == "myMain.h" or typedef.underlying_typedef_type.spelling.startswith((
    "opencascade::handle",
    "handle",
    "NCollection"
  )):
    return True

  return False
