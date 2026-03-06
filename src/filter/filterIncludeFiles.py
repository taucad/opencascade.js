def filterIncludeFile(filename):
  # Name-based header exclusions are in bindgen-filters.yaml.
  # Only semantic extension checks remain here.

  if not filename.endswith(".hxx"):
    return False

  if filename.endswith("_pch.hxx"):
    return False

  return True
