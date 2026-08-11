export type WasmTokenType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type WasmTokenEmit = (type: WasmTokenType, s: number, e: number, meta?: number) => void;

export interface WasmKeywordEntry {
  readonly bytes: Uint8Array;
  readonly code: number;
}

export interface WasmBlockComment {
  readonly open: Uint8Array;
  readonly close: Uint8Array;
}

export interface WasmStringDelimiter {
  readonly start: Uint8Array;
  readonly end: Uint8Array;
  readonly escape: number | null;
  readonly allowMultiline: boolean;
}

export interface WasmLanguageProfile {
  readonly identStartBits: Uint8Array;
  readonly identPartBits: Uint8Array;
  readonly keywords: readonly WasmKeywordEntry[];
  readonly lineComments: readonly Uint8Array[];
  readonly blockComments: readonly WasmBlockComment[];
  readonly strings: readonly WasmStringDelimiter[];
  readonly numberFlags: number;
  readonly regexEnabled: boolean;
  readonly templateEnabled: boolean;
  readonly defaultIdentifier: boolean;
}
