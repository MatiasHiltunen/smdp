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

test("book routes parse entry and selected part", () => {
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = {
    location: {
      pathname: "/book/https://github.com/acme/docs/blob/main/README.md",
      hash: "#intro",
      search:
        "?part=https%3A%2F%2Fraw.githubusercontent.com%2Facme%2Fdocs%2Fmain%2Fchapter-1.md",
    },
  };

  try {
    const route = parseRoute();
    assert.equal(route.mode, "html");
    assert.equal(route.shared, false);
    assert.equal(
      route.bookEntryUrl?.toString(),
      "https://github.com/acme/docs/blob/main/README.md",
    );
    assert.equal(
      route.bookPartUrl?.toString(),
      "https://raw.githubusercontent.com/acme/docs/main/chapter-1.md",
    );
    assert.equal(
      route.externalUrl?.toString(),
      "https://raw.githubusercontent.com/acme/docs/main/chapter-1.md",
    );
    assert.equal(route.bookPrefetchPayload, null);
  } finally {
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  }
});

test("shared routes can carry embedded book navigation context", () => {
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = {
    location: {
      pathname: "/shared/https://raw.githubusercontent.com/acme/docs/main/chapter-2.md",
      hash: "",
      search:
        "?be=https%3A%2F%2Fraw.githubusercontent.com%2Facme%2Fdocs%2Fmain%2FREADME.md&bp=prefetch-data",
    },
  };

  try {
    const route = parseRoute();
    assert.equal(route.mode, "html");
    assert.equal(route.shared, true);
    assert.equal(
      route.bookEntryUrl?.toString(),
      "https://raw.githubusercontent.com/acme/docs/main/README.md",
    );
    assert.equal(
      route.bookPartUrl?.toString(),
      "https://raw.githubusercontent.com/acme/docs/main/chapter-2.md",
    );
    assert.equal(route.bookPrefetchPayload, "prefetch-data");
  } finally {
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  }
});

test("route parsing tolerates malformed percent-encoding in pathname", () => {
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = {
    location: {
      pathname: "/data/%E0%A4%A",
      hash: "",
      search: "",
    },
  };

  try {
    const route = parseRoute();
    assert.equal(route.mode, "html");
    assert.equal(route.shared, true);
  } finally {
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  }
});

test("test_e2e route parses target url from path", () => {
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = {
    location: {
      pathname: "/test_e2e/https://raw.githubusercontent.com/acme/docs/main/README.md",
      hash: "",
      search: "",
    },
  };

  try {
    const route = parseRoute();
    assert.equal(route.mode, "test_e2e");
    assert.equal(route.shared, false);
    assert.equal(
      route.externalUrl?.toString(),
      "https://raw.githubusercontent.com/acme/docs/main/README.md",
    );
  } finally {
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  }
});

test("test_e2e route parses target url from query", () => {
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = {
    location: {
      pathname: "/test_e2e",
      hash: "",
      search: "?url=https%3A%2F%2Fexample.com%2Fnotes.md",
    },
  };

  try {
    const route = parseRoute();
    assert.equal(route.mode, "test_e2e");
    assert.equal(route.shared, false);
    assert.equal(route.externalUrl?.toString(), "https://example.com/notes.md");
  } finally {
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  }
});
