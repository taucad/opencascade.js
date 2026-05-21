# Sentinel Baseline

Frozen pre-refactor artifacts that the three-layer parity harness diffs against.

## Layout

| Path                         | Contents                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `per_header/`                | Per-fragment `.cpp` and `.d.ts.json` for the 10 sentinel headers from [`SENTINEL_HEADERS.md`](../SENTINEL_HEADERS.md). Diffed by `test_artifact_parity.py` (Layer 1, <30 s).                                                    |
| `full_tree.sha256`           | SHA-256 of every `.cpp` and `.d.ts.json` under `build/bindings/` after `nx run ocjs:generate`. Diffed by `test_tree_parity.py` (Layer 2, ~10 min). 10,310 entries at refactor inception.                                        |
| `dist_artifacts.sha256`      | SHA-256 of `dist/opencascade_full.{d.ts,wasm,js,build-manifest.json}` after `nx run ocjs:link`. Diffed by `test_dist_parity.py` (Layer 3, ~25 min).                                                                             |

## Refresh policy

The baseline is **frozen for the duration of the refactor**. Any drift detected
by the parity harness is a refactor regression and must be diagnosed at source
before the offending PR can land.

When OCCT itself is upgraded (post-refactor), regenerate the baseline in a
single dedicated commit:

```bash
nx run ocjs:link
python tests/sentinel/refresh_baseline.py  # writes per_header/, full_tree.sha256, dist_artifacts.sha256
```

The refresh commit must cite the OCCT version bump and explain the artifact
delta in its body.
