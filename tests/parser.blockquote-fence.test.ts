import assert from "node:assert/strict";
import test from "node:test";

import { MDParser, u8 } from "../src/parser/index.ts";

test("blockquote fenced code blocks close correctly", async () => {
  const parser = new MDParser();
  const markdown = `
> ⚠️ **Warning** add recursion limit
>
> \`\`\`rust
> #![recursion_limit = "256"]
> \`\`\`
>
> The warning continues after the code block.
>
Outside warning.
`.trim();

  const html = await parser.parse(u8(markdown));

  assert.ok(html.includes("<blockquote>"));
  assert.ok(html.includes("recursion_limit"));
  assert.ok(html.includes("<p>The warning continues after the code block.</p>"));
  assert.ok(html.includes("</blockquote>\n<p>Outside warning.</p>"));
  assert.ok(!html.includes("&gt; ```"));
});
