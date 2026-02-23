import assert from "node:assert/strict";
import test from "node:test";

import { buildExportHtmlDocument } from "../src/client/ui";

test("buildExportHtmlDocument keeps mode-html shell and visual body classes", () => {
  const originalDocument = (globalThis as any).document;
  const originalWindow = (globalThis as any).window;

  const rootStyle = {
    length: 1,
    item(index: number): string {
      return index === 0 ? "--accent" : "";
    },
    getPropertyValue(name: string): string {
      return name === "--accent" ? "#123456" : "";
    },
  };

  (globalThis as any).document = {
    styleSheets: [
      {
        cssRules: [{ cssText: ".markdown-viewer { color: red; }" }],
      },
    ],
    documentElement: {
      getAttribute(name: string): string | null {
        if (name === "data-theme") return "dark";
        return null;
      },
      style: rootStyle,
    },
    body: {
      classList: {
        contains(name: string): boolean {
          return name === "background-mode-soft" || name === "frame-mode-none";
        },
      },
    },
  };

  (globalThis as any).window = {
    location: {
      search: "",
    },
  };

  try {
    const html = buildExportHtmlDocument({
      shell: {
        querySelector(selector: string) {
          if (selector === ".markdown-viewer") {
            return { innerHTML: "<h1>Export</h1>" };
          }
          return null;
        },
      },
    } as any);

    assert.ok(html);
    assert.ok(html.includes('<div class="app-shell mode-html">'));
    assert.ok(
      html.includes('<body class="background-mode-soft frame-mode-none">'),
    );
  } finally {
    if (originalDocument) {
      (globalThis as any).document = originalDocument;
    } else {
      delete (globalThis as any).document;
    }
    if (originalWindow) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  }
});
