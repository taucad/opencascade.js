def filterSourceFile(filename):
  # fatal error: 'TargetConditionals.h' file not found
  if filename.endswith(".mm"):
    return False

  # Exclude GTest files -- they require Google Test headers
  if "/GTests/" in filename or filename.endswith("_Test.cxx") or filename.endswith("_Test.cpp"):
    return False

  if filename.endswith(".cxx") or filename.endswith(".cpp") or filename.endswith(".c"):
    return True
  return False
