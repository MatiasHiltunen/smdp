import assert from "node:assert/strict";
import test from "node:test";

import { MDParser, u8 } from "../src/parser/index.ts";

async function render(markdown: string): Promise<string> {
  return new MDParser().parse(u8(markdown));
}

test("tables close before a following heading instead of swallowing it", async () => {
  const html = await render(`| Name | Value |
| ---- | --: |
| one  | 1 |

## Visible after table

Paragraph after heading`);

  assert.match(
    html,
    /<\/tbody>\n<\/table>\n<h2>Visible after table<\/h2>\n<p>Paragraph after heading<\/p>/,
  );
  assert.doesNotMatch(html, /<tbody>[\s\S]*<h2>[\s\S]*<\/tbody>/);
});

test("tables close before a following info block", async () => {
  const html = await render(`| Name |
| --: |
| one |
::: info
Visible notice
:::`);

  assert.match(
    html,
    /<\/tbody>\n<\/table>\n<div class="info-block info"><p>Visible notice<\/p>\n<\/div>/,
  );
  assert.doesNotMatch(html, /<tbody>[\s\S]*info-block[\s\S]*<\/tbody>/);
});

test("table alignment directives apply to headers and data without outer pipes", async () => {
  const html = await render(`Left | Center | Right
:-- | :--: | --:
a | b | c
d | e | f

After`);

  assert.equal(
    html.trim(),
    `<table>
<thead>
<tr><th style="text-align:left">Left</th><th style="text-align:center">Center</th><th style="text-align:right">Right</th></tr>
</thead>
<tbody>
<tr><td style="text-align:left">a</td><td style="text-align:center">b</td><td style="text-align:right">c</td></tr>
<tr><td style="text-align:left">d</td><td style="text-align:center">e</td><td style="text-align:right">f</td></tr>
</tbody>
</table>
<p>After</p>`,
  );
});

test("a delimiter row must match the header column count", async () => {
  const html = await render(`| First | Second |
| --: |
| one | two |`);

  assert.doesNotMatch(html, /<table>/);
  assert.match(html, /First \| Second/);
  assert.match(html, /one \| two/);
});
