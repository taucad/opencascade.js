// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {
}

export interface ClassHandle {
  isAliasOf(other: ClassHandle): boolean;
  delete(): void;
  deleteLater(): this;
  isDeleted(): boolean;
  // @ts-ignore - If targeting lower than ESNext, this symbol might not exist.
  [Symbol.dispose](): void;
  clone(): this;
}
export type Pnt3 = {
  x: number,
  y: number,
  z: number
};

export interface NCollection_Array1_Pnt3 extends ClassHandle {
  Lower(): number;
  Upper(): number;
  Length(): number;
  Value(_0: number): Pnt3;
  ChangeValue(_0: number): Pnt3;
  SetValue(_0: number, _1: Pnt3): void;
}

interface EmbindModule {
  NCollection_Array1_Pnt3: {
    new(): NCollection_Array1_Pnt3;
    new(_0: number, _1: number): NCollection_Array1_Pnt3;
  };
  getPoints_strategyA(_0: number): NCollection_Array1_Pnt3 | null;
  getPoints_strategyC(_0: number): NCollection_Array1_Pnt3;
  getPoints_strategyD(_0: number): Pnt3[];
  getPoints_strategyD_generic(_0: number): NCollection_Array1<Pnt3>;
  getDataMap_strategyD(_0: number): { keys: string[], values: Pnt3[] };
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
