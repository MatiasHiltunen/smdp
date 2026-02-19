import assert from "node:assert/strict";
import test from "node:test";

import { HtmlArena } from "../src/parser/arena.ts";

test("writeUtf8 preserves non-ASCII content", () => {
  const arena = new HtmlArena(64);
  arena.writeUtf8("päätteessä 🐶");
  assert.equal(arena.toString(), "päätteessä 🐶");
});

test("writeAscii rejects non-ASCII input", () => {
  const arena = new HtmlArena(32);
  assert.throws(
    () => arena.writeAscii("↩"),
    /writeAscii only accepts ASCII input/,
  );
});
