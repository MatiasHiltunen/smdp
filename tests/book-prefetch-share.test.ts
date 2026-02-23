import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBookPrefetchPayload,
  encodeBookPrefetchPayload,
} from "../src/client/book-prefetch-share";

const hasCompressionStreams =
  typeof CompressionStream !== "undefined" &&
  typeof DecompressionStream !== "undefined";

test("book prefetch payload encodes and decodes canonical markdown parts", async () => {
  if (!hasCompressionStreams) return;

  const entryUrl = "https://raw.githubusercontent.com/acme/docs/main/README.md";
  const encoded = await encodeBookPrefetchPayload(entryUrl, [
    {
      url: "https://raw.githubusercontent.com/acme/docs/main/chapter-1.md#intro",
      baseUrl:
        "https://raw.githubusercontent.com/acme/docs/main/chapter-1.md?plain=1",
      markdown: "# Chapter 1\n\nBody.",
    },
    {
      url: "https://raw.githubusercontent.com/acme/docs/main/chapter-2.md",
      baseUrl: "https://raw.githubusercontent.com/acme/docs/main/chapter-2.md",
      markdown: "# Chapter 2\n\nBody.",
    },
    {
      url: "https://raw.githubusercontent.com/acme/docs/main/chapter-2.md#dup",
      baseUrl: "https://raw.githubusercontent.com/acme/docs/main/chapter-2.md",
      markdown: "# Duplicate should dedupe",
    },
  ]);

  assert.ok(encoded);
  const decoded = await decodeBookPrefetchPayload(encoded);
  assert.ok(decoded);
  assert.equal(decoded?.entryUrl, entryUrl);
  assert.deepEqual(
    decoded?.parts.map((part) => part.url),
    [
      "https://raw.githubusercontent.com/acme/docs/main/chapter-1.md",
      "https://raw.githubusercontent.com/acme/docs/main/chapter-2.md",
    ],
  );
});

test("book prefetch payload returns null when size budget is too small", async () => {
  if (!hasCompressionStreams) return;

  const encoded = await encodeBookPrefetchPayload(
    "https://raw.githubusercontent.com/acme/docs/main/README.md",
    [
      {
        url: "https://raw.githubusercontent.com/acme/docs/main/chapter-1.md",
        baseUrl: "https://raw.githubusercontent.com/acme/docs/main/chapter-1.md",
        markdown: "# Chapter 1\n\nThis payload should not fit in tiny budget.",
      },
    ],
    { maxPayloadChars: 8 },
  );
  assert.equal(encoded, null);
});

test("book prefetch payload decoder rejects malformed payloads", async () => {
  if (!hasCompressionStreams) return;
  const decoded = await decodeBookPrefetchPayload("not-base64-url");
  assert.equal(decoded, null);
});
