import type { LineSpan } from '../parser/types';
import { SMDP_CORE_WASM_BASE64 } from './smdp-core-binary';
import type { WasmLanguageProfile, WasmTokenEmit, WasmTokenType } from './types';

const ABI_VERSION = 1;
const RESULT_PTR = 0;
const STATE_PTR = 32;
const CONFIG_PTR = 64;
const STATIC_PTR = 256;
const RESULT_ABI_OFFSET = 16;
const EVENT_SIZE = 24;
const LINE_EVENT_KIND = 1;
const TOKEN_EVENT_BASE = 512;
const LINE_CAPACITY = 2048;
const TOKEN_CAPACITY = 4096;
const LINE_THRESHOLD = 64 * 1024;
const TOKEN_THRESHOLD = 512;
const PAGE_SIZE = 64 * 1024;
const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

// ABI v1 language config, all little-endian u32 values:
//   0/4 identifier bitset pointers
//   8/12, 16/20, 24/28, 32/36 table count/pointer pairs
//   40 number flags, 44 regex, 48..64 template fields
//   68 default-identifier SIMD fast-path flag

interface CoreExports {
  readonly memory: WebAssembly.Memory;
  readonly abi_version: () => number;
  readonly uses_simd: () => number;
  readonly scan_lines: (
    src: number,
    length: number,
    cursor: number,
    out: number,
    capacity: number,
    result: number,
  ) => number;
  readonly tokenize: (
    src: number,
    length: number,
    cursor: number,
    config: number,
    out: number,
    capacity: number,
    state: number,
    result: number,
  ) => number;
}

interface CoreInstance {
  readonly exports: CoreExports;
}

class WasmCoreRuntimeError extends Error {
  emitted: boolean;

  constructor(message: string, emitted = false) {
    super(message);
    this.name = 'WasmCoreRuntimeError';
    this.emitted = emitted;
  }
}

export interface WasmCoreStatus {
  readonly enabled: boolean;
  readonly available: boolean;
  readonly abiVersion: number;
  readonly usesSimd: boolean;
  readonly failure?: string;
}

let enabled = true;
let compiledModule: WebAssembly.Module | null | undefined;
let moduleFailure: string | undefined;

const PACKED_PROFILE_CACHE_LIMIT = 4;
const MAX_RETAINED_TOKENIZER_BYTES = 8 * 1024 * 1024;
const packedProfiles = new Map<WasmLanguageProfile, PackedTokenizer>();

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decodeBinary(): Uint8Array<ArrayBuffer> {
  const constructor = Uint8Array as typeof Uint8Array & {
    fromBase64?: (value: string) => Uint8Array;
  };
  if (typeof constructor.fromBase64 === 'function') {
    return new Uint8Array(constructor.fromBase64(SMDP_CORE_WASM_BASE64));
  }

  if (typeof globalThis.atob !== 'function') {
    throw new Error('No base64 decoder is available for the WebAssembly core');
  }
  const decoded = globalThis.atob(SMDP_CORE_WASM_BASE64);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

function getModule(): WebAssembly.Module | null {
  if (compiledModule !== undefined) return compiledModule;
  if (typeof WebAssembly === 'undefined') {
    moduleFailure = 'WebAssembly is unavailable';
    compiledModule = null;
    return null;
  }
  if (!HOST_LITTLE_ENDIAN) {
    moduleFailure = 'The WebAssembly event bridge requires a little-endian host';
    compiledModule = null;
    return null;
  }

  try {
    const binary = decodeBinary();
    if (!WebAssembly.validate(binary)) throw new Error('WebAssembly SIMD validation failed');
    const module = new WebAssembly.Module(binary);
    compiledModule = module;
    return module;
  } catch (error) {
    moduleFailure = failureMessage(error);
    compiledModule = null;
    return null;
  }
}

function createInstance(): CoreInstance | null {
  const module = getModule();
  if (!module) return null;
  try {
    const instance = new WebAssembly.Instance(module);
    const exports = instance.exports as unknown as CoreExports;
    if (exports.abi_version() !== ABI_VERSION || exports.uses_simd() !== 1) {
      throw new Error('Unsupported smdp WebAssembly ABI');
    }
    return { exports };
  } catch (error) {
    moduleFailure = failureMessage(error);
    compiledModule = null;
    return null;
  }
}

function ensureMemory(memory: WebAssembly.Memory, byteLength: number): boolean {
  if (byteLength <= memory.buffer.byteLength) return true;
  const pages = Math.ceil((byteLength - memory.buffer.byteLength) / PAGE_SIZE);
  try {
    memory.grow(pages);
    return true;
  } catch {
    return false;
  }
}

function resultView(memory: WebAssembly.Memory): DataView {
  return new DataView(memory.buffer, RESULT_PTR, 20);
}

function verifyResult(view: DataView, returnedStatus: number, capacity: number): {
  status: number;
  count: number;
  cursor: number;
} {
  const status = view.getUint32(0, true);
  const count = view.getUint32(4, true);
  const cursor = view.getUint32(8, true);
  const error = view.getUint32(12, true);
  const abi = view.getUint32(RESULT_ABI_OFFSET, true);
  if (status !== returnedStatus || abi !== ABI_VERSION || count > capacity || status > 2 || error !== 0) {
    throw new WasmCoreRuntimeError(`Invalid WebAssembly result header (status=${status}, error=${error})`);
  }
  return { status, count, cursor };
}

function disableAfterFailure(error: unknown): void {
  moduleFailure = failureMessage(error);
  compiledModule = null;
  packedProfiles.clear();
}

export function setWasmCoreEnabled(value: boolean): void {
  enabled = value;
}

export function getWasmCoreStatus(): WasmCoreStatus {
  const module = getModule();
  const status: WasmCoreStatus = {
    enabled,
    available: module !== null,
    abiVersion: module === null ? 0 : ABI_VERSION,
    usesSimd: module !== null,
  };
  if (moduleFailure !== undefined) return { ...status, failure: moduleFailure };
  return status;
}

export function createWasmLineSpanIterator(u8: Uint8Array): IterableIterator<LineSpan> | null {
  if (!enabled) return null;
  const core = createInstance();
  if (!core) return null;

  const sourcePtr = 64;
  const outputPtr = align(sourcePtr + u8.length, 16);
  const required = outputPtr + LINE_CAPACITY * EVENT_SIZE;
  const memory = core.exports.memory;
  if (!ensureMemory(memory, required)) return null;
  new Uint8Array(memory.buffer, sourcePtr, u8.length).set(u8);

  return (function* scan(): Generator<LineSpan> {
    let cursor = 0;
    for (;;) {
      const previousCursor = cursor;
      let returned: number;
      try {
        returned = core.exports.scan_lines(
          sourcePtr,
          u8.length,
          cursor,
          outputPtr,
          LINE_CAPACITY,
          RESULT_PTR,
        );
      } catch (error) {
        throw new WasmCoreRuntimeError(`WebAssembly line scanner trapped: ${failureMessage(error)}`);
      }
      const result = verifyResult(resultView(memory), returned, LINE_CAPACITY);
      if (
        result.cursor > u8.length ||
        (result.status === 0 && result.cursor !== u8.length) ||
        (result.status === 1 && result.cursor <= previousCursor)
      ) {
        throw new WasmCoreRuntimeError('Invalid WebAssembly line scan cursor');
      }
      const events = new Uint32Array(memory.buffer, outputPtr, result.count * (EVENT_SIZE / 4));
      for (let i = 0; i < result.count; i++) {
        const offset = i * (EVENT_SIZE / 4);
        const kind = events[offset];
        const start = events[offset + 1];
        const end = events[offset + 2];
        if (kind !== LINE_EVENT_KIND || start > end || end > u8.length) {
          throw new WasmCoreRuntimeError('Invalid line event from WebAssembly core');
        }
        yield { start, end };
      }

      cursor = result.cursor;
      if (result.status === 0) {
        return;
      }
      if (result.status !== 1) {
        throw new WasmCoreRuntimeError('WebAssembly line scan returned an invalid status');
      }
    }
  })();
}

export function tryCreateWasmLineSpanIterator(u8: Uint8Array): IterableIterator<LineSpan> | null {
  if (u8.length < LINE_THRESHOLD) return null;
  return createWasmLineSpanIterator(u8);
}

class PackedTokenizer {
  private readonly core: CoreInstance;
  private readonly sourcePtr: number;
  private busy = false;

  constructor(profile: WasmLanguageProfile) {
    const core = createInstance();
    if (!core) throw new Error(moduleFailure ?? 'WebAssembly core is unavailable');
    this.core = core;

    const memory = core.exports.memory;
    let cursor = STATIC_PTR;
    const allocate = (size: number, alignment = 4): number => {
      const ptr = align(cursor, alignment);
      cursor = ptr + size;
      if (!ensureMemory(memory, cursor)) throw new Error('Unable to grow WebAssembly memory');
      return ptr;
    };
    const writeU32 = (ptr: number, value: number): void => {
      new DataView(memory.buffer).setUint32(ptr, value >>> 0, true);
    };
    const writeI32 = (ptr: number, value: number): void => {
      new DataView(memory.buffer).setInt32(ptr, value | 0, true);
    };
    const writeBytes = (bytes: Uint8Array): number => {
      const ptr = allocate(bytes.length, 4);
      new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
      return ptr;
    };

    const identStartPtr = writeBytes(profile.identStartBits);
    const identPartPtr = writeBytes(profile.identPartBits);

    const keywordTablePtr = profile.keywords.length === 0 ? 0 : allocate(profile.keywords.length * 12);
    for (let i = 0; i < profile.keywords.length; i++) {
      const keyword = profile.keywords[i];
      const record = keywordTablePtr + i * 12;
      writeU32(record, writeBytes(keyword.bytes));
      writeU32(record + 4, keyword.bytes.length);
      writeU32(record + 8, keyword.code);
    }

    const lineTablePtr = profile.lineComments.length === 0 ? 0 : allocate(profile.lineComments.length * 8);
    for (let i = 0; i < profile.lineComments.length; i++) {
      const comment = profile.lineComments[i];
      const record = lineTablePtr + i * 8;
      writeU32(record, writeBytes(comment));
      writeU32(record + 4, comment.length);
    }

    const blockTablePtr = profile.blockComments.length === 0 ? 0 : allocate(profile.blockComments.length * 16);
    for (let i = 0; i < profile.blockComments.length; i++) {
      const comment = profile.blockComments[i];
      const record = blockTablePtr + i * 16;
      writeU32(record, writeBytes(comment.open));
      writeU32(record + 4, comment.open.length);
      writeU32(record + 8, writeBytes(comment.close));
      writeU32(record + 12, comment.close.length);
    }

    const stringTablePtr = profile.strings.length === 0 ? 0 : allocate(profile.strings.length * 24);
    for (let i = 0; i < profile.strings.length; i++) {
      const delimiter = profile.strings[i];
      const record = stringTablePtr + i * 24;
      writeU32(record, writeBytes(delimiter.start));
      writeU32(record + 4, delimiter.start.length);
      writeU32(record + 8, writeBytes(delimiter.end));
      writeU32(record + 12, delimiter.end.length);
      writeI32(record + 16, delimiter.escape ?? -1);
      writeU32(record + 20, delimiter.allowMultiline ? 1 : 0);
    }

    if (!ensureMemory(memory, CONFIG_PTR + 72)) throw new Error('Unable to allocate WebAssembly config');
    writeU32(CONFIG_PTR, identStartPtr);
    writeU32(CONFIG_PTR + 4, identPartPtr);
    writeU32(CONFIG_PTR + 8, profile.keywords.length);
    writeU32(CONFIG_PTR + 12, keywordTablePtr);
    writeU32(CONFIG_PTR + 16, profile.lineComments.length);
    writeU32(CONFIG_PTR + 20, lineTablePtr);
    writeU32(CONFIG_PTR + 24, profile.blockComments.length);
    writeU32(CONFIG_PTR + 28, blockTablePtr);
    writeU32(CONFIG_PTR + 32, profile.strings.length);
    writeU32(CONFIG_PTR + 36, stringTablePtr);
    writeU32(CONFIG_PTR + 40, profile.numberFlags);
    writeU32(CONFIG_PTR + 44, profile.regexEnabled ? 1 : 0);
    writeU32(CONFIG_PTR + 48, 0);
    writeU32(CONFIG_PTR + 52, 0);
    writeU32(CONFIG_PTR + 56, 0);
    writeU32(CONFIG_PTR + 60, 0);
    writeU32(CONFIG_PTR + 64, 0);
    writeU32(CONFIG_PTR + 68, profile.defaultIdentifier ? 1 : 0);
    this.sourcePtr = align(cursor, 16);
  }

  retainedByteLength(): number {
    return this.core.exports.memory.buffer.byteLength;
  }

  tokenize(u8: Uint8Array, emit: WasmTokenEmit): boolean {
    if (this.busy) return false;
    this.busy = true;
    let emitted = false;
    try {
      const memory = this.core.exports.memory;
      const outputPtr = align(this.sourcePtr + u8.length, 16);
      const required = outputPtr + TOKEN_CAPACITY * EVENT_SIZE;
      if (!ensureMemory(memory, required)) return false;
      new Uint8Array(memory.buffer, this.sourcePtr, u8.length).set(u8);

      const state = new DataView(memory.buffer, STATE_PTR, 16);
      state.setInt32(0, -1, true);
      state.setUint32(4, 0, true);
      state.setUint32(8, 0, true);
      state.setUint32(12, 0, true);

      let cursor = 0;
      for (;;) {
        const previousCursor = cursor;
        let returned: number;
        try {
          returned = this.core.exports.tokenize(
            this.sourcePtr,
            u8.length,
            cursor,
            CONFIG_PTR,
            outputPtr,
            TOKEN_CAPACITY,
            STATE_PTR,
            RESULT_PTR,
          );
        } catch (error) {
          throw new WasmCoreRuntimeError(`WebAssembly tokenizer trapped: ${failureMessage(error)}`, emitted);
        }
        const result = verifyResult(resultView(memory), returned, TOKEN_CAPACITY);
        if (
          result.cursor > u8.length ||
          (result.status === 0 && result.cursor !== u8.length) ||
          (result.status === 1 && result.cursor <= previousCursor)
        ) {
          throw new WasmCoreRuntimeError('Invalid WebAssembly tokenizer cursor');
        }
        const events = new Uint32Array(memory.buffer, outputPtr, result.count * (EVENT_SIZE / 4));
        for (let i = 0; i < result.count; i++) {
          const offset = i * (EVENT_SIZE / 4);
          const kind = events[offset];
          const type = kind - TOKEN_EVENT_BASE;
          const start = events[offset + 1];
          const end = events[offset + 2];
          const meta = events[offset + 3];
          if (type < 0 || type > 10 || start >= end || end > u8.length) {
            throw new WasmCoreRuntimeError('Invalid syntax event from WebAssembly core', emitted);
          }
          emitted = true;
          if (type === 2 || type === 3) {
            emit(type as WasmTokenType, start, end, meta);
          } else {
            emit(type as WasmTokenType, start, end);
          }
        }

        cursor = result.cursor;
        if (result.status === 0) {
          return true;
        }
        if (result.status !== 1) {
          throw new WasmCoreRuntimeError('WebAssembly tokenizer returned an invalid status', emitted);
        }
      }
    } catch (error) {
      if (error instanceof WasmCoreRuntimeError && emitted) error.emitted = true;
      throw error;
    } finally {
      this.busy = false;
    }
  }
}

function getPackedTokenizer(profile: WasmLanguageProfile): PackedTokenizer | null {
  const cached = packedProfiles.get(profile);
  if (cached) {
    packedProfiles.delete(profile);
    packedProfiles.set(profile, cached);
    return cached;
  }
  try {
    const tokenizer = new PackedTokenizer(profile);
    packedProfiles.set(profile, tokenizer);
    if (packedProfiles.size > PACKED_PROFILE_CACHE_LIMIT) {
      const oldest = packedProfiles.keys().next().value as WasmLanguageProfile | undefined;
      if (oldest) packedProfiles.delete(oldest);
    }
    return tokenizer;
  } catch (error) {
    disableAfterFailure(error);
    return null;
  }
}

export function tokenizeWithWasm(
  u8: Uint8Array,
  profile: WasmLanguageProfile,
  emit: WasmTokenEmit,
): boolean {
  if (!enabled || u8.length === 0) return false;
  if (
    profile.templateEnabled &&
    (profile.templateStart == null || u8.includes(profile.templateStart))
  ) {
    return false;
  }
  if (!getModule()) return false;
  const tokenizer = getPackedTokenizer(profile);
  if (!tokenizer) return false;
  try {
    const used = tokenizer.tokenize(u8, emit);
    if (tokenizer.retainedByteLength() > MAX_RETAINED_TOKENIZER_BYTES) {
      packedProfiles.delete(profile);
    }
    return used;
  } catch (error) {
    if (!(error instanceof WasmCoreRuntimeError)) throw error;
    disableAfterFailure(error);
    packedProfiles.delete(profile);
    if (!error.emitted) return false;
    throw error;
  }
}

export function tryTokenizeWithWasm(
  u8: Uint8Array,
  profile: WasmLanguageProfile,
  emit: WasmTokenEmit,
): boolean {
  if (u8.length < TOKEN_THRESHOLD) return false;
  return tokenizeWithWasm(u8, profile, emit);
}
