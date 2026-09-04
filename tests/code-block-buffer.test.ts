import assert from "node:assert/strict";
import test from "node:test";

import { blocks } from "../src/parser/block-parser.ts";
import { bufferCodeBlock } from "../src/parser/code-block-buffer.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("buffers fenced source spans as one logical code block", () => {
  const markdown = encoder.encode(`> \`\`\`eon
> message: """
> multiline value
> """
> \`\`\``);
  const spans: Array<{ s: number; e: number }> = [];
  for (const event of blocks(markdown)) {
    if (event.type === "codeText") spans.push({ s: event.s, e: event.e });
  }

  const block = bufferCodeBlock(markdown, spans);
  assert.equal(decoder.decode(block.bytes), `message: """\nmultiline value\n"""\n`);
  assert.deepEqual(
    block.lines.map((line) => decoder.decode(block.bytes.subarray(line.s, line.e))),
    [`message: """`, "multiline value", `"""`],
  );
});

test("retains blank rows without inventing a trailing display row", () => {
  const source = encoder.encode("first\n\nthird");
  const block = bufferCodeBlock(source, [
    { s: 0, e: 5 },
    { s: 6, e: 6 },
    { s: 7, e: 12 },
  ]);

  assert.equal(decoder.decode(block.bytes), "first\n\nthird\n");
  assert.equal(block.lines.length, 3);
  assert.equal(block.lines[1].s, block.lines[1].e);
});
