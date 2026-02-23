import assert from "node:assert/strict";
import test from "node:test";

import { shouldAllowRawHtmlForRoute } from "../src/client/render-options";

test("allows raw html in html mode", () => {
  assert.equal(shouldAllowRawHtmlForRoute({ mode: "html" }), true);
});

test("allows raw html in canvas mode", () => {
  assert.equal(shouldAllowRawHtmlForRoute({ mode: "canvas" }), true);
});

test("keeps raw html disabled for test_e2e mode", () => {
  assert.equal(shouldAllowRawHtmlForRoute({ mode: "test_e2e" }), false);
});
