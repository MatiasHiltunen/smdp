import assert from "node:assert/strict";
import test from "node:test";

import {
  base79DecodeWithChecksum,
  base79UrlSafeDecode,
  base79UrlSafeEncode,
  base79EncodeWithChecksum,
} from "../src/data-link/base79";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("round-trips arbitrary data via base79 encode/decode", () => {
  const input = encoder.encode("Hello, world!");
  const encoded = base79UrlSafeEncode(input);
  const decoded = base79UrlSafeDecode(encoded);
  assert.equal(decoder.decode(decoded), "Hello, world!");
});

test("preserves leading zero bytes", () => {
  const input = new Uint8Array([0, 0, 1, 2, 3, 0]);
  const encoded = base79UrlSafeEncode(input);
  const decoded = base79UrlSafeDecode(encoded);
  assert.deepEqual(Array.from(decoded), Array.from(input));
});

test("returns empty array for empty input", () => {
  assert.equal(base79UrlSafeEncode(new Uint8Array(0)), "");
  assert.equal(base79UrlSafeEncode(null), "");
  assert.equal(base79UrlSafeEncode(undefined), "");
  assert.equal(base79UrlSafeDecode("").length, 0);
});

test("detects checksum mismatches", () => {
  const source = encoder.encode("checksum me");
  const encoded = base79EncodeWithChecksum(source);
  const bytes = base79DecodeWithChecksum(encoded);
  assert.ok(bytes);
  assert.equal(decoder.decode(bytes), "checksum me");

  // Corrupt the payload by flipping one character.
  const altered = encoded.slice(0, -1) + "A";
  const corrupted = base79DecodeWithChecksum(altered);
  assert.equal(corrupted, null);
});
