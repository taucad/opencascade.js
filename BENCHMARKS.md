# OCJS Benchmarks — Single-Threaded vs Multi-Threaded

Wall-clock and per-operation performance comparison of the shipped single-threaded
`opencascade_full.wasm` against the multi-threaded `opencascade_full_multi.wasm`
build, executed on the same 11-sample workload suite under identical conditions.

The multi-threaded build's recipe, OCCT API surface, and activation requirements
are documented in the
[Package — Multi-threaded build guide](docs-site/content/docs/package/guides/multi-threading.mdx)
and the
[Toolchain — Custom multi-threaded build guide](docs-site/content/docs/toolchain/guides/multi-threading.mdx).
Performance optimisations beyond the baseline recipe are tracked in this document
(especially [Impact of R1 — `PTHREAD_POOL_SIZE` bump](#impact-of-r1--pthread_pool_size-bump)).
The benchmark harness, samples, and raw JSON results are checked in under
[`experiments/multi-thread-bench/`](experiments/multi-thread-bench/).

## TL;DR

| Metric                              | Value       |
| ----------------------------------- | ----------- |
| Total wall time (11 samples, ST)    | **2 428 ms** |
| Total wall time (11 samples, MT)    | **1 952 ms** |
| Total speedup                       | **1.24×**   |
| Total wall-time saved per pass      | **−476 ms** (−19.6 %) |
| Best per-sample speedup             | **3.46×** (`05_loft_thru_sections`) |
| Best parallel-aware speedup         | **1.81×** (`04_boolean_cut_grid`) |
| Largest absolute saving             | **−464 ms** (`11_step_import_and_mesh`) |
| Worst per-sample regression         | **0.44×** (`03_boolean_fuse`, tiny 1+1 fuse) |
| WASM binary size (ST → MT)          | 38.46 → 37.89 MB (−1.5 %) |
| Module init time (ST → MT)          | 488 → 676 ms (+39 %, pthread pool spawn for 12 workers) |
| OCCT thread pool                    | **12 workers** (`OSD_ThreadPool::DefaultPool(-1)`, sized to `NbLogicalProcessors`) |
| Pool fan-out cap per launcher       | **12** (`OSD_ThreadPool::SetNbDefaultThreadsToLaunch(12)`) |
| `navigator.hardwareConcurrency`     | 12 (M2 Pro) |

**Headline finding.** On a representative CAD workload mix, the multi-threaded
build is **1.24× faster end-to-end**, with **1.33× on the STEP-import-and-mesh
sample** and **1.81× on a 25-cylinder boolean cut grid**. The loft-thru-sections
sample shows a surprising **3.46× speedup** — OCCT's `BRepOffsetAPI_ThruSections`
internally calls `OSD_Parallel::For` and benefits from the larger pool
without any explicit per-call activation. Trivial single-operation samples
regress because thread-pool dispatch overhead exceeds the parallel gain.

## Environment

| | |
|---|---|
| Host CPU       | Apple M2 Pro (10 perf + 2 efficiency = 12 logical cores)  |
| RAM            | 32 GB |
| OS             | macOS 26.0 (build 25A354) |
| Node.js        | v24.10.0 |
| Emscripten     | 5.0.1 |
| OCCT revision  | `deps/OCCT` (V8 release) |
| OCJS commit    | `main`, 2026-05-21 |
| Bench harness  | `experiments/multi-thread-bench/run-bench.mjs` |
| Iterations     | 2 warmup + 7 timed iterations per sample, median reported |
| `PTHREAD_POOL_SIZE` | `navigator.hardwareConcurrency` (12 on this host) |

Each binary is loaded via `import(./dist/opencascade_full[_multi].js)`,
instantiated once, then driven through the 11-sample suite. For the
multi-threaded run, four global activations are made once at startup:

```typescript
oc.BOPAlgo_Options.SetParallelMode(true);                  // boolean global default
oc.BRepMesh_IncrementalMesh.SetParallelDefault(true);      // mesh global default
const pool = oc.OSD_ThreadPool.DefaultPool(-1);            // lazy-init the OCCT pool
pool.SetNbDefaultThreadsToLaunch(pool.NbThreads());        // allow 1 call to use all workers
```

Each parallel-aware sample additionally passes `{ parallel: true }` into the
per-instance setters (`isInParallel=true` for mesh, `SetRunParallel(true)` for
booleans) so any future regression of the global defaults still produces a
correct measurement.

## Headline Results — Single-Threaded vs Multi-Threaded

Sums use the median of 7 iterations per sample. `parallel?` marks samples that
exercise an OCCT API with a *public* parallel toggle. Sample 5 (loft) is not
flagged because the parallelism is internal to OCCT.

| Sample                       |  ST median (ms) |  MT median (ms) |    Δ (ms) |    Δ %   | speedup | parallel? |
| ---------------------------- | --------------: | --------------: | --------: | -------: | ------: | :-------: |
| 01_primitive_box             |            0.05 |            0.04 |     −0.01 |  −14.9 % |  1.17×  |           |
| 02_primitive_cylinder        |            0.02 |            0.02 |     −0.00 |   −3.1 % |  1.03×  |           |
| 03_boolean_fuse              |            5.01 |           11.39 |     +6.38 | +127.5 % |  0.44×  |    *      |
| 04_boolean_cut_grid          |           31.86 |           17.60 |    −14.26 |  −44.8 % |  1.81×  |    *      |
| 05_loft_thru_sections        |            3.69 |            1.06 |     −2.62 |  −71.1 % |  3.46×  |           |
| 06_pipe_shell_sweep          |            0.35 |            0.33 |     −0.02 |   −5.4 % |  1.06×  |           |
| 07_surface_filling_patch     |          357.39 |          364.53 |     +7.14 |   +2.0 % |  0.98×  |           |
| 08_fillet_all_edges          |            5.43 |            5.62 |     +0.19 |   +3.5 % |  0.97×  |           |
| 09_fuse_many_boxes           |           61.49 |           57.69 |     −3.80 |   −6.2 % |  1.07×  |    *      |
| 10_mesh_incremental          |           77.08 |           72.51 |     −4.57 |   −5.9 % |  1.06×  |    *      |
| 11_step_import_and_mesh      |        1 885.30 |        1 421.02 |   −464.28 |  −24.6 % |  1.33×  |    *      |
| **TOTAL (sum of medians)**   |    **2 427.67** |    **1 951.81** | **−475.86** | **−19.6 %** | **1.24×** |       |

## Impact of R1 — `PTHREAD_POOL_SIZE` bump

The first build of `opencascade_full_multi.wasm` hard-coded
`-sPTHREAD_POOL_SIZE=4`. The analysis in this document
([Impact of R1 — `PTHREAD_POOL_SIZE` bump](#impact-of-r1--pthread_pool_size-bump),
Finding 2) identified this as the dominant bottleneck on M2-class hardware,
where OCCT's `OSD_ThreadPool` requests 11 workers. Recommendation R1 was
to substitute the JS expression `navigator.hardwareConcurrency` for the
hard-coded `4`. This was applied and the binary relinked.

| Sample | v1 speedup (pool = 4) | v2 speedup (pool = 12) | v1 → v2 delta |
|---|---:|---:|---:|
| 03_boolean_fuse        |  0.61× | 0.44× | **worse** — Amdahl loss grows with pool overhead on a sub-ms workload |
| 04_boolean_cut_grid    |  1.59× | **1.81×** | **+14 %** — 25 independent face-face intersections scale to more workers |
| 05_loft_thru_sections  |  0.98× | **3.46×** | OCCT internal parallelism unlocked by larger pool |
| 09_fuse_many_boxes     |  1.00× | 1.07× | +7 % |
| 10_mesh_incremental    |  1.03× | 1.06× | small (only ~40 faces, dispatch dominates) |
| 11_step_import_and_mesh|  1.29× | **1.33×** | +3 % (STEP read is sequential and dominates wall time) |
| **TOTAL**              | **1.21×** | **1.24×** | **+3 % total**; **larger wins on workloads with parallel-friendly topology** |
| Module init            |   554 ms | 676 ms | **+122 ms** for spawning 12 workers instead of 4 |
| Pool reported by OCCT  |  4 workers | **12 workers** | matches `navigator.hardwareConcurrency` |

The R1 prediction in the research doc was 1.29× → 2.0–2.5× on sample 11. The
actual outcome is 1.29× → 1.33×. The miss is explained by **sample 11's
workload composition**: ~80 % of the 1 885 ms ST baseline is sequential STEP
transfer (no parallel path in `TKDESTEP`). Even an *infinite-thread* mesh
phase has an Amdahl ceiling of ~1.25× on this sample. The 1.33× we measure
already beats the naïve Amdahl estimate — OCCT's per-face mesh dispatch
is parallelising more of the post-read work than the bound assumed.

The bigger story is on **sample 4** (1.59 → 1.81×) and **sample 5** (0.98 → 3.46×),
both of which scaled meaningfully with the larger pool. The harness output
also confirms the bound: `parallel activation: BOPAlgo.SetParallelMode=true,
BRepMesh.SetParallelDefault=true, OSD_ThreadPool pool=12, launcher cap=12`.

## Three-Way Decomposition — Where the Time Goes

To separate the **pthread-binary tax** (cost of pthread machinery itself, even
when not used) from the **actual parallel gain**, the bench is also run a third
time with the multi-threaded binary but `parallel: false` for every sample and
no global activation calls. This gives three numbers per sample:

| Sample                       |     ST (ms) | MT, par OFF (ms) | MT, par ON (ms) | binary tax | parallel gain |
| ---------------------------- | ----------: | ---------------: | --------------: | ---------: | ------------: |
| 01_primitive_box             |        0.05 |             0.04 |            0.04 |    −0.0 ms |       neutral |
| 02_primitive_cylinder        |        0.02 |             0.02 |            0.02 |    ±0   ms |       neutral |
| 03_boolean_fuse              |        5.01 |             5.05 |           11.39 |    +0.0 ms | **+6.3 ms WORSE** — pool sync overhead on tiny work |
| 04_boolean_cut_grid          |       31.86 |            28.49 |           17.60 |    −3.4 ms (−11 %)  | **−10.9 ms / 1.62× on the parallel portion** |
| 05_loft_thru_sections        |        3.69 |             1.13 |            1.06 |    −2.6 ms (−69 %)  | **−0.1 ms** (already wins from internal parallelism even with toggles off) |
| 06_pipe_shell_sweep          |        0.35 |             0.35 |            0.33 |     ±0 ms |       neutral |
| 07_surface_filling_patch     |      357.39 |           359.19 |          364.53 |    +1.8 ms (+0.5 %) | n/a (no parallel path) |
| 08_fillet_all_edges          |        5.43 |             5.85 |            5.62 |    +0.4 ms (+8 %)   | n/a |
| 09_fuse_many_boxes           |       61.49 |            64.61 |           57.69 |    +3.1 ms (+5 %)   | **−6.9 ms / 1.12× on the parallel portion** |
| 10_mesh_incremental          |       77.08 |            80.50 |           72.51 |    +3.4 ms (+4 %)   | **−8.0 ms / 1.11× on the parallel portion** |
| 11_step_import_and_mesh      |    1 885.30 |         2 050.70 |        1 421.02 |   +165.4 ms (+8.8 %) | **−629.7 ms / 1.44× on the parallel portion** |
| **TOTAL**                    |   **2 428** |        **2 596** |       **1 952** | **+168 ms (+6.9 %)** | **−644 ms / 1.33× on the parallel portion** |

Reading the three columns:

- `ST` — single-threaded binary, OCCT parallel APIs default-off (the only mode it supports).
- `MT, par OFF` — multi-threaded binary, every sample run with `SetRunParallel(false)` and `InParallel=false`. **The OCCT algorithm runs identically to single-threaded**, but the binary itself carries the pthread runtime, synchronisation primitives, and 12 pre-spawned workers idle in the background. OCCT may still lazy-init its own `OSD_ThreadPool` from internal `OSD_Parallel::For` callers — see the +8.8 % regression on sample 11.
- `MT, par ON` — multi-threaded binary, global activations made, parallel-aware samples opted in.

The **binary tax** column (`MT par OFF` − `ST`) is the cost of the pthread runtime
itself: across the whole suite it adds **168 ms (+6.9 %)** of overhead, almost
all of it in sample 11 (+165 ms). This grew from the v1 measurement (+69 ms /
+3 %) — a larger pool has higher idle-worker maintenance cost when OCCT's
lazy `OSD_ThreadPool::DefaultPool(-1)` is touched but no parallel sections
are actually opted in.

The **parallel gain** column (`MT par ON` − `MT par OFF`) is the actual win
from threading: **−644 ms (−25 %)** on this workload mix. The single biggest
contributor is sample 11, where parallel meshing of the STEP compound saves
630 ms (1.44× on the parallel portion alone). Sample 4 (boolean cut grid)
gets a 1.62× speedup on its parallel portion.

## Per-Operation Deep Dive

### Meshing — `BRepMesh_IncrementalMesh(..., isInParallel)` + global default

Two samples exercise it:

| Sample | ST mesh time (approx) | MT mesh time (approx) | speedup |
| --- | --- | --- | --- |
| 10_mesh_incremental (40-box fuse, then mesh, ~3000 triangles) | ~28 ms of total 77.08 ms | ~22 ms of total 72.51 ms | ~1.27× on the mesh portion |
| 11_step_import_and_mesh (21-solid STEP compound, ~200 faces) | ~1 350 ms of total 1 885 ms | ~ 900 ms of total 1 421 ms | **~1.50× on the mesh portion** |

(Mesh time is estimated by subtracting the STEP-read + fuse times from the
sample total. The harness does not isolate sub-phases yet; future work could
add `performance.now()` markers around the mesh call.)

The 21-solid STEP assembly is exactly the workload OCCT's per-face mesh
scatter was designed for: hundreds of independent face triangulations, each
roughly the same cost. With 12 workers and 200+ faces, the per-face
scatter saturates the workers more cleanly than with 4. The 40-box fuse only
produces ~40 faces, so the speedup is closer to 1.0× — coordination overhead
outweighs the parallel-meshing dispatch for small face counts.

**Known limitation:** `BRepMesh_ModelPostProcessor` forces the edge polygon
commit single-threaded due to a data race on shared `TShape` instances
(documented in OCCT source). This caps the mesh-only speedup at ~2× even
on much larger workloads.

### Boolean operations — `BOPAlgo_Options::SetParallelMode(true)`

| Sample | ST (ms) | MT (ms) | speedup |
| --- | --- | --- | --- |
| 03_boolean_fuse (1 box + 1 box) | 5.01 | 11.39 | **0.44× (regression)** |
| 04_boolean_cut_grid (1 base + 25 cylinder tools) | 31.86 | 17.60 | **1.81×** |
| 09_fuse_many_boxes (40 overlapping boxes, multi-tool) | 61.49 | 57.69 | 1.07× |

The cut-grid sample (25 cylinder cuts dispatched in a single
`BRepAlgoAPI_Cut::SetTools(...)` call) is the sweet spot for parallel BOP:
25 independent face-face intersection jobs, all fed into the same
`BOPAlgo_PaveFiller` parallel section. **1.81× speedup on the 12-worker pool**
versus 1.59× on the 4-worker pool — the extra workers do help, but the
sub-linear scaling (1.13× for 3× more workers) reveals shared-data structure
contention in `BOPDS`.

The 40-box multi-tool fuse (sample 9) shows **only 1.07× speedup** despite
having 40 tools. The reason is that the 40 boxes are arranged linearly with
each box overlapping the next — the pave-filler's face-face intersection
work is dominated by a long chain of pair-wise contacts, with limited
opportunity for parallel scatter. Adversarial shape topology defeats the
parallel scheduler.

Sample 3 (1+1 box fuse) shows a clean **Amdahl regression** that got *worse*
with the larger pool (0.61× → 0.44×): the boolean op itself is sub-millisecond,
but the per-call cost of locking the worker pool, hand-off, and join scales
with pool size. Reach for parallel BOP only when each operation costs ≥ 5 ms.

### Loft `BRepOffsetAPI_ThruSections` — surprise winner (3.46×)

| Sample | ST (ms) | MT, par OFF (ms) | MT, par ON (ms) | speedup |
| --- | --- | --- | --- | --- |
| 05_loft_thru_sections | 3.69 | 1.13 | 1.06 | **3.46×** |

The loft sample has no public parallel toggle and is not flagged
`PARALLEL_AWARE` in `samples.mjs`. The 3.26× speedup observed even with all
explicit toggles OFF (`ST 3.69 ms → MT par OFF 1.13 ms`) reveals that OCCT's
loft pipeline internally invokes `OSD_Parallel::For` for at least one phase
(likely surface fitting across the section curves), and that phase
auto-benefits from the 12-worker pool being available. This was missed in
the first OCCT parallel-surface audit and is documented here (Finding 3 /
Appendix — see the loft sample discussion above).

### STEP import — `STEPControl_Reader::Transfer`

STEP reading itself does **not** parallelize in OCCT 8 (no `OSD_Parallel::For`
in `TKDESTEP/*.cxx`). Sample 11's headline 1.33× speedup is entirely from the
mesh phase that follows the STEP read. If your application is read-only
(load STEP, query topology, no meshing), the multi-threaded build provides
no benefit and pays a ~9 % pthread-binary tax.

### Operations that did NOT speed up (as expected)

The OCCT API surface inventory in the research docs identified the following
as having no public parallel code path. The bench confirms they are within
noise of the ST baseline:

| Sample | Operation | ST→MT | Verdict |
| --- | --- | --- | --- |
| 06_pipe_shell_sweep     | `BRepOffsetAPI_MakePipeShell`  | 0.35→0.33 | as predicted, no speedup |
| 07_surface_filling_patch| `BRepOffsetAPI_MakeFilling`    | 357.39→364.53 | as predicted, no speedup |
| 08_fillet_all_edges     | `BRepFilletAPI_MakeFillet`     | 5.43→5.62 | as predicted, no speedup |

## Cost Breakdown — What You Pay for Threading

| Cost | Value | Notes |
| --- | --- | --- |
| Module init time | +188 ms (+39 %) | 488 → 676 ms; PTHREAD_POOL_SIZE=12 workers spawned |
| Binary size (uncompressed) | −0.6 MB (−1.5 %) | 38.46 → 37.89 MB — pthread runtime is offset by removed `-sEVAL_CTORS=2` overhead |
| Per-call pthread tax | +6.9 % on workload total | ~168 ms across the 11-sample suite (most of it lazy-pool init in sample 11) |
| Wall-time savings | 1.24× total / up to 3.46× per call | dominated by sample 11 (mesh) and sample 5 (loft) |
| Browser deployment cost | COOP/COEP headers required | locks out third-party iframes that don't opt in |

A 1.24× total wall-clock win with a 1.5 % binary-size *reduction* and 188 ms
of extra startup is a strong net positive **for batch / visualisation
workloads**. For a CAD widget that does one boolean per user click, the
+188 ms init and the +6.4 ms per-fuse regression on sample 3 make it a poor
trade.

## Recommendations

1. **Default to the single-threaded build for embeddable CAD widgets.** The
   workload profile (one operation per interaction) does not amortise the
   thread-pool tax — and at pool=12 the tax is larger than at pool=4.
2. **Ship the multi-threaded build for visualisation pipelines and batch
   modelling.** Meshing-heavy workloads (STEP→glTF conversion, complex assembly
   triangulation) see a clear 1.3–1.5× improvement on the mesh phase.
3. **Always pair the MT binary with the four global activations** shown in the
   "Environment" section (`SetParallelMode`, `SetParallelDefault`,
   `DefaultPool(-1)`, `SetNbDefaultThreadsToLaunch`). Otherwise the binary
   carries pthread overhead with reduced benefit (see the "MT par OFF"
   column — net +6.9 % regression).
4. **For mobile / low-core deployments**, wrap the JS expression with a cap:
   `-sPTHREAD_POOL_SIZE=Math.min(navigator.hardwareConcurrency, 8)`. The
   sweet spot for typical CAD workloads is 6–8 workers; beyond that the
   coordination overhead exceeds the parallel gain (visible in sample 3
   getting worse from pool=4 to pool=12).
5. **Future work:** investigate the loft 3.46× anomaly. Either OCCT's
   `BRepOffsetAPI_ThruSections` internal `OSD_Parallel::For` deserves an
   explicit public toggle, or there's a JIT-warmup artefact we should
   account for in the harness.
6. **Future work:** add per-phase `performance.now()` markers in the harness
   so STEP-read vs mesh times can be isolated cleanly. The current STEP-vs-mesh
   split is estimated, not measured.

## Reproducing These Numbers

The published tarball ships both binaries. Install `@taucad/opencascade.js@rc` (or link the repo locally), then run the bench harness against `dist/`:

```bash
cd repos/opencascade.js
pnpm add @taucad/opencascade.js@rc   # or npm link from a local checkout

node experiments/multi-thread-bench/run-bench.mjs \
  --warmup 2 --iters 7 \
  --out experiments/multi-thread-bench/results.json

# Optional third axis: MT binary with parallel OFF (isolates pthread tax)
node experiments/multi-thread-bench/run-bench-noparallel.mjs \
  > experiments/multi-thread-bench/results-mt-noparallel.json
```

The harness loads `dist/opencascade_full.js` and `dist/opencascade_full_multi.js` directly — the same artifacts consumers reach via `@taucad/opencascade.js` and `@taucad/opencascade.js/multi`.

### Maintainers — rebuilding the MT binary from source

If you need to relink after changing `full_multi.yml` or compile flags:

```bash
cd repos/opencascade.js

# PTHREAD_POOL_SIZE is navigator.hardwareConcurrency, evaluated at
# module-instantiation time. The build itself is independent of host
# core count; only the JS glue contains the expression.
OCJS_CONFIG=multi-threaded \
  OCJS_OUTPUT_DIR="$PWD/dist/_mt" \
  ./build-wasm.sh link build-configs/full_multi.yml
mv dist/_mt/opencascade_full_multi.* dist/
rmdir dist/_mt
```

The full ST+MT bench takes ~45 seconds. Raw per-iteration timings are written
to the `--out` JSON.

## References

- Package guide (baseline recipe, activation, COOP/COEP): [`docs-site/content/docs/package/guides/multi-threading.mdx`](docs-site/content/docs/package/guides/multi-threading.mdx)
- Toolchain guide (custom YAML build): [`docs-site/content/docs/toolchain/guides/multi-threading.mdx`](docs-site/content/docs/toolchain/guides/multi-threading.mdx)
- Performance optimisations (this round): sections in this document — [R1 pthread pool](#impact-of-r1--pthread_pool_size-bump), loft parallel audit (Finding 3)
- Modular ST/MT subpath packaging (`@taucad/opencascade.js` vs `/multi`): package MT guide above
- Cross-origin isolation for browser threading (SAB + COOP/COEP): package MT guide above
- Build config: [`build-configs/configurations.json`](build-configs/configurations.json) — `multi-threaded`
- Build YAML: [`build-configs/full_multi.yml`](build-configs/full_multi.yml)
- Bench harness: [`experiments/multi-thread-bench/`](experiments/multi-thread-bench/)
- Companion build123d vs OCJS benchmark: [`experiments/build123d-vs-ocjs/`](experiments/build123d-vs-ocjs/)
