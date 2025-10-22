import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { decodeBase64Markdown, decodeBase64MarkdownAsText, encodeMarkdownToBase64 } from "../src/data-link";

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function padBase64Url(value: string): string {
  const padding = (4 - (value.length % 4)) % 4;
  return value + "=".repeat(padding);
}

class IdentityCompressionStream {
  public readonly readable: ReadableStream<Uint8Array>;
  public readonly writable: WritableStream<Uint8Array>;

  constructor() {
    // Create a passthrough pair so writes immediately surface on the readable
    // side. The real CompressionStream would transform the payload but for the
    // purposes of these tests we simply want to capture the bytes that flow
    // through the piping logic.
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    this.readable = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
      },
    });

    this.writable = new WritableStream<Uint8Array | ArrayBuffer>({
      write(chunk) {
        if (!controllerRef) {
          throw new Error("Compression stream is not initialized");
        }
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        controllerRef.enqueue(new Uint8Array(bytes));
      },
      close() {
        controllerRef?.close();
      },
      abort(reason) {
        controllerRef?.error(reason);
      },
    });
  }
}

async function withCompressionSupport<T>(fn: () => Promise<T>): Promise<T> {
  const hadCompressionStream = "CompressionStream" in globalThis;
  const hadDecompressionStream = "DecompressionStream" in globalThis;
  const previousCompressionStream = (globalThis as any).CompressionStream;
  const previousDecompressionStream = (globalThis as any).DecompressionStream;
  const hadBtoa = "btoa" in globalThis;
  const hadAtob = "atob" in globalThis;
  const previousBtoa = (globalThis as any).btoa;
  const previousAtob = (globalThis as any).atob;

  (globalThis as any).CompressionStream = IdentityCompressionStream;
  (globalThis as any).DecompressionStream = IdentityCompressionStream;

  if (!hadBtoa) {
    (globalThis as any).btoa = (data: string) => Buffer.from(data, "binary").toString("base64");
  }

  if (!hadAtob) {
    (globalThis as any).atob = (data: string) => Buffer.from(data, "base64").toString("binary");
  }

  try {
    return await fn();
  } finally {
    if (hadCompressionStream) {
      (globalThis as any).CompressionStream = previousCompressionStream;
    } else {
      delete (globalThis as any).CompressionStream;
    }

    if (hadDecompressionStream) {
      (globalThis as any).DecompressionStream = previousDecompressionStream;
    } else {
      delete (globalThis as any).DecompressionStream;
    }

    if (hadBtoa) {
      (globalThis as any).btoa = previousBtoa;
    } else {
      delete (globalThis as any).btoa;
    }

    if (hadAtob) {
      (globalThis as any).atob = previousAtob;
    } else {
      delete (globalThis as any).atob;
    }
  }
}

test("encodes and decodes markdown round-trip", { concurrency: false }, async () => {
  await withCompressionSupport(async () => {
    const markdown = "# Heading\n- item 1\n- item 2";
    const base64 = await encodeMarkdownToBase64(markdown);

    assert.ok(!base64.includes("+"));
    assert.ok(!base64.includes("/"));

    const decodedBytes = await decodeBase64Markdown(base64);
    assert.equal(new TextDecoder().decode(decodedBytes), markdown);

    const decodedText = await decodeBase64MarkdownAsText(base64);
    assert.equal(decodedText, markdown);
  });
});

test("prefers native Uint8Array base64 helpers when available", { concurrency: false }, async () => {
  await withCompressionSupport(async () => {
    const originalToBase64 = (Uint8Array.prototype as any).toBase64;
    const originalFromBase64 = (Uint8Array as any).fromBase64;

    const toBase64Options: Array<{ alphabet?: string }> = [];
    const fromBase64Options: Array<{ alphabet?: string }> = [];

    try {
      (Uint8Array.prototype as any).toBase64 = function toBase64(options?: { alphabet?: string }) {
        toBase64Options.push({ ...options });
        return toBase64Url(Buffer.from(this as Uint8Array));
      };

      (Uint8Array as any).fromBase64 = function fromBase64(value: string, options?: { alphabet?: string }) {
        fromBase64Options.push({ ...options });
        const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
        const padded = padBase64Url(normalized);
        return new Uint8Array(Buffer.from(padded, "base64"));
      };

      const markdown = "Native helpers exercise";
      const base64 = await encodeMarkdownToBase64(markdown);
      assert.equal(toBase64Options.length, 1);
      assert.equal(toBase64Options[0]?.alphabet, "base64url");

      const decoded = await decodeBase64MarkdownAsText(base64);
      assert.equal(fromBase64Options.length, 1);
      assert.equal(fromBase64Options[0]?.alphabet, "base64url");
      assert.equal(decoded, markdown);
    } finally {
      if (originalToBase64) {
        (Uint8Array.prototype as any).toBase64 = originalToBase64;
      } else {
        delete (Uint8Array.prototype as any).toBase64;
      }

      if (originalFromBase64) {
        (Uint8Array as any).fromBase64 = originalFromBase64;
      } else {
        delete (Uint8Array as any).fromBase64;
      }
    }
  });
});

test("falls back to manual base64 helpers when Uint8Array extensions are missing", { concurrency: false }, async () => {
  await withCompressionSupport(async () => {
    const originalToBase64 = (Uint8Array.prototype as any).toBase64;
    const originalFromBase64 = (Uint8Array as any).fromBase64;

    try {
      delete (Uint8Array.prototype as any).toBase64;
      delete (Uint8Array as any).fromBase64;

      const markdown = "Fallback helper coverage";
      const base64 = await encodeMarkdownToBase64(markdown);

      // The fallback uses the URL alphabet and trims padding, same as the
      // native helpers. Double-check we didn't regress that behaviour.
      assert.ok(!base64.includes("+"));
      assert.ok(!base64.includes("/"));
      assert.ok(!base64.endsWith("="));

      const decoded = await decodeBase64MarkdownAsText(base64);
      assert.equal(decoded, markdown);
    } finally {
      if (originalToBase64) {
        (Uint8Array.prototype as any).toBase64 = originalToBase64;
      }
      if (originalFromBase64) {
        (Uint8Array as any).fromBase64 = originalFromBase64;
      }
    }
  });
});
