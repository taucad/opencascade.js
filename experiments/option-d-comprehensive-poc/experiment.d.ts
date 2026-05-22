// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    let HEAP8: any;
    let HEAPU8: any;
    let HEAP32: any;
    let HEAPF64: any;
}
interface WasmModule {
}

type EmbindString = ArrayBuffer|Uint8Array|Uint8ClampedArray|Int8Array|string;
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

export type Vec3 = {
  x: number,
  y: number,
  z: number
};

export type EdgeKey = {
  a: bigint,
  b: bigint,
  orientation: number
};

export type ShapeStub = {
  id: bigint,
  kind: number,
  flags: number
};

export interface NCollection_Array1_Pnt3 extends ClassHandle {
  Lower(): number;
  Upper(): number;
  Length(): number;
  Value(_0: number): Pnt3;
  SetValue(_0: number, _1: Pnt3): void;
}

export interface NCollection_Array1_double extends ClassHandle {
  Lower(): number;
  Upper(): number;
  Length(): number;
  Value(_0: number): number;
  SetValue(_0: number, _1: number): void;
}

export interface NCollection_Array1_int extends ClassHandle {
  Lower(): number;
  Upper(): number;
  Length(): number;
  Value(_0: number): number;
  SetValue(_0: number, _1: number): void;
}

export interface NCollection_Array2_Pnt3 extends ClassHandle {
  LowerRow(): number;
  UpperRow(): number;
  LowerCol(): number;
  UpperCol(): number;
  NbRows(): number;
  NbCols(): number;
  Value(_0: number, _1: number): Pnt3;
  SetValue(_0: number, _1: number, _2: Pnt3): void;
}

export interface NCollection_Array2_double extends ClassHandle {
  LowerRow(): number;
  UpperRow(): number;
  LowerCol(): number;
  UpperCol(): number;
  NbRows(): number;
  NbCols(): number;
  Value(_0: number, _1: number): number;
  SetValue(_0: number, _1: number, _2: number): void;
}

export interface NCollection_DynamicArray_Pnt3 extends ClassHandle {
  Size(): number;
  Length(): number;
  Value(_0: number): Pnt3;
  Append(_0: Pnt3): void;
}

export interface NCollection_DynamicArray_double extends ClassHandle {
  Size(): number;
  Length(): number;
  Value(_0: number): number;
  Append(_0: number): void;
}

export interface NCollection_Sequence_Pnt3 extends ClassHandle {
  Length(): number;
  Append(_0: Pnt3): void;
  Prepend(_0: Pnt3): void;
  Value(_0: number): Pnt3;
}

export interface NCollection_List_Pnt3 extends ClassHandle {
  Extent(): number;
  Append(_0: Pnt3): void;
  Prepend(_0: Pnt3): void;
}

export interface NCollection_Map_int extends ClassHandle {
  Add(_0: number): boolean;
  Contains(_0: number): boolean;
  Extent(): number;
}

export interface NCollection_Map_EdgeKey extends ClassHandle {
  Add(_0: EdgeKey): boolean;
  Contains(_0: EdgeKey): boolean;
  Extent(): number;
}

export interface NCollection_DataMap_string_Pnt3 extends ClassHandle {
  Bind(_0: EmbindString, _1: Pnt3): boolean;
  IsBound(_0: EmbindString): boolean;
  Extent(): number;
  Find(_0: EmbindString): Pnt3;
}

export interface NCollection_DataMap_int_Pnt3 extends ClassHandle {
  Bind(_0: number, _1: Pnt3): boolean;
  IsBound(_0: number): boolean;
  Extent(): number;
  Find(_0: number): Pnt3;
}

export interface NCollection_IndexedMap_string extends ClassHandle {
  Add(_0: EmbindString): number;
  Contains(_0: EmbindString): boolean;
  Extent(): number;
  FindKey(_0: number): string;
}

export interface NCollection_IndexedDataMap_string_Pnt3 extends ClassHandle {
  Add(_0: EmbindString, _1: Pnt3): number;
  Contains(_0: EmbindString): boolean;
  Extent(): number;
  FindKey(_0: number): string;
  FindFromIndex(_0: number): Pnt3;
}

export interface NCollection_DoubleMap_int_string extends ClassHandle {
  Bind(_0: number, _1: EmbindString): boolean;
  IsBound1(_0: number): boolean;
  IsBound2(_0: EmbindString): boolean;
  Find1(_0: number): string;
  Find2(_0: EmbindString): number;
  Extent(): number;
}

export interface NCollectionLiveHandle extends ClassHandle {
  Size(): number;
  Kind(): number;
  At(_0: number): any;
  ToArray(): any;
}

export interface Handle_NCollection_HArray1OfPnt extends ClassHandle {
  IsNull(): boolean;
  UseCount(): bigint;
}

interface EmbindModule {
  NCollection_Array1_Pnt3: {};
  NCollection_Array1_double: {};
  NCollection_Array1_int: {};
  getArray1Pnt3_strategyA(_0: number): NCollection_Array1_Pnt3 | null;
  getArray1Double_strategyA(_0: number): NCollection_Array1_double | null;
  getArray1Int_strategyA(_0: number): NCollection_Array1_int | null;
  NCollection_Array2_Pnt3: {};
  NCollection_Array2_double: {};
  getArray2Pnt3_strategyA(_0: number, _1: number): NCollection_Array2_Pnt3 | null;
  getArray2Double_strategyA(_0: number, _1: number): NCollection_Array2_double | null;
  NCollection_DynamicArray_Pnt3: {};
  NCollection_DynamicArray_double: {};
  getDynArrayPnt3_strategyA(_0: number): NCollection_DynamicArray_Pnt3 | null;
  getDynArrayDouble_strategyA(_0: number): NCollection_DynamicArray_double | null;
  NCollection_Sequence_Pnt3: {};
  NCollection_List_Pnt3: {};
  getSequencePnt3_strategyA(_0: number): NCollection_Sequence_Pnt3 | null;
  getListPnt3_strategyA(_0: number): NCollection_List_Pnt3 | null;
  NCollection_Map_int: {};
  NCollection_Map_EdgeKey: {};
  getMapInt_strategyA(_0: number): NCollection_Map_int | null;
  getMapEdgeKey_strategyA(_0: number): NCollection_Map_EdgeKey | null;
  NCollection_DataMap_string_Pnt3: {};
  NCollection_DataMap_int_Pnt3: {};
  getDataMapStrPnt_strategyA(_0: number): NCollection_DataMap_string_Pnt3 | null;
  getDataMapIntPnt_strategyA(_0: number): NCollection_DataMap_int_Pnt3 | null;
  NCollection_IndexedMap_string: {};
  NCollection_IndexedDataMap_string_Pnt3: {};
  getIndexedMapStr_strategyA(_0: number): NCollection_IndexedMap_string | null;
  getIDataMapStrPnt_strategyA(_0: number): NCollection_IndexedDataMap_string_Pnt3 | null;
  NCollection_DoubleMap_int_string: {};
  getDoubleMapIntStr_strategyA(_0: number): NCollection_DoubleMap_int_string | null;
  getArray1Pnt3_strategyD(_0: number): Pnt3[];
  getArray1Double_strategyD(_0: number): number[];
  getArray1Int_strategyD(_0: number): number[];
  getArray2Pnt3_strategyD(_0: number, _1: number): Pnt3[][];
  getArray2Double_strategyD(_0: number, _1: number): number[][];
  getDynArrayPnt3_strategyD(_0: number): Pnt3[];
  getDynArrayDouble_strategyD(_0: number): number[];
  getSequencePnt3_strategyD(_0: number): Pnt3[];
  getListPnt3_strategyD(_0: number): Pnt3[];
  getMapInt_strategyD(_0: number): number[];
  getMapEdgeKey_strategyD(_0: number): EdgeKey[];
  getDataMapStrPnt_strategyD(_0: number): Map<string, Pnt3>;
  getDataMapStrPnt_strategyD_kv(_0: number): { keys: string[], values: Pnt3[] };
  getDataMapIntPnt_strategyD(_0: number): Map<number, Pnt3>;
  getIndexedMapStr_strategyD(_0: number): string[];
  getIDataMapStrPnt_strategyD(_0: number): Array<{ key: string, value: Pnt3 }>;
  getDoubleMapIntStr_strategyD(_0: number): Array<[number, string]>;
  getArray1Double_strategyDp(_0: number): Float64Array;
  getArray1Int_strategyDp(_0: number): Int32Array;
  getArray1Pnt3_strategyDp_interleaved(_0: number): Float64Array;
  getArray2Double_strategyDp(_0: number, _1: number): Float64Array;
  getDynArrayDouble_strategyDp(_0: number): Float64Array;
  getArray1Double_strategyDp_owned(_0: number): { view: Float64Array, ptr: number, len: number };
  freeStrategyDpBuffer(_0: number): void;
  NCollectionLiveHandle: {};
  getLiveHandle_Array1Pnt3(_0: number): NCollectionLiveHandle | null;
  getLiveHandle_DynArrayPnt3(_0: number): NCollectionLiveHandle | null;
  Handle_NCollection_HArray1OfPnt: {};
  getHandleArray1_unwrapped(_0: number): Pnt3[];
  acquireHandleArray1(_0: number): Handle_NCollection_HArray1OfPnt | null;
  materializeFromHandle(_0: Handle_NCollection_HArray1OfPnt | null): Pnt3[];
  getHandleUseCount(_0: Handle_NCollection_HArray1OfPnt | null): bigint;
  getIterator_strategyD(_0: number): { _i: number, _n: number };
  iteratorNextPnt3(_0: any): any;
  readStrategyDpBufferAt(_0: number, _1: number): number;
}

export type MainModule = WasmModule & typeof RuntimeExports & EmbindModule;
export default function MainModuleFactory (options?: unknown): Promise<MainModule>;
