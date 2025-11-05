import { base79DecodeWithChecksum, base79EncodeWithChecksum } from "./data-link/base79";
import {
  serializeBinaryPayload,
  deserializeBinaryPayload,
  encodeBlockSection,
  FLAG_THEME_DARK,
  FLAG_THEME_LIGHT,
  DATA_LINK_MAGIC,
  DATA_LINK_VERSION,
  type ThemeSection,
} from "./data-link/payload";
import {
  gzipCompressFallback,
  gzipDecompressFallback,
} from "./data-link/compression-fallback";

/**
 * Shared encoder/decoder instances reused across invocations to avoid
 * unnecessary allocations when transforming markdown payloads.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Base64Options = {
  alphabet?: "base64" | "base64url";
};

/**
 * Type guard that lets us safely probe the experimental base64 helpers on
 * `Uint8Array` without upsetting TypeScript.
 */
const UINT8ARRAY_WITH_BASE64 = Uint8Array as unknown as {
  fromBase64?: (data: string, options?: Base64Options) => Uint8Array;
  prototype: {
    toBase64?: (options?: Base64Options) => string;
  };
};

type CompressionAlgorithm = "gzip" | "brotli";

const DEFAULT_COMPRESSION_ALGORITHM: CompressionAlgorithm = "gzip";

export type ThemePayload = Partial<Record<"dark" | "light", string>>;

export type SharePayload = {
  markdown: string;
  themes?: ThemePayload;
};

export type DecodedSharePayload = {
  markdown: Uint8Array;
  themes: ThemePayload;
  format: "structured" | "legacy";
  blocks?: Uint8Array;
};

export type ShareEncoding = "base64" | "base79";

export interface ShareEncodeOptions {
  encoding?: ShareEncoding;
}

export interface ShareDecodeOptions {
  encoding?: ShareEncoding;
}

/**
 * Ensures the Compression Streams API is available before attempting to
 * instantiate a compressor/decompressor. We surface a clear error message so
 * callers can provide a more helpful UX when running in unsupported
 * environments.
 */
function compressionStreamsAvailable(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

/**
 * Collects all chunks from a readable stream and flattens them into a single
 * `Uint8Array`. The Compression Streams API exposes both compressor and
 * decompressor outputs as async iterables, so this utility keeps the
 * higher-level helpers tidy.
 */
async function streamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
      totalLength += value.length;
    }
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Compresses an array of bytes using the browser's Compression Streams API.
 */
async function compressBytes(
  input: Uint8Array,
  format: CompressionAlgorithm = DEFAULT_COMPRESSION_ALGORITHM,
): Promise<Uint8Array> {
  if (compressionStreamsAvailable()) {
    const stream = new CompressionStream(resolveCompressionFormat(format));
    const writer = stream.writable.getWriter();

    // Start reading from the readable stream before closing the writer
    // to avoid race conditions with the stream's internal buffering
    const readPromise = streamToUint8Array(stream.readable);

    await writer.write(input as BufferSource);
    await writer.close();

    return await readPromise;
  }

  if (format === "gzip") {
    console.log("using gzip compress fallback");
    return gzipCompressFallback(input);
  }

  throw new Error("Compression Streams API is not supported in this environment");
}

/**
 * Reverses {@link compressBytes} by piping the given bytes through a
 * `DecompressionStream`.
 */
async function decompressBytes(
  input: Uint8Array,
  format: CompressionAlgorithm = DEFAULT_COMPRESSION_ALGORITHM,
): Promise<Uint8Array> {
  if (compressionStreamsAvailable()) {
    const stream = new DecompressionStream(resolveCompressionFormat(format));
    const writer = stream.writable.getWriter();

    // Start reading from the readable stream before closing the writer
    // to avoid race conditions with the stream's internal buffering
    const readPromise = streamToUint8Array(stream.readable);

    await writer.write(input as BufferSource);
    await writer.close();

    return await readPromise;
  }

  if (format === "gzip") {
    console.log("using gzip decompress fallback");
    return gzipDecompressFallback(input);
  }

  throw new Error("Compression Streams API is not supported in this environment");
}

/**
 * Normalizes friendly algorithm names to the identifiers expected by the
 * Compression Streams API.
 */
function resolveCompressionFormat(format: CompressionAlgorithm): CompressionFormat {
  if (format === "brotli") {
    // Chrome exposes Brotli via "br" identifier. Accept both values.
    return "br" as CompressionFormat;
  }
  return format;
}

/**
 * Serializes bytes into a URL-safe base64 string. We favour the native
 * `Uint8Array#toBase64` helper when it exists and fall back to a manual
 * implementation otherwise.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const toBase64 = UINT8ARRAY_WITH_BASE64.prototype.toBase64;
  if (typeof toBase64 === "function") {
    return toBase64.call(bytes, { alphabet: "base64url" });
  }
  return fallbackBytesToBase64(bytes);
}

/**
 * Decodes a base64 (URL alphabet) payload into its original bytes.
 */
function base64ToBytes(base64: string): Uint8Array {
  const fromBase64 = UINT8ARRAY_WITH_BASE64.fromBase64;
  if (typeof fromBase64 === "function") {
    try {
      return fromBase64(base64, { alphabet: "base64url" });
    } catch {
      // Fallback to manual implementation if the native helper throws
      // (some environments expose experimental helpers without full support).
    }
  }
  return fallbackBase64ToBytes(base64);
}

/**
 * Manual base64 encoder used when modern `Uint8Array` helpers are not
 * available. The output mirrors the URL-safe alphabet and omits padding to
 * keep links compact.
 */
function fallbackBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64 = btoa(binary);
  return base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Reconstructs the original bytes from the URL-safe base64 encoding produced
 * by {@link fallbackBytesToBase64}.
 */
function fallbackBase64ToBytes(base64: string): Uint8Array {
  const normalized = base64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Compresses markdown text and returns a URL-safe base64 representation ready
 * to be embedded in a `/data/` route.
 *
 * @deprecated Use {@link encodeSharePayload} to embed theme payloads.
 */
export async function encodeMarkdownToBase64(
  markdown: string,
  format: CompressionAlgorithm = DEFAULT_COMPRESSION_ALGORITHM,
): Promise<string> {
  return await encodeSharePayload({ markdown }, format, { encoding: "base64" });
}

/**
 * Decodes a base64 (URL alphabet) payload produced by
 * {@link encodeMarkdownToBase64} back into the original compressed bytes.
 */
export async function decodeBase64Markdown(
  base64: string,
  format: CompressionAlgorithm = DEFAULT_COMPRESSION_ALGORITHM,
): Promise<Uint8Array> {
  const decoded = await decodeSharePayload(base64, format);
  return decoded.markdown;
}

/**
 * Convenience helper that combines {@link decodeBase64Markdown} with UTF-8
 * decoding for consumers that want the markdown string directly.
 */
export async function decodeBase64MarkdownAsText(
  base64: string,
  format: CompressionAlgorithm = DEFAULT_COMPRESSION_ALGORITHM,
): Promise<string> {
  const decoded = await decodeSharePayload(base64, format);
  return decoder.decode(decoded.markdown);
}

/**
 * Encode markdown and optional theme payloads into a compressed Base64 string.
 */
export async function encodeSharePayload(
  payload: SharePayload,
  format: CompressionAlgorithm = DEFAULT_COMPRESSION_ALGORITHM,
  options: ShareEncodeOptions = {},
): Promise<string> {
  const markdownBytes = encoder.encode(payload.markdown);
  const structured = encodeStructuredPayload(markdownBytes, payload.themes ?? {});
  const compressed = await compressBytes(structured, format);

  return bytesToBase64(compressed);
}

/**
 * Decode a previously encoded share payload, returning markdown bytes plus embedded themes.
 */
export async function decodeSharePayload(
  base64: string,
  format: CompressionAlgorithm = DEFAULT_COMPRESSION_ALGORITHM,
): Promise<DecodedSharePayload> {

  const compressed = base64ToBytes(base64);

  if (!compressed || compressed.length === 0) {
    throw new Error("Unable to decode shared payload");
  }

  const decompressed = await decompressBytes(compressed, format);

  if (isStructuredPayload(decompressed)) {
    
    console.log("using decompressed structured payload");

    return decodeStructuredPayload(decompressed);

  }

  return {
    markdown: decompressed,
    themes: {},
    format: "legacy",
  };
}

export type { CompressionAlgorithm };

function encodeStructuredPayload(markdown: Uint8Array<ArrayBuffer>, themes: ThemePayload): Uint8Array<ArrayBuffer> {
  const themeSections: ThemeSection[] = [];
  if (themes.dark) {
    themeSections.push({ mode: "dark", data: encoder.encode(themes.dark) });
  }
  if (themes.light) {
    themeSections.push({ mode: "light", data: encoder.encode(themes.light) });
  }

  const blockData = encodeBlockSection(markdown);

  return serializeBinaryPayload({
    themes: themeSections,
    blockData,
    markdown,
  });
}

function isStructuredPayload(bytes: Uint8Array): boolean {
  if (bytes.length < 8) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, false);
  const version = view.getUint8(4);
  return magic === DATA_LINK_MAGIC && version === DATA_LINK_VERSION;
}

function decodeStructuredPayload(bytes: Uint8Array<ArrayBuffer>): DecodedSharePayload {
  const payload = deserializeBinaryPayload(bytes);
  const themes: ThemePayload = {};
  for (const entry of payload.themes) {
    const decoded = decoder.decode(entry.data);
    if (entry.mode === "dark") {
      themes.dark = decoded;
    } else if (entry.mode === "light") {
      themes.light = decoded;
    }
  }
  return {
    markdown: payload.markdown,
    themes,
    format: "structured",
    blocks: payload.blockData,
  };
}
