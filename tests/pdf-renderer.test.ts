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

function runX(runs: ReadonlyArray<{ value: string; x: number }>, value: string): number {
  const run = runs.find((candidate) => candidate.value === value);
  assert.ok(run, `expected text run ${value}`);
  return run.x;
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

  assert.ok(text.startsWith("%PDF-1.7\n"));
  assert.match(text, /\/Type \/Catalog/);
  assert.match(text, /\/BaseFont \/Helvetica/);
  assert.match(text, /\/BaseFont \/Courier/);
  assert.ok(text.includes(`<${hexText("Heading")}>`));
  assert.ok(text.includes(`<${hexText("bold")}>`));
  assert.ok(text.includes(`<${hexText("[x]")}>`));
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

  assert.ok(runX(runs, "treat") - runX(runs, "We") > 23);
  assert.ok(runX(runs, "parser") - runX(runs, "Markdown") > 67);
  assert.ok(runX(runs, "Project") - runX(runs, "&") > 12);
  assert.ok(runX(runs, "(Today)") - runX(runs, "Well") > 29);
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

  assert.doesNotMatch(text, /\/Subtype \/Form/);
  assert.ok(text.includes(`<${hexText("[image")}>`));
  assert.ok(text.includes(`<${hexText("Unsafe")}>`));
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

  assert.ok(text.includes(`<${hexText("[image")}>`));
  assert.ok(text.includes(`<${hexText("Alt")}>`));
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

  assert.equal(resolved, "https://example.com/docs/logo.jpg");
  assert.ok(text.startsWith("%PDF-1.7\n"));
  assert.ok(text.includes(`<${hexText("Hello")}>`));
  assert.ok(text.includes(`<${hexText("PDF")}>`));
  assert.match(text, /\/Subtype \/Image/);
});
