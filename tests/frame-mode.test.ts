import assert from "node:assert/strict";
import test from "node:test";

import {
  getBackgroundModeFromSearch,
  getFrameModeFromSearch,
  parseBackgroundMode,
  parseFrameMode,
  setBackgroundModeSearchParam,
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

test("parseBackgroundMode defaults to full for empty or invalid values", () => {
  assert.equal(parseBackgroundMode(null), "full");
  assert.equal(parseBackgroundMode(""), "full");
  assert.equal(parseBackgroundMode("invalid"), "full");
});

test("getBackgroundModeFromSearch reads bg query value", () => {
  assert.equal(getBackgroundModeFromSearch("?bg=soft"), "soft");
  assert.equal(getBackgroundModeFromSearch("?bg=none"), "none");
  assert.equal(getBackgroundModeFromSearch("?d=abc"), "full");
});

test("setFrameModeSearchParam stores non-default modes and omits full", () => {
  const params = new URLSearchParams("d=x");
  setFrameModeSearchParam(params, "none");
  assert.equal(params.get("fm"), "none");

  setFrameModeSearchParam(params, "full");
  assert.equal(params.get("fm"), null);
});

test("setBackgroundModeSearchParam stores non-default modes and omits full", () => {
  const params = new URLSearchParams("d=x");
  setBackgroundModeSearchParam(params, "soft");
  assert.equal(params.get("bg"), "soft");

  setBackgroundModeSearchParam(params, "full");
  assert.equal(params.get("bg"), null);
});
