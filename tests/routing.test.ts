import assert from "node:assert/strict";
import test from "node:test";

import { parseRoute } from "../src/client/routing";

test("data routes read payload from hash fragment", () => {
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = {
    location: {
      pathname: "/data",
      hash: "#ZmFrZS1wYXlsb2Fk",
      search: "",
    },
  };

  try {
    const route = parseRoute();
    assert.equal(route.shared, true);
    assert.equal(route.dataPayload, "ZmFrZS1wYXlsb2Fk");
    assert.equal(route.externalUrl, null);
  } finally {
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  }
});

test("legacy data routes continue to prefer path payload", () => {
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = {
    location: {
      pathname: "/data/YmFja3dhcmRz",
      hash: "#ignored",
      search: "",
    },
  };

  try {
    const route = parseRoute();
    assert.equal(route.shared, true);
    assert.equal(route.dataPayload, "YmFja3dhcmRz");
  } finally {
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  }
});
