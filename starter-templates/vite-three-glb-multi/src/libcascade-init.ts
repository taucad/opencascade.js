import init from 'libcascade/multi';
import wasmUrl from 'libcascade/multi/wasm?url';

let cached: ReturnType<typeof init> | null = null;

/**
 * Canonical exactly-once libcascade multi-threaded init for browser bundles.
 *
 * Loads `libcascade/multi` (pthread-enabled wasm) and activates
 * OCCT-wide parallel defaults once — see the Package multi-threading guide.
 */
export function getLibcascade(): ReturnType<typeof init> {
  if (cached === null) {
    cached = init({ locateFile: () => wasmUrl }).then((oc) => {
      oc.BOPAlgo_Options.SetParallelMode(true);
      oc.BRepMesh_IncrementalMesh.SetParallelDefault(true);
      return oc;
    });
  }
  return cached;
}
