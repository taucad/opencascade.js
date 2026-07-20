declare global {
  namespace WebAssembly {
    /**
     * A native WebAssembly exception caught from a build using
     * `-fwasm-exceptions`.
     *
     * TypeScript's standard libraries do not yet declare this runtime type in
     * every supported compiler/lib combination. Keep the declaration
     * structural so it merges with newer standard-library definitions.
     */
    interface Exception {
      readonly [Symbol.toStringTag]: 'WebAssembly.Exception';
    }
  }
}

export {};
