import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

async function renderMarkdownToHtml(markdown: string): Promise<string> {
  const { MDParser, u8 } = await import("../src/parser/index.ts");
  const parser = new MDParser();
  return await parser.parse(u8(markdown), {});
}

test("golden: basic markdown elements", async () => {
  const markdown = `
# Heading 1

## Heading 2

**Bold text** and *italic text*.

- Unordered list item
- Another item

1. Ordered list item
2. Another item

\`inline code\`

\`\`\`javascript
function hello() {
  console.log('world');
}
\`\`\`

> Blockquote here

---

[Link text](https://example.com)

![Alt text](https://example.com/image.png)

~~Strikethrough text~~

- [ ] Task list item (unchecked)
- [x] Task list item (checked)

| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |

End of content`;

  const expected = `<h1>Heading 1</h1>
<h2>Heading 2</h2>
<p><strong>Bold text</strong> and <em>italic text</em>.</p>
<ul>
<li>Unordered list item
</li>
<li>Another item
</li>
</ul>
<ol>
<li>Ordered list item
</li>
<li>Another item
</li>
</ol>
<p><code>inline code</code></p>
<pre class="code-block"><code class="language-javascript"><span class="tok-kw">function</span> <span class="tok-id">hello</span><span class="tok-p">(</span><span class="tok-p">)</span> <span class="tok-p">{</span>
  <span class="tok-id">console</span><span class="tok-p">.</span><span class="tok-id">log</span><span class="tok-p">(</span><span class="tok-str">&#39;world&#39;</span><span class="tok-p">)</span><span class="tok-p">;</span>
<span class="tok-p">}</span>
</code></pre>
<blockquote>
<p>Blockquote here</p>
</blockquote>
<hr>
<p><a href="https://example.com">Link text</a></br></br>
<img alt="Alt text" src="https://example.com/image.png"></br></br>
<del>Strikethrough text</del></p>
<ul>
<li><input type="checkbox" disabled> Task list item (unchecked)
</li>
<li><input type="checkbox" disabled checked> Task list item (checked)
</li>
</ul>
<table>
<thead>
<tr><th style="text-align:left">Header 1</th><th style="text-align:left">Header 2</th></tr>
</thead>
<tbody>
<tr><td>Cell 1</td><td>Cell 2</td></tr>
<tr><td>Cell 3</td><td>Cell 4</td></tr>
</tbody>
</table>
<p>End of content</p>`;

  const actual = await renderMarkdownToHtml(markdown.trim());
  assert.equal(actual.trim(), expected.trim());
});

test("golden: complex inline formatting", async () => {
  const markdown =
    "Text with **bold** and *italic* and `code` and ~~strikethrough~~ and [link](url) text.";
  const expected =
    '<p>Text with <strong>bold</strong> and <em>italic</em> and <code>code</code> and <del>strikethrough</del> and <a href="url">link</a> text.</p>';
  const actual = await renderMarkdownToHtml(markdown);
  assert.equal(actual.trim(), expected.trim());
});

test("golden: nested lists with tasks", async () => {
  const markdown = `
- [x] Top level task
  - [ ] Nested item
  - [x] Completed nested item
- [ ] Another top level task
`;

  const expected = `<ul>
<li><input type="checkbox" disabled checked> Top level task
<ul>
<li><input type="checkbox" disabled> Nested item
</li>
<li><input type="checkbox" disabled checked> Completed nested item
</li>
</ul>
</li>
<li><input type="checkbox" disabled> Another top level task
</li>
</ul>`;

  const actual = await renderMarkdownToHtml(markdown.trim());
  assert.equal(actual.trim(), expected.trim());
});

test("golden: mixed nested lists", async () => {
  const markdown = `
1. Ordered root
   - Bullet child
     1. Deep ordered
   - Second bullet
2. Second root
`;

  const expected = `<ol>
<li>Ordered root
<ul>
<li>Bullet child
<ol>
<li>Deep ordered
</li>
</ol>
</li>
<li>Second bullet
</li>
</ul>
</li>
<li>Second root
</li>
</ol>`;

  const actual = await renderMarkdownToHtml(markdown.trim());
  assert.equal(actual.trim(), expected.trim());
});

test("golden: table alignment", async () => {
  const markdown = `
| Left | Center | Right |
|:-----|:------:|------:|
| a    | b      | c     |
| d    | e      | f     |

End of table`;

  const expected = `<table>
<thead>
<tr><th style="text-align:left">Left</th><th style="text-align:center">Center</th><th style="text-align:right">Right</th></tr>
</thead>
<tbody>
<tr><td>a</td><td>b</td><td>c</td></tr>
<tr><td>d</td><td>e</td><td>f</td></tr>
</tbody>
</table>
<p>End of table</p>`;

  const actual = await renderMarkdownToHtml(markdown.trim());
  assert.equal(actual.trim(), expected.trim());
});

test("golden: URL allowlist", async () => {
  const markdown = `
[Valid HTTP link](http://example.com)
[Valid HTTPS link](https://example.com)
[Valid mailto link](mailto:test@example.com)
[Invalid javascript link](javascript:alert('xss'))
[Relative link](relative/path)
[Protocol-relative link](//example.com/path)
`;

  const expected = `<p><a href="http://example.com">Valid HTTP link</a></br></br>
<a href="https://example.com">Valid HTTPS link</a></br></br>
<a href="mailto:test@example.com">Valid mailto link</a></br></br>
Invalid javascript link)</br></br>
<a href="relative/path">Relative link</a></br></br>
<a href="//example.com/path">Protocol-relative link</a></p>`;

  const actual = await renderMarkdownToHtml(markdown.trim());
  assert.equal(actual.trim(), expected.trim());
});
