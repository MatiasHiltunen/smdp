# Small Markdown Parser

Experimental 'batteries included' client-side markdown parser & renderer written in pure TypeScript. 

This same readme as a demo: [md2.at](https://md2.at/https://raw.githubusercontent.com/MatiasHiltunen/smdp/refs/heads/main/README.md?l_m_fontFamily=%22Helvetica+Neue%22%2C+Helvetica%2C+Arial%2C+sans-serif&l_m_fontSize=12px&l_m_fontWeight=400&l_m_lineHeight=1.5&l_m_monoFontFamily=%22SF+Mono%22%2C+%22Monaco%22%2C+%22Inconsolata%22%2C+monospace&l_t_bgBase=%238f0000&l_t_bgGlass=%23330000&l_t_bgGlassStrong=%233d0000&l_t_bgPanel=%23260303&l_t_borderGlass=%23850000&l_t_borderStrong=%23ff0000&l_t_textPrimary=%23ff4747&l_t_textSecondary=%23f5bcbc&l_t_accent=%23ff8080&l_t_accentStrong=%23c20000&l_t_shadowSoft=0+18px+48px+rgba%2815%2C+23%2C+42%2C+0.15%29&l_t_shadowButton=0+16px+30px+rgba%2837%2C+99%2C+235%2C+0.25%29&l_t_radiusLg=3px&l_t_radiusMd=3px&l_t_radiusSm=3px&l_t_codeKw=%23ff2e2e&l_t_codeId=%23ff9e9e&l_t_codeNum=%23ffd1d1&l_t_codeStr=%23ff932e&l_t_codeTpl=%23ff932e&l_t_codeCom=%23adadad&l_t_codeOp=%23ffffff&l_t_codePunc=%23ffffff&l_t_codeRx=%23ff7f4d&l_t_blockquoteBorder=%238a0000&l_t_blockquoteBg=%234d0000&l_t_blockquoteText=rgba%2830%2C+41%2C+59%2C+0.85%29&l_t_blockquoteAccent=rgba%2837%2C+99%2C+235%2C+0.55%29&l_t_infoBorder=rgba%2859%2C+130%2C+246%2C+0.5%29&l_t_infoBg=rgba%2859%2C+130%2C+246%2C+0.12%29&l_t_warningBorder=rgba%28234%2C+179%2C+8%2C+0.55%29&l_t_warningBg=rgba%28234%2C+179%2C+8%2C+0.12%29&l_t_errorBorder=rgba%28220%2C+38%2C+38%2C+0.55%29&l_t_errorBg=rgba%28220%2C+38%2C+38%2C+0.12%29&l_t_successBorder=rgba%2834%2C+197%2C+94%2C+0.55%29&l_t_successBg=rgba%2834%2C+197%2C+94%2C+0.12%29&l_c_bg-glow-a=rgba%2837%2C+99%2C+235%2C+0.18%29&l_c_bg-glow-b=rgba%2814%2C+165%2C+233%2C+0.14%29&d_m_fontFamily=%22Helvetica+Neue%22%2C+Helvetica%2C+Arial%2C+sans-serif&d_m_fontSize=14px&d_m_fontWeight=300&d_m_lineHeight=1.5&d_m_monoFontFamily=%22SF+Mono%22%2C+%22Monaco%22%2C+%22Inconsolata%22%2C+monospace&d_t_bgBase=%23000000&d_t_bgGlass=%23000000&d_t_bgGlassStrong=%23000000&d_t_bgPanel=%230f0101&d_t_borderGlass=%23000000&d_t_borderStrong=%23000000&d_t_textPrimary=%23ffffff&d_t_textSecondary=rgba%28226%2C+232%2C+240%2C+0.75%29&d_t_accent=%23a80000&d_t_accentStrong=%238a0000&d_t_shadowSoft=0+24px+80px+rgba%2815%2C+23%2C+42%2C+0.55%29&d_t_shadowButton=0+18px+40px+rgba%2814%2C+165%2C+233%2C+0.25%29&d_t_radiusLg=0px&d_t_radiusMd=0px&d_t_radiusSm=0px&d_t_codeKw=%23750808&d_t_codeId=%23e8a9a9&d_t_codeNum=%23facc15&d_t_codeStr=%23d18108&d_t_codeTpl=%23d18108&d_t_codeCom=rgba%28148%2C+163%2C+184%2C+0.65%29&d_t_codeOp=%23c96f88&d_t_codePunc=rgba%28226%2C+232%2C+240%2C+0.7%29&d_t_codeRx=%23f97316&d_t_blockquoteBorder=rgba%2894%2C+234%2C+212%2C+0.3%29&d_t_blockquoteBg=rgba%2845%2C+212%2C+191%2C+0.06%29&d_t_blockquoteText=rgba%28226%2C+232%2C+240%2C+0.85%29&d_t_blockquoteAccent=rgba%2894%2C+234%2C+212%2C+0.4%29&d_t_infoBorder=rgba%2859%2C+130%2C+246%2C+0.45%29&d_t_infoBg=rgba%2859%2C+130%2C+246%2C+0.16%29&d_t_warningBorder=rgba%28245%2C+158%2C+11%2C+0.45%29&d_t_warningBg=rgba%28245%2C+158%2C+11%2C+0.16%29&d_t_errorBorder=rgba%28239%2C+68%2C+68%2C+0.5%29&d_t_errorBg=rgba%28239%2C+68%2C+68%2C+0.16%29&d_t_successBorder=rgba%2816%2C+185%2C+129%2C+0.45%29&d_t_successBg=rgba%2816%2C+185%2C+129%2C+0.16%29&d_c_bg-glow-a=rgba%2856%2C+189%2C+248%2C+0.12%29&d_c_bg-glow-b=rgba%2894%2C+234%2C+212%2C+0.12%29)


## Background

_There are already many excellent, battle-tested markdown parsing / rendering libraries and utilities available in js/ts ecosystem. However, none of those were fully suitable for me in my daily work in another contexts where ease of use, lightness and privacy are essential requirements._

So, I decided to create a tool that would allow me to visualize any markdown in an accessible way with as little effort as possible. This also worked as a nice reminder and bit of a learning experience in working with modern js/ts lower level capabilities, and I think this can work also as an example of how JIT-compiled javaScript can take an advantage of contiguous memory layout for storing state. Although not optimized yet, it can already make a quite a difference in performance and memory usage. 

I have tried this with quite large .md files (+100Mb), that contained pretty much only code. As the basic syntax-highlighting is built-in and those blocks are fairly heavy to render, they performed surprisingly well, even _on my phone_.

As an example to use the parser/renderer I created small service [md2.at](https://md2.at) which is just a client-side typescript on free static hosting (render.com). This small "service" allows me to append any publicly available .md -file into the service's url and I get shareable/embeddable visualization for that markdown. 

This example service is still in very early stages but it is going to stay 

Aimed for making markdown visualizations more accessible while maintaining efficiency and privacy.

- Zero external dependencies in build 

The implementation keeps external dependencies out of the hot path and focuses on predictable, byte-level processing. Both HTML and Canvas renderers are included so the same parse result can be examined in different output backends. 

The project is still in an early phase, the public API and packaging will evolve before the planned publication later this year. 

The intent of this repository is not to compete with broad Markdown frameworks but to provide accessible visualisation while keeping the ratio between performance and supported features reasonable.

## Capabilities

1. Single-pass parsing implemented with byte spans rather than string slicing.
2. No regular expressions in the core parser; all matching is done with explicit scans.
3. Two renderers: an HTML renderer that emits escaped markup and a Canvas renderer for visual inspection.
4. Arena-style byte buffer to reduce allocations while building output.
5. Test coverage that includes golden tests, property-based fuzzing, and targeted benchmarks.
6. GitHub Flavored Markdown coverage for tables, task items, and strikethrough.
7. URL allowlisting and HTML escaping enabled by default.
8. ESM exports suitable for browser bundlers and server-side usage.
9. Optional dark/light UI presets with persisted preference and theme builder integration.

## Supported Markdown Features

- **Headings** (H1-H6): `# Heading`
- **Blockquotes**: `> Quote`
- **Lists**:
  - Unordered: `- Item` or `* Item` or `+ Item`
  - Ordered: `1. Item`
  - **Task Lists**: `- [ ] Unchecked` or `- [x] Checked`
- **Horizontal Rules**: `---` or `***`
- **Code Blocks**: Fenced with ```` ``` ```` or `~~~`
- **Inline Code**: `` `code` ``
- **Emphasis**: `*italic*` or `_italic_`
- **Strong**: `**bold**` or `__bold__`
- **Strikethrough**: `~~struck~~`
- **Links**: `[text](url)`
- **Images**: `![alt](src)`
- **Autolinks**: Automatic linking of `http://`, `https://`, and `www.` URLs
- **Tables**: `| Header | Header |\n|--------|--------|\n| Cell | Cell |`
- **Info Blocks**: `::: info`, `::: warning`, `::: error`, `::: success`

## Syntax Highlighting

Syntax Highlighting language specs are not complete and probably contain still many issues, few that I'm already aware of and working towards to fix those.

_To keep things lightweight, this is probably going to be an optional plugin based feature in the future to get correct grammars for different languages._

So far built-in basic syntax highlighters cover the following languages: 

- JavaScript / TypeScript
- Python
- Java
- C / C++
- C#
- Go
- Rust
- Swift
- Kotlin
- Scala
- Dart
- Ruby
- PHP
- Shell scripts (bash/sh/zsh)
- PowerShell
- Lua
- Perl
- Haskell
- Elixir
- Erlang
- Clojure
- R
- SQL
- JSON
- YAML
- TOML
- Eon
- INI / config files
- Dockerfile
- Make / Makefile
- F#
- HTML / XML / SVG

Additional languages can be registered at runtime with `registerHighlightLanguage`.

I have experimental setup of using precompiled language specs in runtime to reduce overhead of compiling those but this is not optimal way to do things and might look bad as the code containes block of base64 encoded binary representation that is consumed by highlihting. [This code is used to generate the precompiled.ts file.](/scripts/precompile-languages.ts)

## Usage

### HTML Rendering 

Should work with both, browser and SSR.

```typescript
import { MDParser, u8 } from 'smdp';

const parser = new MDParser({
  // Security: disable raw HTML blocks by default
  allowRawHtml: false,
  // Custom URL allowlist (optional)
  urlAllowlist: (url) => url.startsWith('https://') || url.startsWith('mailto:'),
});

const markdown = '# Hello World\n\nThis is **bold** text with ~~strikethrough~~ and `code`.';
parser.parse(u8(markdown)).then(html => {
  console.log(html);
  // Output: <h1>Hello World</h1>\n<p>This is <strong>bold</strong> text with <del>strikethrough</del> and <code>code</code>.</p>\n
});
```

### Canvas Rendering 

Works only in browser, still work in progress

```typescript
import { MDParser, u8 } from 'smdp';

const parser = new MDParser();
const canvas = document.createElement('canvas');
canvas.width = 800;

const markdown = `# Hello Canvas

This is **bold** text with ~~strikethrough~~.

- [ ] Task list item
- [x] Completed task

| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |

\`\`\`javascript
function hello() {
  console.log('world');
}
\`\`\``;

parser.renderToCanvas(u8(markdown), canvas);
document.body.appendChild(canvas);
```

### SSR Usage (Node.js)

```typescript
// In Node.js or SSR environments, only HTML parsing is available
import { MDParser, u8 } from 'smdp';

const parser = new MDParser();
const markdown = '# Server-Side Rendering\n\nWorks without DOM APIs.';
parser.parse(u8(markdown)).then(html => {
  console.log(html);
});

// Canvas rendering is not available in SSR environments
// parser.renderToCanvas(u8(markdown), canvas); // ❌ Not available
```

### Book Mode (Multi-Part Markdown)

Use `/book/<entry-url>` to treat a markdown document as a book entry that links to other chapters.

- `github.com/.../blob/...` chapter links are automatically converted to `raw.githubusercontent.com/...` for fetching.
- Relative chapter links (for example `./chapter-2.md`) are resolved against each chapter file URL.
- Linked markdown chapters are discovered and prefetched in the background.

Example:

```text
https://md2.at/book/https://github.com/owner/repo/blob/main/docs/README.md
```

When a chapter link is opened, the selected part is stored in `?part=<chapter-url>` so deep links remain shareable.

### Syntax Highlighting

```typescript
import { highlightCodeBlock } from 'smdp/highlight';

const code = 'function fibonacci(n) {\n  if (n <= 1) return n;\n  return fibonacci(n - 1) + fibonacci(n - 2);\n}';
const highlighted = highlightCodeBlock(new TextEncoder().encode(code), 'javascript');
console.log(new TextDecoder().decode(highlighted));
```

### Theme Builder

```typescript
import { createThemeBuilder } from 'smdp/theme';

const builder = createThemeBuilder()
  .withMeta({ colorScheme: 'light', fontFamily: '"IBM Plex Sans", system-ui, sans-serif' })
  .withTokens({
    bgBase: '#f5f6fa',
    textPrimary: '#1f2933',
    accent: '#2563eb',
    codeKw: '#7c3aed',
  });

// Option 1: apply directly to the current document
builder.apply(); // defaults to document.documentElement

// Option 2: inject scoped CSS (useful for SSR or style encapsulation)
const themeCss = builder.buildCss(':root');
```

The demo includes a palette button that opens a theme editor. The editor uses the same `ThemeBuilder` helper exposed through the public API and updates CSS variables in place.

## Principles

- Privacy: there is no telemetry or analytics built in the code. Requests occur only when loading external Markdown that the user specifies to be loaded from trusted source.
- Licensing: the entire codebase is released under the MIT License.
- AI usage: we highly value carefully hand-crafted code while recognising that LLMs, applied with intent and review, can accelerate exploration without diluting quality.

## Architecture

The parser is split into logical modules:

- **`types.ts`**: TypeScript type definitions and interfaces
- **`constants.ts`**: Pre-encoded HTML tags and styling constants
- **`utils.ts`**: Byte-level utility functions for parsing
- **`arena.ts`**: Memory-efficient HTML buffer with geometric growth
- **`line-parser.ts`**: Line span generator for input splitting
- **`inline-parser.ts`**: Inline token generator (emphasis, code, links, etc.)
- **`block-parser.ts`**: Block-level structure parser (headings, lists, code blocks, etc.)
- **`html-renderer.ts`**: HTML output renderer
- **`canvas-renderer.ts`**: Canvas output renderer
- **`index.ts`**: Main MDParser class and public API

### Parser Pipeline

The core pipeline is built around byte ranges rather than strings. The process is:

1. **Line segmentation**: `lineSpans` walks the Uint8Array, recording start/end offsets for each line. No copies are made, and the raw array is never converted to strings at this stage.
2. **Block parsing**: `blocks` iterates through the line spans once, emitting events such as `heading`, `listOpen`, `listItem`, `codeOpen`, etc. Indentation, fences, and info blocks are resolved here. Since block parsing is single-pass, nested structures (lists-in-lists, blockquotes) are tracked via a small stack structure.
3. **Inline parsing**: For ranges that require inline formatting (links, emphasis, code spans), `inlineTokens` performs another byte-level pass within the line boundaries. It produces typed tokens (`text`, `link`, `img`, `code`, `autolink`, `strike`, ...). Multiple passes are avoided by piggybacking on the already segmented line spans.
4. **Rendering**: Both renderers consume the block/inlines event stream without reparsing. The HTML renderer writes directly into an arena-like buffer (see `arena.ts`), which grows geometrically to limit reallocations. The Canvas renderer replays the same stream into 2D drawing commands, relying on the same inline tokenization for highlighting and styling.

Important details:

- **Writer**: The HTML renderer calls `HtmlArena.writeEscaped` and related methods that operate on byte slices, so writing out HTML stays allocation-friendly and avoids intermediate strings. Only at the end is `Uint8Array` converted back to a string (`TextDecoder`).
- **Syntax highlighting**: The highlighting path is decoupled from the markdown parser. When a fenced code block is found, the captured byte ranges are passed to `highlightCodeBlock`. Highlighting uses a generative tokenizer compiled from language specs (or precompiled data), then writes markup via the same arena-like approach.
- **Canvas rendering**: `renderToCanvasFromBlocks` shares the block event stream but renders into a canvas context. It keeps cached font measurements, performs line-wrapping per block, and triggers a rerender when images finish loading. Virtual scrolling is used when the rendered height exceeds twice the viewport.

```ts
// High-level structure: see src/parser/index.ts
export class MDParser {
  async parse(u8arr: Uint8Array) {
    return renderHTMLFromBlocks(u8arr, this.options);
  }

  renderToCanvas(u8arr: Uint8Array, canvas: HTMLCanvasElement) {
    renderToCanvasFromBlocks(u8arr, canvas, this.options);
  }
}

// renderHTMLFromBlocks (simplified) in src/parser/html-renderer.ts
for (const ev of blocks(u8)) {
  switch (ev.type) {
    case 'heading':
      arena.writeBytes(TAG.hPre[ev.level - 1]);
      renderInline(u8, ev.s, ev.e, arena, options);
      arena.writeBytes(TAG.hClose[ev.level - 1]);
      break;
    case 'codeOpen':
      codeBuffer = [];
      break;
    case 'codeText':
      codeBuffer.push({ s: ev.s, e: ev.e });
      break;
    case 'codeClose':
      const highlighted = await highlightCodeBlock(join(codeBuffer), codeLang);
      arena.writeBytes(highlighted);
      codeBuffer = null;
      break;
    // ...other block types (lists, blockquotes, tables, info blocks)
  }
}

// inlineTokens (see src/parser/inline-parser.ts) walks a byte slice and emits tokens
if (c === 0x5b /* '[' */) {
  const close = findBracket(u8, i + 1, e, 0x5d);
  if (close !== -1) {
    const hrefStart = close + 2; // '(' after ']'
    const hrefEnd = findBracket(u8, hrefStart, e, 0x29);
    tokens.push({ kind: 'link', textS: i + 1, textE: close, hrefS: hrefStart, hrefE: hrefEnd });
  }
}

// Canvas renderer consumes the same events (src/parser/canvas-renderer.ts)
for (const ev of blocks(u8)) {
  switch (ev.type) {
    case 'paraLine':
      renderInlineToCanvas(ev.s, ev.e, ctx, currentX, currentY);
      break;
    case 'img':
      const src = resolveUrlRelativeToBase(...);
      const cached = loadImage(src, rerender);
      drawImageOrPlaceholder(cached, ctx, currentX, currentY);
      break;
    // ...other block rendering
  }
}
```

### Current Strengths

- **Predictable performance**: Byte-range processing and arena-like buffers keep allocations low, which shows up in the included micro-benchmarks (`npm run test:bench`).
- **Single-pass correctness**: Blocks are identified without backtracking, inline parsing respects boundaries established by the block layer (for example, emphasis is never resolved inside code spans).
- **Separation of concerns**: HTML and Canvas renderers consume the same block/inline events so new renderers (e.g., PDF or terminal) can be added without touching the parser core.
- **Themeable UI**: The public theme builder feeds both the default UI and consumer customizations; the new light/dark presets are simply predefined token sets.

### Areas for Improvement

- **Streaming input**: Although the parser is single-pass, it still expects the full Uint8Array. Enabling incremental parsing (e.g., processing chunks from a stream) would reduce memory spikes for very large documents.
- **Error recovery**: Inline parsing errs on the side of stopping at malformed constructs. Better error recovery could keep rendering intact even when Markdown is intentionally or accidentally broken.
- **Extensibility hooks**: Callbacks for custom block/inline tokens could be surfaced. Today, extensions require forking the parser.
- **Canvas accessibility**: The Canvas renderer focuses on presentation. To serve assistive technologies, a hybrid mode that emits both Canvas and hidden HTML (or ARIA descriptions) would close the accessibility gap.
- **More grammars**: The highlighting pipeline accepts additional grammars, but coverage remains limited to the precompiled set. Expanding that library or providing an easier authoring path is on the roadmap.

## API Reference

### `MDParser`

Main parser class.

#### `parse(u8arr: Uint8Array, overrides?: ParserOptions): Promise<string>`

Parses Markdown (as Uint8Array) and returns a Promise that resolves to an HTML string. Pass `overrides.baseUrl` to rewrite relative links and image sources against the fetched document's origin.

#### `renderToCanvas(u8arr: Uint8Array, canvas: HTMLCanvasElement, overrides?: ParserOptions): void`

Renders Markdown (as Uint8Array) to an HTML5 Canvas.

### `u8(str: string): Uint8Array`

Utility function to convert a string to Uint8Array using UTF-8 encoding.

### Exported Types

- `InlineToken`: Token types for inline parsing
- `BlockEvent`: Event types for block parsing
- `LineSpan`: Line position information
- `TextStyle`: Styling information for canvas rendering
- `DrawResult`: Canvas drawing result coordinates

### Low-Level API

You can also use the individual parsers and renderers:

- `lineSpans(u8: Uint8Array)`: Generator yielding line spans
- `inlineTokens(u8: Uint8Array, s: number, e: number)`: Generator yielding inline tokens
- `blocks(u8: Uint8Array)`: Generator yielding block events
- `renderHTMLFromBlocks(u8: Uint8Array, options?: ParserOptions)`: Render blocks to HTML
- `renderToCanvasFromBlocks(u8: Uint8Array, canvas: HTMLCanvasElement, options?: ParserOptions)`: Render blocks to canvas

## Development

### TypeScript Configuration

The project uses modern TypeScript with strict type checking enabled:

- ES2022 target
- ESNext modules
- Strict mode enabled
- Bundler module resolution
- Comprehensive linting rules

### Testing

Test suites include golden comparisons, property-based checks, and micro-benchmarks:

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:golden     # Golden tests for parser output
npm run test:property   # Property-based tests for parser invariants
npm run test:bench      # Performance benchmarks

# Watch mode for development
npm run test:watch
```

### Build

This is designed to work with Vite or similar modern bundlers.

```bash
npm install
npm run dev
npm run build
```

## License

MIT
