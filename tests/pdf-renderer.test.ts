import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync, inflateSync } from "node:zlib";

import { MDParser, u8 } from "../src/parser/index.ts";
import {
  renderPDFFromBlocks,
  renderPDFFromBlocksAsync,
} from "../src/parser/pdf-renderer.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function decodePdf(pdf: Uint8Array): string {
  return decoder.decode(pdf);
}

function hexText(value: string): string {
  return Array.from(encoder.encode(value), (byte) =>
    byte.toString(16).toUpperCase().padStart(2, "0"),
  ).join("");
}

function textFromHex(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return decoder.decode(bytes);
}

function textFromUtf16BeHex(hex: string): string {
  const codeUnits: number[] = [];
  const offset = hex.startsWith("FEFF") ? 4 : 0;
  for (let index = offset; index + 3 < hex.length; index += 4) {
    codeUnits.push(Number.parseInt(hex.slice(index, index + 4), 16));
  }
  return String.fromCharCode(...codeUnits);
}

function extractTextRuns(pdf: Uint8Array): Array<{ value: string; x: number; y: number }> {
  const text = decodePdf(pdf);
  const runs: Array<{ value: string; x: number; y: number }> = [];
  const runRe = /1 0 0 1 ([\d.]+) ([\d.]+) Tm\n<([0-9A-F]*)> Tj/g;
  for (const match of text.matchAll(runRe)) {
    runs.push({
      x: Number(match[1]),
      y: Number(match[2]),
      value: textFromHex(match[3]),
    });
  }
  return runs;
}

function extractActualText(pdf: Uint8Array): string[] {
  const text = decodePdf(pdf);
  return Array.from(text.matchAll(/\/ActualText <([0-9A-F]+)>/g), (match) =>
    textFromUtf16BeHex(match[1]),
  );
}

function extractColoredTextRuns(
  pdf: Uint8Array,
): Array<{ value: string; color: [number, number, number]; x: number; y: number }> {
  const text = decodePdf(pdf);
  const runs: Array<{ value: string; color: [number, number, number]; x: number; y: number }> = [];
  const runRe = /([\d.]+) ([\d.]+) ([\d.]+) rg\n1 0 0 1 ([\d.]+) ([\d.]+) Tm\n<([0-9A-F]*)> Tj/g;
  for (const match of text.matchAll(runRe)) {
    runs.push({
      color: [Number(match[1]), Number(match[2]), Number(match[3])],
      x: Number(match[4]),
      y: Number(match[5]),
      value: textFromHex(match[6]),
    });
  }
  return runs;
}

function runX(runs: ReadonlyArray<{ value: string; x: number }>, value: string): number {
  const run = runs.find((candidate) => candidate.value.trim() === value);
  assert.ok(run, `expected text run ${value}`);
  return run.x;
}

function extractPdfText(pdf: Uint8Array): string {
  const runs = extractTextRuns(pdf);
  let text = "";
  let previousY: number | null = null;
  for (const run of runs) {
    if (previousY !== null && Math.abs(run.y - previousY) > 0.001) {
      text += "\n";
    }
    text += run.value;
    previousY = run.y;
  }
  return text;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  return concatBytes([
    u32(data.length),
    encoder.encode(type),
    data,
    new Uint8Array(4),
  ]);
}

function makeRgbPng(): Uint8Array {
  const ihdr = new Uint8Array([
    0, 0, 0, 1, // width
    0, 0, 0, 1, // height
    8, // bit depth
    2, // truecolor RGB
    0, // compression
    0, // filter
    0, // no interlace
  ]);
  const idat = new Uint8Array(deflateSync(new Uint8Array([0, 255, 0, 0])));
  return concatBytes([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function makeRgbaPng(): Uint8Array {
  const ihdr = new Uint8Array([
    0, 0, 0, 1, // width
    0, 0, 0, 1, // height
    8, // bit depth
    6, // truecolor RGBA
    0, // compression
    0, // filter
    0, // no interlace
  ]);
  const idat = new Uint8Array(deflateSync(new Uint8Array([0, 255, 0, 0, 128])));
  return concatBytes([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function makeJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0,
    0x00, 0x11,
    0x08,
    0x00, 0x01,
    0x00, 0x02,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

test("renders a structured markdown document to PDF bytes", () => {
  const pdf = renderPDFFromBlocks(
    u8(`# Heading

This is **bold** text with [a link](https://example.com).

- [x] Task item

\`\`\`ts
const value = 1;
\`\`\``),
  );
  const text = decodePdf(pdf);
  const extracted = extractPdfText(pdf);

  assert.ok(text.startsWith("%PDF-1.7\n"));
  assert.match(text, /\/Type \/Catalog/);
  assert.match(text, /\/BaseFont \/Helvetica/);
  assert.match(text, /\/BaseFont \/Courier/);
  assert.ok(extracted.includes("Heading"));
  assert.ok(extracted.includes("bold"));
  assert.ok(extracted.includes("[x]"));
  assert.match(text, /xref\n0 \d+/);
  assert.ok(text.endsWith("%%EOF\n"));
});

test("uses Base-14 glyph metrics to preserve PDF word spacing", () => {
  const pdf = renderPDFFromBlocks(
    u8("We treat Markdown parser & Project Links Well (Today)"),
    {
      pageSize: { width: 600, height: 240 },
      margin: 24,
      fontSize: 14,
    },
  );
  const runs = extractTextRuns(pdf);

  assert.ok(runX(runs, "treat") - runX(runs, "We") > 19);
  assert.ok(runX(runs, "parser") - runX(runs, "Markdown") > 67);
  assert.ok(runX(runs, "Project") - runX(runs, "&") > 12);
  assert.ok(runX(runs, "(Today)") - runX(runs, "Well") > 27);
});

test("keeps PDF spaces attached to extractable text runs", () => {
  const pdf = renderPDFFromBlocks(
    u8(`## What This Utility Does Well (Today)
1. Parses Markdown in a single forward pass, no backtracking.
2. Outputs clean HTML _and_ can render to Canvas for pixel-perfect previews.
3. Bundles a pragmatic syntax highlighter with precompiled grammars.

## Try It Yourself on md2.at
- Paste any public Markdown URL after the host:
- We stream the remote document.`),
    {
      pageSize: { width: 1000, height: 500 },
      margin: 24,
      fontSize: 14,
    },
  );
  const runs = extractTextRuns(pdf);
  const text = extractPdfText(pdf);

  assert.equal(runs.filter((run) => run.value === " ").length, 0);
  assert.ok(text.includes("What This Utility Does Well (Today)"));
  assert.ok(text.includes("Parses Markdown in a single forward pass"));
  assert.ok(text.includes("Outputs clean HTML and can render to Canvas for pixel-perfect previews."));
  assert.ok(text.includes("Try It Yourself on md2.at"));
  assert.ok(text.includes("Paste any public Markdown URL after the host:"));
  assert.ok(text.includes("We stream the remote document."));
  assert.doesNotMatch(text, /WhatThis|DoesWell|Markdownin|cleanHTMLandcan|Canvasfor|onmd2\.at|Westream/);
});

test("preserves unicode and emoji text as PDF ActualText", () => {
  const unicode = "Caf\u00e9 \u03b2 \u0416 \u4e2d\u6587 \u{1f600} \u2764\ufe0f";
  const pdf = renderPDFFromBlocks(
    u8(`Paragraph ${unicode}

\`\`\`txt
${unicode}
\`\`\`

| Kind | Value |
|:-----|:------|
| Text | ${unicode} |`),
    {
      pageSize: { width: 520, height: 520 },
      margin: 24,
      fontSize: 14,
    },
  );
  const pdfText = decodePdf(pdf);
  const actualText = extractActualText(pdf).join("\n");

  assert.ok(actualText.includes(unicode));
  assert.match(pdfText, /\/ActualText <FEFF/);
  assert.match(pdfText, /<[^>]*3F[^>]*> Tj/);
});

test("renders fenced code with syntax colors and extractable spacing", () => {
  const pdf = renderPDFFromBlocks(
    u8(`\`\`\`js
const answer = 42;
// comment
\`\`\``),
    {
      pageSize: { width: 420, height: 240 },
      margin: 24,
      fontSize: 14,
      codeColors: {
        kw: [1, 0, 0],
        id: [0.1, 0.1, 0.1],
        num: [0, 0, 1],
        com: [0, 0.5, 0],
      },
    },
  );
  const text = decodePdf(pdf);
  const extracted = extractPdfText(pdf);

  assert.match(text, /1 0 0 rg\n1 0 0 1 [\d.]+ [\d.]+ Tm\n<636F6E7374> Tj/);
  assert.match(text, /0 0 1 rg\n1 0 0 1 [\d.]+ [\d.]+ Tm\n<203432> Tj/);
  assert.match(text, /0 0.5 0 rg\n1 0 0 1 [\d.]+ [\d.]+ Tm\n<2F2F20636F6D6D656E74> Tj/);
  assert.ok(extracted.includes("const answer = 42;"));
  assert.ok(extracted.includes("// comment"));
  assert.equal(extractTextRuns(pdf).filter((run) => run.value === " ").length, 0);
});

test("keeps syntax colors on wrapped PDF code continuations", () => {
  const longLiteral = `"${"green-value-".repeat(12)}tail"`;
  const sourceLine = `const message = ${longLiteral};`;
  const pdf = renderPDFFromBlocks(
    u8(`\`\`\`js
${sourceLine}
\`\`\``),
    {
      pageSize: { width: 250, height: 600 },
      margin: 24,
      fontSize: 14,
      codeColors: {
        kw: [1, 0, 0],
        id: [0.1, 0.1, 0.1],
        str: [0, 0.5, 0],
        punc: [0.5, 0, 0.5],
      },
    },
  );
  const extracted = extractPdfText(pdf).replace(/\n/g, "");
  const greenRuns = extractColoredTextRuns(pdf).filter(
    (run) => run.color[0] === 0 && run.color[1] === 0.5 && run.color[2] === 0,
  );

  assert.ok(extracted.includes(sourceLine));
  assert.ok(greenRuns.length >= 2);
  assert.ok(new Set(greenRuns.map((run) => run.y)).size >= 2);
  assert.ok(greenRuns.map((run) => run.value).join("").includes(longLiteral));
  assert.equal(extractTextRuns(pdf).filter((run) => run.value === " ").length, 0);
});

test("colors empty and whitespace-only PDF code block rows", () => {
  const pdf = renderPDFFromBlocks(
    u8(`\`\`\`js
const first = 1;

${"   "}
const second = 2;
\`\`\``),
    {
      pageSize: { width: 420, height: 320 },
      margin: 24,
      fontSize: 14,
    },
  );
  const text = decodePdf(pdf);
  const codeBackgrounds = text.match(/q 0\.94 0\.95 0\.97 rg [\d.]+ [\d.]+ [\d.]+ [\d.]+ re f Q/g) ?? [];

  assert.equal(codeBackgrounds.length, 4);
  assert.doesNotMatch(text, /<202020> Tj/);
});

test("renders markdown tables as bordered PDF tables", () => {
  const pdf = renderPDFFromBlocks(
    u8(`| Name | Score | Result |
|:-----|------:|:------:|
| **Ada** | \`42\` | yes |
| Bob | 7 | no |`),
    {
      pageSize: { width: 420, height: 320 },
      margin: 24,
      fontSize: 14,
    },
  );
  const text = decodePdf(pdf);
  const extracted = extractPdfText(pdf).replace(/\n/g, " ");

  assert.ok(extracted.includes("Name"));
  assert.ok(extracted.includes("Score"));
  assert.ok(extracted.includes("Ada"));
  assert.ok(extracted.includes("42"));
  assert.ok(extracted.includes("Bob"));
  assert.doesNotMatch(text, /<207C20> Tj/);
  assert.match(text, /q 0\.9 0\.93 0\.97 rg [\d.]+ [\d.]+ [\d.]+ [\d.]+ re f Q/);
  assert.match(text, /0\.72 0\.75 0\.8 RG 0\.6 w [\d.]+ [\d.]+ m [\d.]+ [\d.]+ l S Q/);
});

test("embeds JPEG images as DCT XObjects", async () => {
  let calls = 0;
  const pdf = await renderPDFFromBlocksAsync(u8("Before ![Photo](photo.jpg) after"), {
    imageResolver: (resolvedSrc, context) => {
      calls++;
      assert.equal(resolvedSrc, "photo.jpg");
      assert.equal(context.altText, "Photo");
      return {
        bytes: makeJpeg(),
        mediaType: "image/jpeg",
      };
    },
  });
  const text = decodePdf(pdf);

  assert.equal(calls, 1);
  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /\/Width 2 \/Height 1/);
  assert.match(text, /\/ColorSpace \/DeviceRGB/);
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.match(text, /\/XObject << \/Im1 \d+ 0 R >>/);
  assert.match(text, /\/Im1 Do/);
});

test("embeds PNG IDAT data with FlateDecode predictor", async () => {
  const pdf = await renderPDFFromBlocksAsync(u8("![Red pixel](/red.png)"), {
    imageResolver: async () => ({
      bytes: makeRgbPng(),
      mediaType: "image/png",
    }),
  });
  const text = decodePdf(pdf);

  assert.match(text, /\/Subtype \/Image/);
  assert.match(text, /\/Width 1 \/Height 1/);
  assert.match(text, /\/ColorSpace \/DeviceRGB/);
  assert.match(text, /\/Filter \/FlateDecode/);
  assert.match(text, /\/DecodeParms << \/Predictor 15 \/Colors 3 \/BitsPerComponent 8 \/Columns 1 >>/);
  assert.match(text, /\/Im1 Do/);
});

test("embeds RGBA PNG images with soft masks", async () => {
  const pdf = await renderPDFFromBlocksAsync(u8("![Alpha pixel](/alpha.png)"), {
    imageResolver: async () => ({
      bytes: makeRgbaPng(),
      mediaType: "image/png",
    }),
    inflate: (input) => new Uint8Array(inflateSync(input)),
    deflate: (input) => new Uint8Array(deflateSync(input)),
  });
  const text = decodePdf(pdf);
  const imageObjects = text.match(/\/Subtype \/Image/g) ?? [];

  assert.equal(imageObjects.length, 2);
  assert.match(text, /\/Width 1 \/Height 1/);
  assert.match(text, /\/ColorSpace \/DeviceRGB/);
  assert.match(text, /\/SMask \d+ 0 R/);
  assert.match(text, /\/ColorSpace \/DeviceGray/);
  assert.match(text, /\/Filter \/FlateDecode/);
  assert.match(text, /\/Im1 Do/);
});

test("embeds safe SVG images as Form XObjects", async () => {
  const svg = encoder.encode(
    '<svg width="20" height="10" viewBox="0 0 20 10"><rect x="1" y="2" width="8" height="4" fill="#ff0000"/><path d="M 10 1 L 18 1 L 18 8 Z" stroke="#0000ff" fill="none"/></svg>',
  );
  const pdf = await renderPDFFromBlocksAsync(u8("![Icon](/icon.svg)"), {
    imageResolver: async () => ({
      bytes: svg,
      mediaType: "image/svg+xml",
    }),
  });
  const text = decodePdf(pdf);

  assert.match(text, /\/Type \/XObject \/Subtype \/Form/);
  assert.match(text, /\/BBox \[0 0 20 10\]/);
  assert.match(text, /1 2 8 4 re/);
  assert.match(text, /10 1 m/);
  assert.match(text, /18 8 l/);
  assert.match(text, /\/XObject << \/Im1 \d+ 0 R >>/);
  assert.match(text, /\/Im1 Do/);
});

test("falls back to alt text for unsafe SVG images", async () => {
  const pdf = await renderPDFFromBlocksAsync(u8("![Unsafe](/unsafe.svg)"), {
    imageResolver: async () => ({
      bytes: encoder.encode('<svg width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>'),
      mediaType: "image/svg+xml",
    }),
  });
  const text = decodePdf(pdf);
  const extracted = extractPdfText(pdf);

  assert.doesNotMatch(text, /\/Subtype \/Form/);
  assert.ok(text.includes(`<${hexText("[image")}>`));
  assert.ok(extracted.includes("Unsafe"));
});

test("deduplicates repeated images by resolved URL", async () => {
  let calls = 0;
  const pdf = await renderPDFFromBlocksAsync(
    u8("![One](shared.jpg)\n\n![Two](shared.jpg)"),
    {
      imageResolver: () => {
        calls++;
        return { bytes: makeJpeg(), mediaType: "image/jpeg" };
      },
    },
  );
  const text = decodePdf(pdf);
  const imageObjects = text.match(/\/Subtype \/Image/g) ?? [];
  const draws = text.match(/\/Im1 Do/g) ?? [];

  assert.equal(calls, 1);
  assert.equal(imageObjects.length, 1);
  assert.equal(draws.length, 2);
});

test("falls back to image alt text when no resolver is available", () => {
  const pdf = renderPDFFromBlocks(u8("![Alt text](missing.png)"));
  const text = decodePdf(pdf);
  const extracted = extractPdfText(pdf);

  assert.ok(text.includes(`<${hexText("[image")}>`));
  assert.ok(extracted.includes("Alt text"));
  assert.doesNotMatch(text, /\/Subtype \/Image/);
});

test("paginates without building an intermediate document tree", () => {
  const markdown = Array.from(
    { length: 80 },
    (_, index) => `Paragraph ${index + 1} with enough words to wrap on a compact page.`,
  ).join("\n\n");
  const pdf = renderPDFFromBlocks(u8(markdown), {
    pageSize: { width: 240, height: 240 },
    margin: 24,
  });
  const text = decodePdf(pdf);
  const pageObjects = text.match(/\/Type \/Page\b/g) ?? [];

  assert.ok(pageObjects.length > 1);
  assert.match(text, new RegExp(`/Count ${pageObjects.length}\\b`));
});

test("MDParser renderToPDF lazy entrypoint returns PDF bytes", async () => {
  const parser = new MDParser({ baseUrl: "https://example.com/docs/" });
  let resolved = "";
  const pdf = await parser.renderToPDF(u8("Hello PDF ![Logo](logo.jpg)"), {
    imageResolver: (resolvedSrc) => {
      resolved = resolvedSrc;
      return { bytes: makeJpeg(), mediaType: "image/jpeg" };
    },
  });
  const text = decodePdf(pdf);
  const extracted = extractPdfText(pdf);

  assert.equal(resolved, "https://example.com/docs/logo.jpg");
  assert.ok(text.startsWith("%PDF-1.7\n"));
  assert.ok(extracted.includes("Hello PDF"));
  assert.match(text, /\/Subtype \/Image/);
});
