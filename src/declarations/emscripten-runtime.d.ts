/**
 * Emscripten WASM heap views.
 *
 * Typed array views into the WASM linear memory (`Module.buffer`). Each view
 * provides direct access to the heap at the corresponding element size and
 * signedness. Only available when listed in `-sEXPORTED_RUNTIME_METHODS`.
 *
 * **Important:** These views are invalidated when WASM memory grows
 * (`-sALLOW_MEMORY_GROWTH=1`). Do not cache references across calls that may
 * trigger allocation — re-read the property from the module instance instead.
 *
 * @see {@link https://emscripten.org/docs/api_reference/preamble.js.html#type-accessors-for-the-memory-model | Emscripten Heap Views}
 */

/** Signed 8-bit integer view of the WASM heap. */
export declare const HEAP8: Int8Array;
/** Unsigned 8-bit integer view of the WASM heap. */
export declare const HEAPU8: Uint8Array;
/** Signed 16-bit integer view of the WASM heap. */
export declare const HEAP16: Int16Array;
/** Unsigned 16-bit integer view of the WASM heap. */
export declare const HEAPU16: Uint16Array;
/** Signed 32-bit integer view of the WASM heap. */
export declare const HEAP32: Int32Array;
/** Unsigned 32-bit integer view of the WASM heap. */
export declare const HEAPU32: Uint32Array;
/** 32-bit floating-point view of the WASM heap. */
export declare const HEAPF32: Float32Array;
/** 64-bit floating-point view of the WASM heap. */
export declare const HEAPF64: Float64Array;
