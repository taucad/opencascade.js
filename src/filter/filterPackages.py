def filterPackages(packageName):
  if packageName == "":
    return False

  if packageName in [
    ## Module Draw
      "Draw",
      ## Toolkit TKDraw
      "TKDraw",
      "DBRep",
      "DrawTrSurf",

      ## Toolkit TKD3DHostTest
      "TKD3DHostTest",
      "D3DHostTest",

      ## Toolkit TKIVtkDraw
      "TKIVtkDraw",
      "IVtkDraw",

      ## Toolkit TKTopTest
      "TKTopTest",
      "BOPTest",
      "BRepTest",
      "DrawFairCurve",
      "GeometryTest",
      "GeomliteTest",
      "HLRTest",
      "MeshTest",
      "SWDRAW",

      ## Toolkit TKViewerTest
      "TKViewerTest",
      "ViewerTest",

      ## Toolkit TKOpenGlTest
      "TKOpenGlTest",
      "OpenGlTest",

      ## Toolkit TKOpenGlesTest
      "TKOpenGlesTest",

      ## Toolkit TKDCAF
      "TKDCAF",
      "DDF",
      "DDataStd",
      "DDocStd",
      "DNaming",
      "DPrsStd",
      "DrawDim",

      ## Toolkit TKTObjDRAW
      "TKTObjDRAW",
      "TObjDRAW",

      ## Toolkit TKXSDRAW and related V8 toolkits
      "TKXSDRAW",
      "TKXSDRAWDE",
      "TKXSDRAWGLTF",
      "TKXSDRAWIGES",
      "TKXSDRAWOBJ",
      "TKXSDRAWPLY",
      "TKXSDRAWSTEP",
      "TKXSDRAWSTL",
      "TKXSDRAWVRML",
      "XSDRAW",
      "XSDRAWIGES",
      "XSDRAWSTEP",
      "XSDRAWSTLVRML",

      ## Toolkit TKQADraw
      "TKQADraw",
      "QABugs",
      "QADNaming",
      "QADraw",
      "QANCollection",

      ## Toolkit TKXDEDRAW
      "TKXDEDRAW",
      "XDEDRAW",

      ## Toolkit DRAWEXE
      "DRAWEXE",

    ## Module Visualization (fully excluded -- rendering is done in Three.js)
      ## Toolkit TKD3DHost
      "TKD3DHost",
      "D3DHost",

      ## Toolkit TKIVtk
      "TKIVtk",
      "IVtk",
      "IVtkOCC",
      "IVtkTools",
      "IVtkVTK",

      ## Toolkit TKMeshVS
      "TKMeshVS",
      "MeshVS",

      ## Toolkit TKOpenGl
      "TKOpenGl",
      "OpenGl",

      ## Toolkit TKOpenGles
      "TKOpenGles",

      ## Toolkit TKService
      "TKService",
      "Aspect",
      "Cocoa",
      "Font",
      "Graphic3d",
      "Image",
      "Media",
      "WNT",
      "Wasm",
      "Xw",
      "Shaders",

      ## Toolkit TKV3d
      "TKV3d",
      "AIS",
      "DsgPrs",
      "Prs3d",
      "PrsDim",
      "PrsMgr",
      "Select3D",
      "SelectBasics",
      "SelectMgr",
      "StdPrs",
      "StdSelect",
      "V3d",

      ## Toolkit TKVCAF
      "TKVCAF",
      "TPrsStd",

    ## Data Exchange formats -- only keep STEP + STL
      ## Toolkit TKDEIGES (IGES format)
      "TKDEIGES",
      "IGESCAFControl",
      "IGESData",
      "IGESFile",
      "IGESBasic",
      "IGESGraph",
      "IGESGeom",
      "IGESDimen",
      "IGESDraw",
      "IGESSolid",
      "IGESDefs",
      "IGESAppli",
      "IGESConvGeom",
      "IGESSelect",
      "IGESToBRep",
      "GeomToIGES",
      "Geom2dToIGES",
      "BRepToIGES",
      "BRepToIGESBRep",
      "IGESControl",
      "DEIGES",

      ## Toolkit TKDEVRML (VRML format)
      "TKDEVRML",
      "VrmlConverter",
      "VrmlAPI",
      "Vrml",
      "VrmlData",
      "DEVRML",

      ## Toolkit TKDEGLTF (GLTF format)
      "TKDEGLTF",
      "RWGltf",
      "DEGLTF",

      ## Toolkit TKDEOBJ (OBJ format)
      "TKDEOBJ",
      "RWObj",
      "DEOBJ",

      ## Toolkit TKDEPLY (PLY format)
      "TKDEPLY",
      "RWPly",
      "DEPLY",

      ## Toolkit TKDECascade (Cascade native format)
      "TKDECascade",
      "DEBRepCascade",
      "DEXCAFCascade",
      "DEBREP",
      "DEXCAF",

      ## Toolkit TKRWMesh (mesh I/O)
      "TKRWMesh",
      "RWMesh",

    ## Persistence/serialization drivers (not needed in WASM)
      ## Toolkit TKBin
      "TKBin",
      "BinDrivers",
      "BinMDataXtd",
      "BinMNaming",

      ## Toolkit TKBinL
      "TKBinL",
      "BinMDF",
      "BinMDataStd",
      "BinMFunction",
      "BinMDocStd",
      "BinObjMgt",
      "BinLDrivers",

      ## Toolkit TKBinTObj
      "TKBinTObj",
      "BinTObjDrivers",

      ## Toolkit TKBinXCAF
      "TKBinXCAF",
      "BinXCAFDrivers",
      "BinMXCAFDoc",

      ## Toolkit TKStd
      "TKStd",
      "StdDrivers",
      "StdObject",
      "StdPersistent",
      "StdStorage",
      "ShapePersistent",

      ## Toolkit TKStdL
      "TKStdL",
      "StdLDrivers",
      "StdLPersistent",
      "StdObjMgt",

      ## Toolkit TKTObj
      "TKTObj",
      "TObj",

      ## Toolkit TKXml
      "TKXml",
      "XmlDrivers",
      "XmlMDataXtd",
      "XmlMNaming",

      ## Toolkit TKXmlL
      "TKXmlL",
      "XmlLDrivers",
      "XmlMDF",
      "XmlMDataStd",
      "XmlMDocStd",
      "XmlMFunction",
      "XmlObjMgt",

      ## Toolkit TKXmlTObj
      "TKXmlTObj",
      "XmlTObjDrivers",

      ## Toolkit TKXmlXCAF
      "TKXmlXCAF",
      "XmlXCAFDrivers",
      "XmlMXCAFDoc",

    ## Hidden Line Removal — used for 2D projection (e.g. makeProjectedEdges)
      ## Toolkit TKHLR + dependencies — INCLUDED (do not exclude)
      # "TKHLR",
      # "HLRTopoBRep",
      # "HLRBRep",
      # "HLRAlgo",
      # "HLRAppli",
      # "Intrv",        -- interval library, needed by HLR
      # "Contap",       -- contour on surface, needed for silhouette detection

    ## Expression parser (not needed)
      ## Toolkit TKExpress
      "TKExpress",
      "Expr",
      "ExprIntrp",

    ## Helix geometry (not bound, not used)
      ## Toolkit TKHelix
      "TKHelix",
      "HelixBRep",
      "HelixGeom",

    "XBRepMesh",  # Naming clash with BRepMesh

    ## NOTE: With non-LTO builds (OCJS_LTO=0), wasm-ld performs effective
    ## function-level dead code elimination via --gc-sections. Manual package
    ## filtering beyond Draw/Visualization/unused-data-exchange is unnecessary
    ## and risks removing packages that are called transitively at runtime
    ## (e.g. TopOpeBRep used by meshing, StepDimTol by RWStepAP214 registry).

    ## TKDE plugin framework (no bindings, no transitive deps from bound code)
    ## NOTE: DESTEP is NOT filtered — STEPCAFControl uses DESTEP_Parameters at runtime
      "TKDE",
      "DE",
      "DEBRep",
  ]:
    return False

  return True
