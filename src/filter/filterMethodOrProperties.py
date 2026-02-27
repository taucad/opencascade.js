import clang.cindex

def filterMethodOrProperty(theClass, methodOrProperty):
  # # error: no matching conversion for functional-style cast from '(lambda at /opencascade.js/build/modules/module.TKHLR.wasm.cpp:8477:153)' to 'std::function<HLRAlgo_BiPoint::PointsT &(HLRAlgo_PolyAlgo &, emscripten::val, emscripten::val, emscripten::val, emscripten::val, emscripten::val)>'
  # if \
  #   (theClass.spelling == "HLRAlgo_PolyAlgo" and methodOrProperty.spelling == "Show") or \
  #   (theClass.spelling == "HLRAlgo_PolyAlgo" and methodOrProperty.spelling == "Hide") or \
  #   (theClass.spelling == "TopOpeBRepDS_DataStructure" and methodOrProperty.spelling == "ChangeMapOfShapeWithState") or \
  #   (theClass.spelling == "TopOpeBRepDS_TKI" and methodOrProperty.spelling == "ChangeValue"):
  #   return False

  # error: undefined symbol: _ZN16AppDef_MultiLine12SetParameterEid
  if theClass.spelling == "AppDef_MultiLine" and methodOrProperty.spelling == "SetParameter":
    return False

  # error: overload of method DN has no implementation
  if theClass.spelling == "BSplCLib" and methodOrProperty.spelling == "DN":
    return False

  # error: overload of method Knots has no implementation
  if theClass.spelling == "BlendFunc" and (
    methodOrProperty.spelling == "Knots" or
    methodOrProperty.spelling == "Mults"
  ):
    return False

  # error: overload of method Error has no implementation
  if (
    theClass.spelling == "AppDef_TheResol" or
    theClass.spelling == "AppDef_ResConstraintOfTheGradient" or
    theClass.spelling == "AppDef_ResConstraintOfMyGradientOfCompute" or
    theClass.spelling == "AppDef_ResConstraintOfMyGradientbisOfBSplineCompute"
  ) and methodOrProperty.spelling == "Error":
    return False

  # error: overload of method Dump has no implementation
  if theClass.spelling == "BinTools_Curve2dSet" and methodOrProperty.spelling == "Dump":
    return False

  # error: call to deleted constructor of 'std::istream'
  if (
    (theClass.spelling == "BinObjMgt_Persistent" and methodOrProperty.spelling == "Read") or
    (theClass.spelling == "BinTools" and methodOrProperty.spelling == "GetReal") or
    (theClass.spelling == "BinTools" and methodOrProperty.spelling == "GetShortReal") or
    (theClass.spelling == "BinTools" and methodOrProperty.spelling == "GetInteger") or
    (theClass.spelling == "BinTools" and methodOrProperty.spelling == "GetBool") or
    (theClass.spelling == "BinTools" and methodOrProperty.spelling == "GetExtChar") or
    (theClass.spelling == "BinTools_SurfaceSet" and methodOrProperty.spelling == "ReadSurface") or
    (theClass.spelling == "BinTools_Curve2dSet" and methodOrProperty.spelling == "ReadCurve2d") or
    (theClass.spelling == "BinTools_CurveSet" and methodOrProperty.spelling == "ReadCurve") or
    (theClass.spelling == "BinTools_IStream" and methodOrProperty.spelling == "Stream")
  ):
    return False

  # error: no matching function for call to object of type 'std::function<bool (MeshVS_DataSource &, int, bool, NCollection_Array1<double> &, emscripten::val, MeshVS_EntityType &)>'
  if \
    (theClass.spelling == "MeshVS_DataSource" and methodOrProperty.spelling == "GetGeom") or \
    (theClass.spelling == "MeshVS_DataSource" and methodOrProperty.spelling == "GetGeomType") or \
    (theClass.spelling == "MeshVS_DeformedDataSource" and methodOrProperty.spelling == "GetGeom") or \
    (theClass.spelling == "MeshVS_DeformedDataSource" and methodOrProperty.spelling == "GetGeomType") or \
    (theClass.spelling == "Interface_STAT" and methodOrProperty.spelling == "Description") or \
    (theClass.spelling == "Interface_STAT" and methodOrProperty.spelling == "Phase"):
    return False

  # error: calling a private constructor of class 'X'
  if \
    (theClass.spelling == "VrmlData_Node" and methodOrProperty.spelling == "Scene") or \
    (theClass.spelling == "Font_FTFont" and methodOrProperty.spelling == "GlyphImage") or \
    (theClass.spelling == "LDOMString" and methodOrProperty.spelling == "getOwnerDocument") or \
    (theClass.spelling == "LDOM_MemManager" and methodOrProperty.spelling == "Self") or \
    (theClass.spelling == "Aspect_VKeySet" and methodOrProperty.spelling == "Mutex") or \
    (theClass.spelling == "Image_VideoRecorder" and methodOrProperty.spelling == "ChangeFrame") or \
    (theClass.spelling == "StdPrs_BRepFont" and methodOrProperty.spelling == "Mutex") or \
    (theClass.spelling == "AdvApp2Var_Network" and methodOrProperty.spelling == "ChangePatch") or \
    (theClass.spelling == "AdvApp2Var_Framework" and methodOrProperty.spelling == "IsoU") or \
    (theClass.spelling == "LDOM_Node" and methodOrProperty.spelling == "getOwnerDocument") or \
    (theClass.spelling == "AdvApp2Var_Network" and methodOrProperty.spelling == "Patch") or \
    (theClass.spelling == "AdvApp2Var_Framework" and methodOrProperty.spelling == "IsoV"):
    return False

  # error: non-const lvalue reference to type 'X' cannot bind to a temporary of type 'X'
  if \
    (theClass.spelling == "Resource_Unicode") or \
    (theClass.spelling == "NCollection_DataMap" and methodOrProperty.spelling == "Find") or \
    (theClass.spelling == "OSD_Thread" and methodOrProperty.spelling == "Wait") or \
    (theClass.spelling == "TCollection_ExtendedString" and methodOrProperty.spelling == "ToUTF8CString") or \
    (theClass.spelling == "Message" and methodOrProperty.spelling == "ToOSDMetric") or \
    (theClass.spelling == "OSD" and methodOrProperty.spelling == "RealToCString") or \
    (theClass.spelling == "XmlObjMgt" and methodOrProperty.spelling == "GetInteger") or \
    (theClass.spelling == "NCollection_IndexedDataMap" and methodOrProperty.spelling == "FindFromKey") or \
    (theClass.spelling == "XmlObjMgt" and methodOrProperty.spelling == "GetReal") or \
    (theClass.spelling == "BOPAlgo_Tools" and methodOrProperty.spelling == "PerformCommonBlocks") or \
    (theClass.spelling == "Transfer_Finder" and methodOrProperty.spelling == "GetStringAttribute") or \
    (theClass.spelling == "MoniTool_TypedValue" and methodOrProperty.spelling == "Internals") or \
    (theClass.spelling == "MoniTool_AttrList" and methodOrProperty.spelling == "GetStringAttribute") or \
    (theClass.spelling == "MoniTool_CaseData" and methodOrProperty.spelling == "Text") or \
    (theClass.spelling == "StepData_StepReaderData" and methodOrProperty.spelling == "ReadEnumParam") or \
    (theClass.spelling == "XSControl_Vars") or \
    (theClass.spelling == "MeshVS_DataSource" and methodOrProperty.spelling == "GetGroup"):
    return False

  # Error during build
  # error: static_assert failed due to requirement '!std::is_pointer<void (*)(Graphic3d_CView *)>::value' "Implicitly binding raw pointers is illegal.  Specify allow_raw_pointer<arg<?>>"
  if theClass.spelling == "Graphic3d_GraduatedTrihedron" and methodOrProperty.spelling == "CubicAxesCallback":
    return False

  # Error during build: error: address of bit-field requested
  if theClass.type.spelling == "MeshVS_TwoColors":
    return False
  
  # Error during build: error: address of bit-field requested
  if (
    theClass.spelling == "Graphic3d_CStructure" and
    methodOrProperty.spelling in [
      "IsInfinite",
      "stick",
      "highlight",
      "visible",
      "HLRValidation",
      "IsForHighlight",
      "IsMutable",
      "Is2dText",
    ]
  ):
    return False

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

  # error: call to implicitly-deleted copy constructor of 'Aspect_VKeySet'
  # error: rvalue reference to type 'Aspect_VKeySet' cannot bind to lvalue of type 'Aspect_VKeySet'
  # error: call to implicitly-deleted copy constructor of 'Aspect_VKeySet'
  if (
    theClass.spelling == "AIS_ViewController" and (
      methodOrProperty.spelling == "Keys" or
      methodOrProperty.spelling == "ChangeKeys"
    )
  ) or (
    theClass.spelling == "Aspect_WindowInputListener" and (
      methodOrProperty.spelling == "Keys" or
      methodOrProperty.spelling == "ChangeKeys"
    )
  ):
    return False

  # error: private copy constructor used in this function
  if theClass.spelling == "BRepClass3d_SolidExplorer" and methodOrProperty.spelling == "GetTree":
    return False

  # Error comes in the binding code for "gp_TrsfNLerp", which is a template specialization of "NCollection_Lerp"
  # error: type name requires a specifier or qualifier
  # error: cannot cast from type 'void (NCollection_Lerp<gp_Trsf>::*)(double, gp_Trsf &) const' to pointer type 'gp_Trsf (*)(const gp_Trsf &, const gp_Trsf &, double)'
  if theClass.spelling == "NCollection_Lerp" and methodOrProperty.spelling == "Interpolate" and methodOrProperty.is_static_method():
    return False

  # causes extreme memory growth which fails the build (see corresponding typedef filter)
  if theClass.spelling in ["NCollection_Sequence", "NCollection_List"] and "::Iterator" in methodOrProperty.displayname:
    return False

  # Creates error during instantiation:
  # Uncaught (in promise) RuntimeError: abort(Assertion failed: bad export type for `_ZNK19Geom2dHatch_Hatcher6IsDoneEv`: undefined). Build with -s ASSERTIONS=1 for more info.
  # Seems like ::isDone() is not defined anywhere
  if theClass.spelling == "Geom2dHatch_Hatcher" and methodOrProperty.spelling == "IsDone":
    return False

  # Creates error during instantiation:
  # Uncaught (in promise) RuntimeError: abort(Assertion failed: bad export type for `_ZN21Geom2dAPI_Interpolate13ClearTangentsEv`: undefined). Build with -s ASSERTIONS=1 for more info.
  if theClass.spelling == "Geom2dAPI_Interpolate" and methodOrProperty.spelling == "ClearTangents":
    return False

  # Creates error during instantiation:
  # Uncaught (in promise) RuntimeError: abort(Assertion failed: bad export type for `_ZNK21Geom2dGcc_Lin2dTanObl11IsParallel2Ev`: undefined). Build with -s ASSERTIONS=1 for more info.
  if theClass.spelling == "Geom2dGcc_Lin2dTanObl" and methodOrProperty.spelling == "IsParallel2":
    return False

  # Creates error during instantiation:
  # Uncaught (in promise) RuntimeError: abort(Assertion failed: bad export type for `_ZN25Geom2dInt_Geom2dCurveTool11IsCompositeERK17Adaptor2d_Curve2d`: undefined). Build with -s ASSERTIONS=1 for more info.
  if theClass.spelling == "Geom2dInt_Geom2dCurveTool" and methodOrProperty.spelling == "IsComposite":
    return False

  # Creates error during instantiation:
  # Uncaught (in promise) RuntimeError: abort(Assertion failed: bad export type for `_ZN46Geom2dInt_TheCurveLocatorOfTheProjPCurOfGInter6LocateERK17Adaptor2d_Curve2dS2_iiR17Extrema_POnCurv2dS4_`: undefined). Build with -s ASSERTIONS=1 for more info.
  if theClass.spelling == "Geom2dInt_TheCurveLocatorOfTheProjPCurOfGInter" and methodOrProperty.spelling == "Locate":
    return False

  # Creates error during instantiation:
  # see above
  if theClass.spelling == "GeomInt_IntSS" and methodOrProperty.spelling == "SetTolFixTangents":
    return False

  # Creates error during instantiation:
  # see above
  if theClass.spelling == "GeomInt_IntSS" and methodOrProperty.spelling == "TolFixTangents":
    return False

  # Creates error during instantiation:
  # see above
  if theClass.spelling == "GeomAPI_Interpolate" and methodOrProperty.spelling == "ClearTangents":
    return False

  # Creates error during instantiation:
  # see above
  if theClass.spelling == "GeomFill_FunctionGuide" and methodOrProperty.spelling == "Deriv2T":
    return False

  # Creates error during instantiation:
  # see above
  if theClass.spelling == "GeomFill_SweepSectionGenerator" and methodOrProperty.spelling == "Init":
    return False

  # Creates error during instantiation:
  # see above
  if theClass.spelling == "GeomInt_ResConstraintOfMyGradientOfTheComputeLineBezierOfWLApprox" and methodOrProperty.spelling == "Error":
    return False

  # Creates error during instantiation:
  # see above
  if theClass.spelling == "GeomInt_ResConstraintOfMyGradientbisOfTheComputeLineOfWLApprox" and methodOrProperty.spelling == "Error":
    return False

  # Creates error during instantiation:
  # see above
  if theClass.spelling == "GeomInt_WLApprox" and methodOrProperty.spelling == "Perform":
    return False

  # error: no matching constructor for initialization of 'Extrema_ExtCC'
  if theClass.spelling in [
    "GeomAPI_ExtremaCurveSurface",
    "GeomAPI_ExtremaCurveCurve"
   ] and methodOrProperty.spelling == "Extrema":
    return False

  # error: call to implicitly-deleted copy constructor of 'Extrema_ExtPS'
  if theClass.spelling == "GeomAPI_ProjectPointOnSurf" and methodOrProperty.spelling == "Extrema":
    return False

  # error: no matching function for call to 'select_overload'
  if theClass.spelling == "Select3D_SensitiveTriangulation" and methodOrProperty.spelling == "LastDetectedTriangle":
    return False

  # error: call to implicitly-deleted copy constructor of 'IntTools_FClass2d'
  # error: call to implicitly-deleted copy constructor of 'BRepClass3d_SolidClassifier'
  if theClass.spelling == "IntTools_Context" and methodOrProperty.spelling in [
    "FClass2d",
    "ProjPS",
    "SolidClassifier"
  ]:
    return False

  # error: call to implicitly-deleted copy constructor of 'std::__2::basic_stringstream<char, std::__2::char_traits<char>, std::__2::allocator<char>>'
  if theClass.spelling == "Message_AttributeStream" and methodOrProperty.spelling == "Stream":
    return False

  # error: calling a private constructor of class 'OpenGl_Clipping'
  if theClass.spelling == "OpenGl_Context" and methodOrProperty.spelling in [
    "ChangeClipping",
    "Clipping",
  ]:
    return False

  # many errors
  if theClass.spelling == "OpenGl_GlFunctions" and methodOrProperty.kind == clang.cindex.CursorKind.FIELD_DECL:
    return False

  if theClass.spelling == "OpenGl_GraphicDriver" and methodOrProperty.spelling in [
    "Options",
    "ChangeOptions",
  ]:
    return False

  # wasm-ld: error: /opencascade.js/build/bindings/OpenGl/OpenGl_ShaderProgram.hxx/OpenGl_ShaderProgram.cpp.o: undefined symbol: OpenGl_ShaderProgram::compileShaderVerbose(opencascade::handle<OpenGl_Context> const&, opencascade::handle<OpenGl_ShaderObject> const&, TCollection_AsciiString const&, bool)
  if theClass.spelling == "OpenGl_ShaderProgram" and methodOrProperty.spelling == "compileShaderVerbose":
    return False

  # wasm-ld: error: /opencascade.js/build/bindings/OpenGl/OpenGl_View.hxx/OpenGl_View.cpp.o: undefined symbol: OpenGl_View::SetTextureEnv(opencascade::handle<OpenGl_Context> const&, opencascade::handle<Graphic3d_TextureEnv> const&)
  if theClass.spelling == "OpenGl_View" and methodOrProperty.spelling in [
    "SetTextureEnv",
    "SetBackgroundTextureStyle",
    "SetBackgroundGradient",
    "SetBackgroundGradientType",
  ]:
    return False

  # error: call to 'abs' is ambiguous
  if (
    (
      theClass.spelling == "NCollection_Vec2" or
      theClass.spelling == "NCollection_Vec3" or
      theClass.spelling == "NCollection_Vec4"
    ) and
    methodOrProperty.spelling == "cwiseAbs"
  ):
    return False

  # error: undefined symbol: _ZN21XCAFDoc_GeomToleranceC2ERKN11opencascade6handleIS_EE (referenced by top-level compiled C/C++ code)
  if (
    theClass.spelling == "XCAFDoc_GeomTolerance" and
    methodOrProperty.kind == clang.cindex.CursorKind.CONSTRUCTOR and
    "handle<XCAFDoc_GeomTolerance>" in methodOrProperty.type.spelling
  ):
    return False

  # OCCT V8: classes with deleted copy/move constructors
  if theClass.spelling in [
    "BRepAlgoAPI_BuilderAlgo", "BRepMesh_IncrementalMesh",
    "BRepMesh_Delaun", "BRepMesh_Triangle",
    "CSLib_Class2d",
  ]:
    if methodOrProperty.kind == clang.cindex.CursorKind.CONSTRUCTOR:
      for arg in methodOrProperty.get_arguments():
        if theClass.spelling in arg.type.spelling and "&" in arg.type.spelling:
          return False

  # OCCT V8: methods with non-const enum/value output parameters that Embind can't handle
  if methodOrProperty.kind == clang.cindex.CursorKind.CXX_METHOD:
    for arg in methodOrProperty.get_arguments():
      if arg.type.kind == clang.cindex.TypeKind.LVALUEREFERENCE:
        pointee = arg.type.get_pointee()
        if pointee.kind == clang.cindex.TypeKind.ENUM and not pointee.is_const_qualified():
          return False

  # OCCT V8: nested type names that need class-qualified access
  if theClass.spelling == "gp_Dir" and methodOrProperty.spelling == "D":
    return False
  if theClass.spelling == "gp_Dir2d" and methodOrProperty.spelling == "D":
    return False
  if theClass.spelling == "SelectMgr_SelectableObjectSet" and methodOrProperty.spelling == "BVHSubset":
    return False
  if theClass.spelling == "AIS_Manipulator" and methodOrProperty.spelling == "OptionsForAttach":
    return False
  if theClass.spelling == "Graphic3d_ShaderObject" and methodOrProperty.spelling == "ShaderVariableList":
    return False
  if theClass.spelling == "Message_ProgressScope" and methodOrProperty.spelling == "NullString":
    return False
  if theClass.spelling == "PCDM_ReaderFilter" and methodOrProperty.spelling == "AppendMode":
    return False
  if theClass.spelling == "BRepGProp_MeshProps" and methodOrProperty.spelling == "BRepGProp_MeshObjType":
    return False
  if theClass.spelling == "ShapeProcess" and methodOrProperty.spelling == "OperationsFlags":
    return False
  if theClass.spelling == "XSAlgo_ShapeProcessor" and methodOrProperty.spelling == "ParameterMap":
    return False

  # OCCT V8: Message_Gravity is now an enum class, not a value
  if theClass.spelling == "Message_Messenger" and methodOrProperty.spelling == "GetTraceLevel":
    return False

  # OCCT V8: 'Limits' was removed (deprecated math globals)
  if methodOrProperty.spelling == "Limits":
    return False

  # OCCT V8: ReadStreamList was removed
  if methodOrProperty.spelling == "ReadStreamList":
    return False

  # OCCT V8: NCollection_PackedMap requires template arguments
  if theClass.spelling == "TColStd_PackedMapOfInteger" and methodOrProperty.spelling == "GetPackedMap":
    return False

  # OCCT V8: NCollection_ItemsView::Iterator not directly accessible
  if "NCollection_ItemsView" in str(getattr(methodOrProperty, 'displayname', '')):
    return False

  # OCCT V8: gp_Dir::D / gp_Dir2d::D enum constructors are legitimate V8 API.
  # These constexpr constructors allow convenient axis-aligned direction construction.
  # The nested enums are exposed alongside their parent class bindings.

  # OCCT V8: BSplCLib methods with non-const enum output params
  if theClass.spelling == "BSplCLib":
    if methodOrProperty.kind == clang.cindex.CursorKind.CXX_METHOD:
      for arg in methodOrProperty.get_arguments():
        if arg.type.kind == clang.cindex.TypeKind.LVALUEREFERENCE:
          pointee = arg.type.get_pointee()
          if pointee.kind == clang.cindex.TypeKind.ENUM and not pointee.is_const_qualified():
            return False

  # OCCT V8: Bnd_Box / Bnd_Box2d methods with non-const output refs
  if theClass.spelling in ["Bnd_Box", "Bnd_Box2d"] and methodOrProperty.spelling in [
    "Get", "GetGap",
  ]:
    return False

  # OCCT V8: CSLib methods with non-const enum output params
  if theClass.spelling == "CSLib" and methodOrProperty.spelling in [
    "Normal", "DNNormal",
  ]:
    return False

  # OCCT V8: BlendFunc methods with non-const output params
  if theClass.spelling == "BlendFunc" and methodOrProperty.spelling == "GetShape":
    return False

  # OCCT V8: ChFi3d methods with non-const output params
  if theClass.spelling == "ChFi3d" and methodOrProperty.spelling in [
    "ConcaveSide", "NextSide", "SameSide",
  ]:
    return False

  # OCCT V8: GeomFill methods with non-const output params
  if theClass.spelling == "GeomFill" and methodOrProperty.spelling == "GetShape":
    return False

  # OCCT V8: PrsDim methods with non-const output params
  if theClass.spelling in ["PrsDim", "PrsDim_EqualDistanceRelation"] and methodOrProperty.spelling in [
    "ComputeGeometry", "ComputeProjEdgePresentation", "ComputeProjVertexPresentation",
  ]:
    return False

  # OCCT V8: Quantity_Color non-const output params
  if theClass.spelling == "Quantity_Color" and methodOrProperty.spelling in [
    "Values", "ColorFromName",
  ]:
    return False

  # OCCT V8: TopAbs non-const enum output params
  if theClass.spelling == "TopAbs" and methodOrProperty.spelling in [
    "Compose", "Reverse",
  ]:
    return False

  # OCCT V8: V3d non-const output params
  if theClass.spelling == "V3d" and methodOrProperty.spelling == "GetProjAxis":
    return False

  # OCCT V8: Graphic3d_MaterialAspect non-const output params
  if theClass.spelling == "Graphic3d_MaterialAspect" and methodOrProperty.spelling == "MaterialName":
    return False

  # OCCT V8: Font_FontMgr methods
  if theClass.spelling == "Font_FontMgr" and methodOrProperty.spelling == "FindFont":
    return False

  # OCCT V8: OSD_Protection non-const output params
  if theClass.spelling == "OSD_Protection" and methodOrProperty.spelling in [
    "User", "System", "Group", "World",
  ]:
    return False

  # OCCT V8: Message class issues
  if theClass.spelling == "Message" and methodOrProperty.spelling == "MetricFromString":
    return False
  if theClass.spelling == "Message_Messenger" and methodOrProperty.spelling in [
    "GetTraceLevel", "ChangePrinters",
  ]:
    return False

  # OCCT V8: StepData_StepReaderData / STEPCAFControl_GDTProperty
  if theClass.spelling == "StepData_StepReaderData" and methodOrProperty.spelling in [
    "ReadEnumParam", "ReadTypedParam",
  ]:
    return False
  if theClass.spelling == "STEPCAFControl_GDTProperty":
    return False

  return True
