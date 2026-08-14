---
ocjs: patch
---

Restore the complete immutable OCCT archive closure for custom builds, including strict single- and multi-threaded colored GLB export through `RWGltf_CafWriter`. Keep strict undefined-symbol linking enabled for every allocator by making OCCT's optional `mallinfo` integration weak, restore the remaining declared OCCT definitions, and refresh libcascade's public branding and documentation.
