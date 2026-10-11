---
ocjs: patch
---

Make `BRepOffset_MakeOffset` results independent of heap history (#35, taucad/tau#243) and stop `BRepBuilderAPI_NurbsConvert` trapping on meshed B-spline faces (#39). Arc-join offset results may list their faces in a different order than 3.0.2; the geometry is unchanged.
