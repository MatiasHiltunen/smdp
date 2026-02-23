import { compressBytes, decompressBytes } from "../data-link";
import { TD, TE } from "../parser/constants";
import { canonicalizeMarkdownDocumentUrl } from "./github-url";

type Base64Options = {
  alphabet?: "base64" | "base64url";
};

type EncodedBookPrefetchPayloadV1 = {
  v: 1;
  e: string;
  p: [string, string, string][];
};

const UINT8ARRAY_WITH_BASE64 = Uint8Array as unknown as {
  fromBase64?: (data: string, options?: Base64Options) => Uint8Array;
  prototype: {
    toBase64?: (options?: Base64Options) => string;
  };
};

const DEFAULT_MAX_PREFETCH_PAYLOAD_CHARS = 3 * 1024 * 1024;
const DEFAULT_MAX_PREFETCH_PARTS = 48;
const MAX_DECODED_PAYLOAD_BYTES = 10 * 1024 * 1024;

export type BookPrefetchPayloadPart = {
  url: string;
  baseUrl: string;
  markdown: string;
};

export type DecodedBookPrefetchPayload = {
  entryUrl: string;
  parts: BookPrefetchPayloadPart[];
};

function bytesToBase64Url(bytes: Uint8Array): string {
  const toBase64 = UINT8ARRAY_WITH_BASE64.prototype.toBase64;
  if (typeof toBase64 === "function") {
    return toBase64.call(bytes, { alphabet: "base64url" });
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(base64: string): Uint8Array {
  const fromBase64 = UINT8ARRAY_WITH_BASE64.fromBase64;
  if (typeof fromBase64 === "function") {
    return fromBase64(base64, { alphabet: "base64url" });
  }

  const normalized = base64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizePrefetchPart(
  part: BookPrefetchPayloadPart,
): BookPrefetchPayloadPart | null {
  const canonicalUrl = canonicalizeMarkdownDocumentUrl(part.url);
  if (!canonicalUrl) return null;
  const canonicalBaseUrl =
    canonicalizeMarkdownDocumentUrl(part.baseUrl, canonicalUrl) ?? canonicalUrl;
  if (typeof part.markdown !== "string" || part.markdown.length === 0) {
    return null;
  }
  return {
    url: canonicalUrl,
    baseUrl: canonicalBaseUrl,
    markdown: part.markdown,
  };
}

function encodePayload(
  payload: EncodedBookPrefetchPayloadV1,
): Promise<string> {
  return (async () => {
    const json = JSON.stringify(payload);
    const bytes = TE.encode(json);
    const compressed = await compressBytes(bytes);
    return bytesToBase64Url(compressed);
  })();
}

export async function encodeBookPrefetchPayload(
  entryUrl: string,
  parts: readonly BookPrefetchPayloadPart[],
  options: {
    maxPayloadChars?: number;
    maxParts?: number;
  } = {},
): Promise<string | null> {
  const canonicalEntry = canonicalizeMarkdownDocumentUrl(entryUrl);
  if (!canonicalEntry) {
    return null;
  }

  const maxPayloadChars =
    options.maxPayloadChars ?? DEFAULT_MAX_PREFETCH_PAYLOAD_CHARS;
  const maxParts = options.maxParts ?? DEFAULT_MAX_PREFETCH_PARTS;
  const unique = new Map<string, BookPrefetchPayloadPart>();

  for (const part of parts) {
    const normalized = normalizePrefetchPart(part);
    if (!normalized) continue;
    if (!unique.has(normalized.url)) {
      unique.set(normalized.url, normalized);
    }
    if (unique.size >= maxParts) {
      break;
    }
  }

  const ordered = Array.from(unique.values());
  if (ordered.length === 0) {
    return null;
  }

  for (let count = ordered.length; count > 0; count -= 1) {
    const payload: EncodedBookPrefetchPayloadV1 = {
      v: 1,
      e: canonicalEntry,
      p: ordered.slice(0, count).map((part) => [
        part.url,
        part.baseUrl,
        part.markdown,
      ]),
    };
    const encoded = await encodePayload(payload);
    if (encoded.length <= maxPayloadChars) {
      return encoded;
    }
  }

  return null;
}

export async function decodeBookPrefetchPayload(
  encoded: string | null,
  options: { maxPayloadChars?: number } = {},
): Promise<DecodedBookPrefetchPayload | null> {
  if (!encoded) return null;
  const maxPayloadChars =
    options.maxPayloadChars ?? DEFAULT_MAX_PREFETCH_PAYLOAD_CHARS;
  if (encoded.length > maxPayloadChars) {
    return null;
  }

  try {
    const compressed = base64UrlToBytes(encoded);
    // Payloads are encoded with gzip; reject obviously invalid byte streams
    // before invoking the decompressor to avoid stream-side async errors.
    if (
      compressed.byteLength < 2 ||
      compressed[0] !== 0x1f ||
      compressed[1] !== 0x8b
    ) {
      return null;
    }
    const decompressed = await decompressBytes(compressed);
    if (decompressed.byteLength > MAX_DECODED_PAYLOAD_BYTES) {
      return null;
    }
    const json = TD.decode(decompressed);
    const parsed = JSON.parse(json) as Partial<EncodedBookPrefetchPayloadV1>;

    if (parsed.v !== 1 || typeof parsed.e !== "string" || !Array.isArray(parsed.p)) {
      return null;
    }

    const canonicalEntry = canonicalizeMarkdownDocumentUrl(parsed.e);
    if (!canonicalEntry) {
      return null;
    }

    const parts: BookPrefetchPayloadPart[] = [];
    const seen = new Set<string>();
    for (const tuple of parsed.p) {
      if (!Array.isArray(tuple) || tuple.length !== 3) continue;
      const [url, baseUrl, markdown] = tuple;
      if (
        typeof url !== "string" ||
        typeof baseUrl !== "string" ||
        typeof markdown !== "string"
      ) {
        continue;
      }
      const normalized = normalizePrefetchPart({ url, baseUrl, markdown });
      if (!normalized) continue;
      if (seen.has(normalized.url)) continue;
      seen.add(normalized.url);
      parts.push(normalized);
      if (parts.length >= DEFAULT_MAX_PREFETCH_PARTS) break;
    }

    return {
      entryUrl: canonicalEntry,
      parts,
    };
  } catch {
    return null;
  }
}
