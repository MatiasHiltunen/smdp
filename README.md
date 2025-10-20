# Yet Another Markdown Parser

A lightweight performance focused Markdown parser with zero dependencies.

## Features

1. Single-pass parsing with byte-level operations
2. No regular expressions for maximum performance
3. Render to HTML or HTML5 Canvas
4. Arena-style buffer with geometric growth
5. Efficient parsing without unnecessary allocations
6. Comprehensive test suite with golden tests, property tests, and benchmarks
7. GFM-compliant parsing with tables, task lists, and strikethrough
8. Security-hardened with URL allowlisting and HTML escaping
9. SSR-ready with clean ESM exports

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

Built-in syntax highlighters cover a range of common languages:

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
- INI / config files
- Dockerfile
- Make / Makefile
- F#

Additional languages can be registered at runtime with `registerHighlightLanguage`.

## Usage

### HTML Rendering (Browser & SSR)

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

### Canvas Rendering (Browser Only)

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

### Syntax Highlighting

```typescript
import { highlightCodeBlock } from 'smdp/highlight';

const code = 'function fibonacci(n) {\n  if (n <= 1) return n;\n  return fibonacci(n - 1) + fibonacci(n - 2);\n}';
const highlighted = highlightCodeBlock(new TextEncoder().encode(code), 'javascript');
console.log(new TextDecoder().decode(highlighted));
```

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

## API Reference

### `MDParser`

Main parser class.

#### `parse(u8arr: Uint8Array): Promise<string>`

Parses Markdown (as Uint8Array) and returns a Promise that resolves to an HTML string.

#### `renderToCanvas(u8arr: Uint8Array, canvas: HTMLCanvasElement): void`

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
- `renderHTMLFromBlocks(u8: Uint8Array)`: Render blocks to HTML
- `renderToCanvasFromBlocks(u8: Uint8Array, canvas: HTMLCanvasElement)`: Render blocks to canvas

## Development

### TypeScript Configuration

The project uses modern TypeScript with strict type checking enabled:

- ES2022 target
- ESNext modules
- Strict mode enabled
- Bundler module resolution
- Comprehensive linting rules

### Testing

Comprehensive test suite with multiple test types:

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

### Performance

The parser is optimized for performance:

- **Parsing**: ~100k ops/sec for small documents, ~1.5k ops/sec for large documents
- **Highlighting**: ~300k ops/sec for small code, ~4k ops/sec for large code
- **Memory**: ~5MB for 100 large document parses
- **Canvas**: Virtual scrolling for large documents with viewport-based rendering

## License

MIT

