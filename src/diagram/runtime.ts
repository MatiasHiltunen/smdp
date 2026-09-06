import { SMDP_DIAGRAM_CORE_WASM_BASE64 } from '../wasm/smdp-diagram-core-binary';

const ABI_VERSION = 1;
const RESULT_PTR = 0;
const SOURCE_PTR = 64;
const RECORD_SIZE = 24;
const RECORD_CAPACITY = 1024;
const PAGE_SIZE = 64 * 1024;
const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

interface DiagramCoreExports {
  readonly memory: WebAssembly.Memory;
  readonly diagram_abi_version: () => number;
  readonly diagram_uses_simd: () => number;
  readonly diagram_scan_lines: (
    source: number,
    length: number,
    cursor: number,
    output: number,
    capacity: number,
    result: number,
  ) => number;
}

export interface DiagramLineRecord {
  readonly start: number;
  readonly end: number;
  readonly indent: number;
  readonly flags: number;
  readonly firstTokenHash: number;
}

export interface DiagramWasmStatus {
  readonly available: boolean;
  readonly abiVersion: number;
  readonly usesSimd: boolean;
  readonly failure?: string;
}

export class DiagramRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiagramRuntimeError';
  }
}

let compiledModule: WebAssembly.Module | null | undefined;
let moduleFailure: string | undefined;

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
    return new Uint8Array(constructor.fromBase64(SMDP_DIAGRAM_CORE_WASM_BASE64));
  }
  if (typeof globalThis.atob !== 'function') {
    throw new DiagramRuntimeError('No base64 decoder is available for the diagram WebAssembly core');
  }
  const decoded = globalThis.atob(SMDP_DIAGRAM_CORE_WASM_BASE64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
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
    moduleFailure = 'The diagram ABI requires a little-endian host';
    compiledModule = null;
    return null;
  }
  try {
    const binary = decodeBinary();
    if (!WebAssembly.validate(binary)) {
      throw new DiagramRuntimeError('WebAssembly SIMD validation failed');
    }
    const module = new WebAssembly.Module(binary);
    const probe = new WebAssembly.Instance(module).exports as unknown as DiagramCoreExports;
    if (probe.diagram_abi_version() !== ABI_VERSION || probe.diagram_uses_simd() !== 1) {
      throw new DiagramRuntimeError('Unsupported diagram WebAssembly ABI');
    }
    compiledModule = module;
    return module;
  } catch (error) {
    moduleFailure = failureMessage(error);
    compiledModule = null;
    return null;
  }
}

function createInstance(): DiagramCoreExports {
  const module = getModule();
  if (!module) {
    throw new DiagramRuntimeError(moduleFailure ?? 'Diagram WebAssembly core is unavailable');
  }
  return new WebAssembly.Instance(module).exports as unknown as DiagramCoreExports;
}

function ensureMemory(memory: WebAssembly.Memory, requiredBytes: number): void {
  if (requiredBytes <= memory.buffer.byteLength) return;
  const pages = Math.ceil((requiredBytes - memory.buffer.byteLength) / PAGE_SIZE);
  try {
    memory.grow(pages);
  } catch {
    throw new DiagramRuntimeError('Diagram exceeds the WebAssembly memory budget');
  }
}

export function getDiagramWasmStatus(): DiagramWasmStatus {
  const module = getModule();
  const status: DiagramWasmStatus = {
    available: module !== null,
    abiVersion: module === null ? 0 : ABI_VERSION,
    usesSimd: module !== null,
  };
  return moduleFailure ? { ...status, failure: moduleFailure } : status;
}

export function scanDiagramSource(
  source: Uint8Array,
  maxLines = 16_384,
): readonly DiagramLineRecord[] {
  const core = createInstance();
  const outputPtr = align(SOURCE_PTR + source.byteLength, 16);
  const requiredBytes = outputPtr + RECORD_CAPACITY * RECORD_SIZE;
  ensureMemory(core.memory, requiredBytes);
  new Uint8Array(core.memory.buffer, SOURCE_PTR, source.byteLength).set(source);

  const lines: DiagramLineRecord[] = [];
  let cursor = 0;
  for (;;) {
    const before = cursor;
    let returned: number;
    try {
      returned = core.diagram_scan_lines(
        SOURCE_PTR,
        source.byteLength,
        cursor,
        outputPtr,
        RECORD_CAPACITY,
        RESULT_PTR,
      );
    } catch (error) {
      throw new DiagramRuntimeError(`Diagram WebAssembly scanner trapped: ${failureMessage(error)}`);
    }

    const result = new DataView(core.memory.buffer, RESULT_PTR, 20);
    const status = result.getUint32(0, true);
    const count = result.getUint32(4, true);
    cursor = result.getUint32(8, true);
    const error = result.getUint32(12, true);
    const abi = result.getUint32(16, true);
    if (
      status !== returned ||
      abi !== ABI_VERSION ||
      status > 2 ||
      error !== 0 ||
      count > RECORD_CAPACITY ||
      cursor > source.byteLength ||
      (status === 1 && cursor <= before)
    ) {
      throw new DiagramRuntimeError(`Invalid diagram WebAssembly result (status=${status}, error=${error})`);
    }

    const records = new DataView(core.memory.buffer, outputPtr, count * RECORD_SIZE);
    for (let index = 0; index < count; index++) {
      const offset = index * RECORD_SIZE;
      const start = records.getUint32(offset, true);
      const end = records.getUint32(offset + 4, true);
      const indent = records.getUint32(offset + 8, true);
      const flags = records.getUint32(offset + 12, true);
      const firstTokenHash = records.getUint32(offset + 16, true);
      if (start > end || end > source.byteLength || indent > source.byteLength) {
        throw new DiagramRuntimeError('Diagram WebAssembly returned an invalid line span');
      }
      lines.push({ start, end, indent, flags, firstTokenHash });
      if (lines.length > maxLines) {
        throw new DiagramRuntimeError(`Diagram exceeds the ${maxLines}-line limit`);
      }
    }

    if (status === 0) return lines;
    if (status !== 1) {
      throw new DiagramRuntimeError(`Diagram scan failed with status ${status}`);
    }
  }
}

export function hashDiagramToken(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    let code = value.charCodeAt(index);
    if (code >= 0x41 && code <= 0x5a) code |= 0x20;
    hash ^= code & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
