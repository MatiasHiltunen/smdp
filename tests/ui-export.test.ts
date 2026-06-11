import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPdfExportBlob,
  buildExportHtmlDocument,
  buildExportHtmlDocumentFromViewerHtml,
  parseCssColorToPdfRGB,
  resolvePdfCodeColorsFromStyle,
} from "../src/client/ui";

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

test("buildExportHtmlDocumentFromViewerHtml includes export styles and custom additions", () => {
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
        if (name === "data-theme") return "light";
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
    const html = buildExportHtmlDocumentFromViewerHtml("<h2>Book</h2>", {
      extraStyles: ".embedded-book-nav{display:block;}",
    });
    assert.ok(html.includes('<div class="app-shell mode-html">'));
    assert.ok(html.includes('<body class="background-mode-soft frame-mode-none">'));
    assert.ok(html.includes("<h2>Book</h2>"));
    assert.ok(html.includes(".embedded-book-nav{display:block;}"));
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

test("buildPdfExportBlob returns PDF bytes", async () => {
  const blob = await buildPdfExportBlob({
    markdown: "# PDF Export\n\nBody text.",
  });
  const text = new TextDecoder().decode(await blob.arrayBuffer());

  assert.equal(blob.type, "application/pdf");
  assert.ok(blob.size > 0);
  assert.ok(text.startsWith("%PDF-1.7\n"));
  assert.match(text, /\/Type \/Catalog/);
});

test("buildPdfExportBlob applies computed theme code colors", async () => {
  const originalDocument = (globalThis as any).document;
  const originalWindow = (globalThis as any).window;
  const style = {
    getPropertyValue(name: string): string {
      return name === "--code-kw" ? "#ff0000" : "";
    },
  };

  (globalThis as any).document = {
    documentElement: {},
  };
  (globalThis as any).window = {
    getComputedStyle() {
      return style;
    },
  };

  try {
    const blob = await buildPdfExportBlob({
      markdown: "```js\nconst answer = 42;\n```",
    });
    const text = new TextDecoder().decode(await blob.arrayBuffer());

    assert.match(text, /1 0 0 rg\n1 0 0 1 [\d.]+ [\d.]+ Tm\n<636F6E7374> Tj/);
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

test("parseCssColorToPdfRGB supports export-safe CSS color forms", () => {
  assert.deepEqual(parseCssColorToPdfRGB("#369"), [
    0x33 / 255,
    0x66 / 255,
    0x99 / 255,
  ]);
  assert.deepEqual(parseCssColorToPdfRGB("#336699"), [
    0x33 / 255,
    0x66 / 255,
    0x99 / 255,
  ]);
  assert.deepEqual(parseCssColorToPdfRGB("rgb(255, 128, 0)"), [
    1,
    128 / 255,
    0,
  ]);
  assert.deepEqual(parseCssColorToPdfRGB("rgb(100% 50% 0%)"), [
    1,
    0.5,
    0,
  ]);
  assert.equal(parseCssColorToPdfRGB("currentColor"), null);
  assert.equal(parseCssColorToPdfRGB("not-a-color"), null);
});

test("resolvePdfCodeColorsFromStyle maps theme code tokens", () => {
  const style = {
    getPropertyValue(name: string): string {
      if (name === "--code-kw") return "#ff0000";
      if (name === "--code-num") return "rgb(0, 0, 255)";
      if (name === "--code-com") return "invalid";
      return "";
    },
  };
  const colors = resolvePdfCodeColorsFromStyle(style);

  assert.deepEqual(colors.kw, [1, 0, 0]);
  assert.deepEqual(colors.num, [0, 0, 1]);
  assert.equal(colors.com, undefined);
});
