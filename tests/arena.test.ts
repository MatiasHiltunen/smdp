import assert from "node:assert/strict";
import test from "node:test";

import { HtmlArena } from "../src/parser/arena.ts";

test("writeUtf8 preserves non-ASCII content", () => {
  const arena = new HtmlArena(64);
  arena.writeUtf8("päätteessä 🐶");
  assert.equal(arena.toString(), "päätteessä 🐶");
});

test("arena grows past its initial capacity", () => {
  const arena = new HtmlArena(2);
  arena.writeAscii("ab");
  arena.writeAscii("cdef");

  assert.equal(arena.toString(), "abcdef");
  assert.deepEqual([...arena.toUint8Array()], [97, 98, 99, 100, 101, 102]);
});

test("writeAscii rejects non-ASCII input", () => {
  const arena = new HtmlArena(32);
  assert.throws(
    () => arena.writeAscii("↩"),
    /writeAscii only accepts ASCII input/,
  );
});
