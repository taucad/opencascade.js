# opencascade.js — backlog (v3)

An honest, public backlog. Items here are either next-cut work or known investigations that have not yet landed. Closed items live in [`CHANGELOG.md`](CHANGELOG.md). Test failures and bugs go to GitHub issues, not here.

## Bindgen

- **Regex / glob support in YAML `bindings`**: today, every entry must be a literal `- symbol: ClassName`. Adding `- pattern: ^STEPControl_.*$` would compress hand-trimmed YAML files and reduce drift between consumer YAML and OCCT releases.

## Build system

- **Provenance signing**: extend `provenance.json` with cosign signatures so downstream consumers can verify provenance without trusting GHCR's manifest list alone.
- **Reproducible-CI guide adoption**: most downstream consumers still pin by tag rather than digest. Promote the `provenance.json` + image-digest workflow in the next release notes.

## Test coverage

- **Round-trip geometry coverage for mesh exporters**: `STEP`, `IGES`, and `BRep` smokes already write-then-read with `STEPControl_Reader` / `IGESControl_Reader` / `BRepTools` to assert geometry survives the round-trip. `GLB`, `OBJ`, `PLY`, and `STL` smokes currently stop at parsing vertex/face counts out of the serialised output; extend them to re-import through `RWGltf_CafReader` / `RWObj_CafReader` / `RWPly_PlyReader` / `RWStl_Reader` and assert geometric equality within tolerance.
- **Per-template Playwright artifacts**: capture and archive screenshots from `starter-templates/<name>` smokes on every CI run, not just on failure. Useful for tracking visual drift across `@react-three/drei` or `three.js` upgrades.

## Community

- **Featured community projects**: confirm the projects listed in `README.md` (`ArchiYou`, `BitByBit`, `CascadeStudio`, `RepliCAD`, `Tau`) are still active and accepting contributors; add new ones if discovered.
- **Discussions vs Issues triage**: current convention is unclear. Document on the GitHub Discussions front page whether feature requests should land as Discussions or Issues.

---

Patches welcome on any of the above. Open a draft PR if the work might exceed a weekend so the direction can be discussed early.
