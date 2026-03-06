def filterClass(theClass, additionalInfo=None):
  # All name-based class exclusions (prefixes, exact names) are in bindgen-filters.yaml.
  # No AST-based semantic checks are needed for class filtering.
  return True
