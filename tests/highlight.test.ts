import assert from 'node:assert/strict';
import test from 'node:test';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function loadHighlightModule() {
  return import('../src/highlight/index.ts');
}

async function highlightToHtml(source: string, lang?: string) {
  const mod = await loadHighlightModule();
  const bytes = encoder.encode(source);
  const result = await mod.highlightCodeBlock(bytes, lang);
  return decoder.decode(result);
}

async function renderMarkdownToHtml(markdown: string) {
  const { MDParser, u8 } = await import('../src/parser/index.ts');
  const parser = new MDParser();
  return await parser.parse(u8(markdown), {});
}

test('falls back to basic highlighting for unknown languages', async () => {
  const html = await highlightToHtml('a < b', 'unknown');
  assert.equal(html, '<pre class="code-block"><code class="language-unknown">a &lt; b</code></pre>\n');
  assert.equal(html.includes('tok-'), false);
});

test('highlights JavaScript aliases with token markup', async () => {
  const html = await highlightToHtml('const answer = 42;\n// comment', 'js');
  assert.ok(html.includes('<code class="language-js">'));
  assert.ok(html.includes('<span class="tok-kw">const</span>'));
  assert.ok(html.includes('<span class="tok-num">42</span>'));
  assert.ok(html.includes('<span class="tok-com">// comment</span>'));
});

test('tokenizes JavaScript regexes and template literals', async () => {
  const source = 'const re = /foo+/g;\nconst msg = `value: ${42}`;';
  const html = await highlightToHtml(source, 'javascript');

  assert.ok(html.includes('<span class="tok-rx">/foo+/g</span>'));
  assert.ok(html.includes('<span class="tok-tpl">`value: ${'));
  assert.match(html, /`value: \$\{[\s\S]*?}`<\/span>/);
});

test('highlights Python code through built-in registration', async () => {
  const html = await highlightToHtml('def add(a, b):\n    return True', 'py');
  assert.ok(html.includes('<code class="language-py">'));
  assert.ok(html.includes('<span class="tok-kw">def</span>'));
  assert.ok(html.includes('<span class="tok-kw">return</span>'));
  assert.ok(html.includes('<span class="tok-kw">True</span>'));
});

test('highlights Python numbers and comments', async () => {
  const source = 'value = 123_456\n# trailing comment';
  const html = await highlightToHtml(source, 'python');

  assert.ok(html.includes('<span class="tok-num">123_456</span>'));
  assert.ok(html.includes('<span class="tok-com"># trailing comment</span>'));
});

test('highlights Rust keywords and numbers', async () => {
  const source = 'fn main() { let value: u32 = 0xff; }';
  const html = await highlightToHtml(source, 'rust');

  assert.ok(html.includes('<code class="language-rust">'));
  assert.ok(html.includes('<span class="tok-kw">fn</span>'));
  assert.ok(html.includes('<span class="tok-num">0xff</span>'));
});

test('highlights Java code with access modifiers and numbers', async () => {
  const source = 'public class Example { private int answer = 42; }';
  const html = await highlightToHtml(source, 'java');

  assert.ok(html.includes('<code class="language-java">'));
  assert.ok(html.includes('<span class="tok-kw">class</span>'));
  assert.ok(html.includes('<span class="tok-kw">private</span>'));
  assert.ok(html.includes('<span class="tok-num">42</span>'));
});

test('highlights shell scripts with comments and strings', async () => {
  const source = 'if [ "$VALUE" -gt 0 ]; then\n  echo "ok"\nfi # end';
  const html = await highlightToHtml(source, 'bash');

  assert.ok(html.includes('<code class="language-bash">'));
  assert.ok(html.includes('<span class="tok-kw">if</span>'));
  assert.ok(html.includes('<span class="tok-str">&quot;ok&quot;</span>'));
  assert.ok(html.includes('<span class="tok-com"># end</span>'));
});

test('highlights Swift code with keywords and strings', async () => {
  const source = 'struct Greeter { let greeting = "hi"\n  func speak() { print(greeting) } }';
  const html = await highlightToHtml(source, 'swift');

  assert.ok(html.includes('<code class="language-swift">'));
  assert.ok(html.includes('<span class="tok-kw">struct</span>'));
  assert.ok(html.includes('<span class="tok-kw">func</span>'));
  assert.ok(html.includes('<span class="tok-str">&quot;hi&quot;</span>'));
});

test('highlights SQL queries with uppercase keywords', async () => {
  const source = "SELECT id, name FROM users WHERE active = 1 AND name LIKE 'A%';";
  const html = await highlightToHtml(source, 'sql');

  assert.ok(html.includes('<code class="language-sql">'));
  assert.ok(html.includes('<span class="tok-kw">SELECT</span>'));
  assert.ok(html.includes('<span class="tok-kw">WHERE</span>'));
  assert.ok(html.includes('<span class="tok-str">&#39;A%&#39;;</span>'));
});

test('allows registering additional languages dynamically', async () => {
  const mod = await loadHighlightModule();
  mod.registerHighlightLanguage({
    spec: {
      name: 'ini-config',
      aliases: ['ini'],
      keywords: [{ word: 'true' }],
      lineComments: [';'],
    },
  });

  const html = await highlightToHtml('true ; comment', 'ini');
  assert.ok(html.includes('<code class="language-ini">'));
  assert.ok(html.includes('<span class="tok-kw">true</span>'));
  assert.ok(html.includes('<span class="tok-com">; comment</span>'));
});

test('markdown renderer applies highlighting to fenced code blocks', async () => {
  const html = await renderMarkdownToHtml('```rust\nfn main() {}\n```\n');

  assert.ok(html.includes('<code class="language-rust">'));
  assert.ok(html.includes('<span class="tok-kw">fn</span>'));
});

test('exposes a sorted list of registered highlight aliases', async () => {
  const mod = await loadHighlightModule();
  const aliases = mod.getRegisteredHighlightLanguages();

  assert.ok(Array.isArray(aliases));
  assert.ok(aliases.includes('js'));
  assert.ok(aliases.includes('swift'));
  assert.ok(aliases.includes('sql'));
  const sorted = [...aliases].sort();
  assert.deepEqual(aliases, sorted);
});
