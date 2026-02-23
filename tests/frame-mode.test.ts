import assert from "node:assert/strict";
import test from "node:test";

import {
  getFrameModeFromSearch,
  parseFrameMode,
  setFrameModeSearchParam,
} from "../src/client/frame-mode";

test("parseFrameMode defaults to full for empty or invalid values", () => {
  assert.equal(parseFrameMode(null), "full");
  assert.equal(parseFrameMode(""), "full");
  assert.equal(parseFrameMode("invalid"), "full");
});

test("getFrameModeFromSearch reads fm query value", () => {
  assert.equal(getFrameModeFromSearch("?fm=minimal"), "minimal");
  assert.equal(getFrameModeFromSearch("?fm=none"), "none");
  assert.equal(getFrameModeFromSearch("?d=abc"), "full");
});

test("setFrameModeSearchParam stores non-default modes and omits full", () => {
  const params = new URLSearchParams("d=x");
  setFrameModeSearchParam(params, "none");
  assert.equal(params.get("fm"), "none");

  setFrameModeSearchParam(params, "full");
  assert.equal(params.get("fm"), null);
});
