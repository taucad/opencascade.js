import clang.cindex

def filterMethodOrProperty(theClass, methodOrProperty):
  # Name-based class+method exclusions are in bindgen-filters.yaml.
  # Only AST-based / semantic checks remain here.

  # Using declarations are not supported by Embind
  if methodOrProperty.access_specifier == clang.cindex.AccessSpecifier.PUBLIC and methodOrProperty.kind == clang.cindex.CursorKind.USING_DECLARATION:
    print("Using declarations are not supported! (" + theClass.spelling + ", " + methodOrProperty.spelling + ")")
    return False

  result_type = methodOrProperty.result_type.spelling
  type_spelling = methodOrProperty.type.spelling

  # Filter out methods using unresolvable nested container types.
  # Split into two categories:
  # 1) Types that are never bindable (iterators, internal container types)
  # 2) Types that resolve to concrete types in template specializations (value_type, reference)
  #    - For these, check the canonical (fully-resolved) type: if the nested name disappears
  #      in canonical form, the type is concrete and the method can be bound.
  _UNBINDABLE_TYPES = {"iterator", "const_iterator", "Iterator", "size_type",
                       "difference_type", "pointer", "const_pointer", "allocator_type",
                       "ItemsView", "ConstItemsView"}
  _RESOLVABLE_TYPES = {"value_type", "reference", "const_reference", "Array1Type", "Array2Type", "SequenceType"}
  combined = result_type + " " + type_spelling
  for nt in _UNBINDABLE_TYPES:
    if nt in combined:
      return False
  for nt in _RESOLVABLE_TYPES:
    if nt in combined:
      canonical_combined = methodOrProperty.result_type.get_canonical().spelling + " " + methodOrProperty.type.get_canonical().spelling
      if nt in canonical_combined:
        return False

  # Stream and void* types cannot be bound to JavaScript
  if (
    result_type.startswith("Standard_OStream") or
    result_type.startswith("std::ostream") or
    "Standard_OStream" in type_spelling or
    "std::ostream" in type_spelling or
    "std::istream" in type_spelling or
    "Standard_IStream" in type_spelling or
    "std::ifstream" in type_spelling or
    "std::ofstream" in type_spelling or
    "std::stringstream" in type_spelling or
    "std::ostringstream" in type_spelling or
    "std::istringstream" in type_spelling or
    "void *" in type_spelling or
    "void *" in result_type
  ):
    return False

  # Bit-field properties cannot have their address taken
  if theClass.type.spelling == "MeshVS_TwoColors":
    return False

  # All field declarations on OpenGl_GlFunctions cause binding errors
  if theClass.spelling == "OpenGl_GlFunctions" and methodOrProperty.kind == clang.cindex.CursorKind.FIELD_DECL:
    return False

  # NCollection_Sequence/List ::Iterator methods cause extreme memory growth
  if theClass.spelling in ["NCollection_Sequence", "NCollection_List"] and "::Iterator" in methodOrProperty.displayname:
    return False

  # Handle constructor with self-handle type causes undefined symbol
  if (
    theClass.spelling == "XCAFDoc_GeomTolerance" and
    methodOrProperty.kind == clang.cindex.CursorKind.CONSTRUCTOR and
    "handle<XCAFDoc_GeomTolerance>" in methodOrProperty.type.spelling
  ):
    return False

  # OCCT V8: classes with deleted copy/move constructors — reject copy/move ctors only
  if theClass.spelling in [
    "BRepAlgoAPI_BuilderAlgo", "BRepMesh_IncrementalMesh",
    "BRepMesh_Delaun", "BRepMesh_Triangle",
    "CSLib_Class2d",
  ]:
    if methodOrProperty.kind == clang.cindex.CursorKind.CONSTRUCTOR:
      for arg in methodOrProperty.get_arguments():
        if theClass.spelling in arg.type.spelling and "&" in arg.type.spelling:
          return False

  # OCCT V8: methods with non-const enum output parameters that Embind can't handle
  if methodOrProperty.kind == clang.cindex.CursorKind.CXX_METHOD:
    for arg in methodOrProperty.get_arguments():
      if arg.type.kind == clang.cindex.TypeKind.LVALUEREFERENCE:
        pointee = arg.type.get_pointee()
        if pointee.kind == clang.cindex.TypeKind.ENUM and not pointee.is_const_qualified():
          return False

  # OCCT V8: NCollection_ItemsView::Iterator not directly accessible
  if "NCollection_ItemsView" in str(getattr(methodOrProperty, 'displayname', '')):
    return False

  return True
