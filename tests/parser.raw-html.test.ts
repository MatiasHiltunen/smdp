import assert from "node:assert/strict";
import test from "node:test";

import { MDParser, u8 } from "../src/parser/index.ts";

test("raw html is escaped by default", async () => {
  const parser = new MDParser();
  const markdown = "<strong>safe</strong> <script>alert(1)</script>";
  const html = await parser.parse(u8(markdown));

  assert.ok(html.includes("&lt;strong&gt;safe&lt;/strong&gt;"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
});

test("allowRawHtml keeps basic tags and strips style/script payloads", async () => {
  const parser = new MDParser();
  const markdown =
    '<strong style="color:red" onclick="x()">Hi</strong> <script>alert(1)</script> world';
  const html = await parser.parse(u8(markdown), { allowRawHtml: true });

  assert.ok(html.includes("<strong>Hi</strong>"));
  assert.ok(html.includes("world"));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("alert(1)"));
  assert.ok(!html.includes("style="));
  assert.ok(!html.includes("onclick="));
});

test("allowRawHtml sanitizes raw html attributes and links", async () => {
  const parser = new MDParser();
  const markdown =
    '<a href="../guide.md" target="_blank">Guide</a> <a href="javascript:alert(1)">Bad</a> <img src="./logo.png" style="width:999px" onerror="x" alt="Logo">';
  const html = await parser.parse(u8(markdown), {
    allowRawHtml: true,
    baseUrl: "https://example.com/docs/readme.md",
  });

  assert.ok(html.includes('href="https://example.com/guide.md"'));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('src="https://example.com/docs/logo.png"'));
  assert.ok(html.includes('alt="Logo"'));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("style="));
  assert.ok(!html.includes("onerror="));
});

test("markdown links reject obfuscated javascript schemes", async () => {
  const parser = new MDParser();
  const markdown = "[Click](java\tscript:alert%281%29)";
  const html = await parser.parse(u8(markdown), {
    baseUrl: "https://example.com/docs/readme.md",
  });

  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes("<a href="));
  assert.ok(html.includes("<p>Click</p>"));
});

test("raw html target blank links always enforce noopener noreferrer", async () => {
  const parser = new MDParser();
  const markdown =
    '<a href="https://example.com" target="_blank" rel="opener">External</a>';
  const html = await parser.parse(u8(markdown), { allowRawHtml: true });

  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(!html.includes('rel="opener"'));
});

test("allowRawHtml supports sanitized html table blocks", async () => {
  const parser = new MDParser();
  const markdown = `
<table>
<tr>
<th rowspan="2">Model</th>
<th colspan="2">I2_S</th>
</tr>
<tr>
<td><a href="https://example.com/model.md">Model A</a></td>
<td>&#9989;</td>
</tr>
</table>
`.trim();

  const html = await parser.parse(u8(markdown), { allowRawHtml: true });

  assert.ok(html.includes("<table>"));
  assert.ok(html.includes('<th rowspan="2">Model</th>'));
  assert.ok(html.includes('<th colspan="2">I2_S</th>'));
  assert.ok(html.includes('<a href="https://example.com/model.md">Model A</a>'));
  assert.ok(html.includes("<td>&#9989;</td>"));
  assert.ok(!html.includes("<em>"));
  assert.ok(!html.includes("&amp;#9989;"));
  assert.ok(html.includes("</table>"));
  assert.ok(!html.includes("<p><table>"));
  assert.ok(!html.includes("</br>"));
});
