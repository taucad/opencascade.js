/**
 * Options accepted by `init()` from `@taucad/opencascade.js`.
 *
 * Passed straight through to emscripten's `Module` factory.
 */
export type InitOpenCascadeOptions = {
  /**
   * Resolve the URL where the runtime will fetch a sibling asset (most
   * importantly `opencascade_full.wasm`). Mandatory for the v3 single-file
   * build — the runtime no longer auto-discovers its wasm sibling.
   *
   * The canonical pattern is to point at the `@taucad/opencascade.js/wasm`
   * subpath export and return its URL verbatim.
   *
   * @example `() => wasmUrl // import wasmUrl from '@taucad/opencascade.js/wasm?url'`
   */
  locateFile: (file: string) => string;

  /**
   * Override the wasm binary bytes directly. Use this when you've fetched
   * the wasm via a custom transport (e.g. an OPFS cache) and want to skip
   * the runtime's own `fetch(locateFile(...))`.
   *
   * @default undefined
   */
  wasmBinary?: ArrayBuffer | Uint8Array;

  /**
   * Pre-allocated memory for the wasm instance. Most consumers leave this
   * unset and let `ALLOW_MEMORY_GROWTH` size the heap on demand.
   *
   * @default undefined
   */
  wasmMemory?: WebAssembly.Memory;

  /**
   * Print stdout (e.g. `printf` from custom C++) to a sink.
   *
   * @default console.log
   */
  print?: (text: string) => void;

  /**
   * Print stderr (e.g. OCCT diagnostic messages) to a sink.
   *
   * @default console.error
   */
  printErr?: (text: string) => void;
};

/**
 * The resolved value of `init()`. Carries every bound OCCT class plus the
 * emscripten runtime helpers (`FS`, `HEAP*`).
 *
 * The full bound-class surface is documented under `/docs/package/api`.
 */
export type Module = {
  /** Emscripten in-memory filesystem (MEMFS) bridge. */
  readonly FS: {
    readFile: (path: string) => Uint8Array;
    writeFile: (path: string, bytes: Uint8Array | string) => void;
    unlink: (path: string) => void;
    mkdir: (path: string) => void;
    readdir: (path: string) => string[];
  };

  /** 8-bit signed view of wasm linear memory. */
  readonly HEAP8: Int8Array;

  /** 32-bit float view of wasm linear memory. */
  readonly HEAPF32: Float32Array;
};
