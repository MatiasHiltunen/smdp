import assert from "node:assert/strict";
import test from "node:test";

import { MDParser, u8 } from "../src/parser";

test("HTML rendering emits opt-in source-line anchors without changing default output", async () => {
  const parser = new MDParser();
  const markdown = u8(
    "# Heading\n\nFirst\nsecond\n\n- Item\n\n```ts\nconst x = 1;\n\nreturn x;\n```\n",
  );

  const regular = await parser.parse(markdown);
  const mapped = await parser.parse(markdown, { sourceLineAttributes: true });

  assert.doesNotMatch(regular, /data-md-source-line/);
  assert.match(mapped, /data-md-source-line="1"/);
  assert.match(mapped, /data-md-source-line="3"/);
  assert.match(mapped, /data-md-source-line="4"/);
  assert.match(mapped, /data-md-source-line="6"/);
  assert.match(mapped, /data-md-source-line="9"/);
  assert.match(mapped, /data-md-source-line="10"/);
  assert.match(mapped, /data-md-source-line="11"/);
});
