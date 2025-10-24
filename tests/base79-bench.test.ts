import assert from "node:assert/strict";
import test from "node:test";

import { base79UrlSafeEncode } from "../src/data-link/base79";

test("bench: base79 vs base64url encoding", { concurrency: false }, () => {
  const sizes = [256, 1024, 4096, 16384];
  const iterations = 10;
  const generator = createDeterministicGenerator(0x01234567);

  const encodeBase64 = (bytes: Uint8Array): string => {
    const proto = (Uint8Array.prototype as unknown as { toBase64?: (options?: { alphabet?: string }) => string }).toBase64;
    if (typeof proto === "function") {
      return proto.call(bytes, { alphabet: "base64url" });
    }
    return Buffer.from(bytes).toString("base64url");
  };

  console.log("=== Base79 vs Base64url Encoding Benchmark ===");
  for (const size of sizes) {
    const dataset = Array.from({ length: iterations }, () => generator(size));
    const base79Durations: number[] = [];
    const base64Durations: number[] = [];
    const base79Lengths: number[] = [];
    const base64Lengths: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const bytes = dataset[i];

      let start = performance.now();
      const encoded79 = base79UrlSafeEncode(bytes);
      base79Durations.push(performance.now() - start);
      base79Lengths.push(encoded79.length);

      start = performance.now();
      const encoded64 = encodeBase64(bytes);
      base64Durations.push(performance.now() - start);
      base64Lengths.push(encoded64.length);
    }

    const avg79Len = average(base79Lengths);
    const avg64Len = average(base64Lengths);
    const avg79Time = average(base79Durations);
    const avg64Time = average(base64Durations);

    console.log(
      `[${size} bytes] base79: ${avg79Time.toFixed(4)} ms, len ${avg79Len.toFixed(2)} | base64url: ${avg64Time.toFixed(4)} ms, len ${avg64Len.toFixed(2)} | len ratio ${(
        avg79Len / avg64Len
      ).toFixed(4)}`,
    );

    // Theoretical maximum should be shorter or equal for base79.
    assert.ok(avg79Len <= avg64Len + 1, "Base79 should not exceed base64url length by a meaningful margin");
  }
});

function createDeterministicGenerator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };

  return (size: number): Uint8Array => {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 4) {
      const value = next();
      bytes[i] = value & 0xff;
      if (i + 1 < size) bytes[i + 1] = (value >>> 8) & 0xff;
      if (i + 2 < size) bytes[i + 2] = (value >>> 16) & 0xff;
      if (i + 3 < size) bytes[i + 3] = (value >>> 24) & 0xff;
    }
    return bytes;
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
