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



const DEFAULT_COMPRESSION_ALGORITHM: CompressionFormat = "gzip";
const MAX_BASE64_PAYLOAD_CHARS = 12 * 1024 * 1024;
const MAX_COMPRESSED_PAYLOAD_BYTES = 9 * 1024 * 1024;
const MAX_DECOMPRESSED_PAYLOAD_BYTES = 16 * 1024 * 1024;

function describeBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Ensures the Compression Streams API is available before attempting to
 * instantiate a compressor/decompressor. We surface a clear error message so
 * callers can provide a more helpful UX when running in unsupported
 * environments.
 */
function ensureCompressionStreamsAvailable(): void {
  if (typeof CompressionStream === "undefined" || typeof DecompressionStream === "undefined") {
    throw new Error("Compression Streams API is not supported in this environment");
  }
}

/**
 * Collects all chunks from a readable stream and flattens them into a single
 * `Uint8Array`. The Compression Streams API exposes both compressor and
 * decompressor outputs as async iterables, so this utility keeps the
 * higher-level helpers tidy.
 */
async function streamToUint8Array(
  stream: ReadableStream<Uint8Array>,
  maxBytes?: number,
): Promise<Uint8Array> {
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
      if (maxBytes !== undefined && totalLength > maxBytes) {
        try {
          await reader.cancel("stream payload exceeded maximum size");
        } catch {
          // Ignore cancellation failures and throw the size-limit error below.
        }
        throw new Error(
          `Decoded payload exceeds limit (${describeBytes(maxBytes)})`,
        );
      }
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
export async function compressBytes(
  input: Uint8Array,
  format: CompressionFormat = DEFAULT_COMPRESSION_ALGORITHM,
): Promise<Uint8Array> {
  ensureCompressionStreamsAvailable();
  const stream = new CompressionStream(format);
  const writer = stream.writable.getWriter();
  
  // Start reading from the readable stream before closing the writer
  // to avoid race conditions with the stream's internal buffering
  const readPromise = streamToUint8Array(stream.readable);
  
  await writer.write(input as BufferSource);
  await writer.close();
  
  return await readPromise;
}

/**
 * Reverses {@link compressBytes} by piping the given bytes through a
 * `DecompressionStream`.
 */
export async function decompressBytes(
  input: Uint8Array,
  format: CompressionFormat = 'gzip',
): Promise<Uint8Array> {
  ensureCompressionStreamsAvailable();
  const stream = new DecompressionStream(format);
  const writer = stream.writable.getWriter();
  
  // Start reading from the readable stream before closing the writer
  // to avoid race conditions with the stream's internal buffering
  const readPromise = streamToUint8Array(
    stream.readable,
    MAX_DECOMPRESSED_PAYLOAD_BYTES,
  );
  
  await writer.write(input as BufferSource);
  await writer.close();
  
  return await readPromise;
}

type CompressionFormat = 'gzip' | 'deflate' | 'deflate-raw'
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
    return fromBase64(base64, { alphabet: "base64url" });
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
  return base64.replace(/\+/g, "-").replace(/\//g, "_");
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
 */
export async function encodeMarkdownToBase64(
  markdown: string,
  format: CompressionFormat = DEFAULT_COMPRESSION_ALGORITHM,
): Promise<string> {
  const bytes = encoder.encode(markdown);
  const compressed = await compressBytes(bytes, format);
  return bytesToBase64(compressed);
}

/**
 * Decodes a base64 (URL alphabet) payload produced by
 * {@link encodeMarkdownToBase64} back into the original compressed bytes.
 */
export async function decodeBase64Markdown(
  base64: string,
  format: CompressionFormat = DEFAULT_COMPRESSION_ALGORITHM,
): Promise<Uint8Array> {
  if (base64.length > MAX_BASE64_PAYLOAD_CHARS) {
    throw new Error(
      `Encoded payload exceeds limit (${MAX_BASE64_PAYLOAD_CHARS.toLocaleString()} characters)`,
    );
  }
  const compressed = base64ToBytes(base64);
  if (compressed.byteLength > MAX_COMPRESSED_PAYLOAD_BYTES) {
    throw new Error(
      `Compressed payload exceeds limit (${describeBytes(MAX_COMPRESSED_PAYLOAD_BYTES)})`,
    );
  }
  return await decompressBytes(compressed, format);
}

/**
 * Convenience helper that combines {@link decodeBase64Markdown} with UTF-8
 * decoding for consumers that want the markdown string directly.
 */
export async function decodeBase64MarkdownAsText(
  base64: string,
  format: CompressionFormat = DEFAULT_COMPRESSION_ALGORITHM,
): Promise<string> {
  const bytes = await decodeBase64Markdown(base64, format);
  return decoder.decode(bytes);
}

export type { CompressionFormat };
