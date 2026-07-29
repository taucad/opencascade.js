import init from 'cascadic/multi';
import wasmUrl from 'cascadic/multi/wasm?url';

let cached: ReturnType<typeof init> | null = null;

/**
 * Canonical exactly-once OCJS multi-threaded init for browser bundles.
 *
 * Loads `cascadic/multi` (pthread-enabled wasm) and activates
 * OCCT-wide parallel defaults once — see the Package multi-threading guide.
 */
export function getOcjs(): ReturnType<typeof init> {
  if (cached === null) {
    cached = init({ locateFile: () => wasmUrl }).then((oc) => {
      oc.BOPAlgo_Options.SetParallelMode(true);
      oc.BRepMesh_IncrementalMesh.SetParallelDefault(true);
      const pool = oc.OSD_ThreadPool.DefaultPool(-1);
      pool.SetNbDefaultThreadsToLaunch(pool.NbThreads());
      return oc;
    });
  }
  return cached;
}
