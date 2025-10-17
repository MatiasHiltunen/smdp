# Yet Another Markdown Parser

A lightweight performance focused Markdown parser with zero dependencies.

## Features

1. Single-pass parsing with byte-level operations
2. No regular expressions for maximum performance
3. Render to HTML or HTML5 Canvas
4. Arena-style buffer with geometric growth
5. Efficient parsing without unnesessary allocations

## Supported Markdown Features

- **Headings** (H1-H6): `# Heading`
- **Blockquotes**: `> Quote`
- **Lists**: 
  - Unordered: `- Item` or `* Item` or `+ Item`
  - Ordered: `1. Item`
- **Horizontal Rules**: `---` or `***`
- **Code Blocks**: Fenced with ` ``` ` or `~~~`
- **Inline Code**: `` `code` ``
- **Emphasis**: `*italic*` or `_italic_`
- **Strong**: `**bold**` or `__bold__`
- **Links**: `[text](url)`
- **Images**: `![alt](src)`
- **Autolinks**: Automatic linking of `http://`, `https://`, and `www.` URLs

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

### HTML Rendering

```typescript
import { MDParser, u8 } from './parser';

const parser = new MDParser();
const markdown = '# Hello World\n\nThis is **bold** text.';
const html = parser.parse(u8(markdown));

console.log(html);
// Output: <h1>Hello World</h1>\n<p>This is <strong>bold</strong> text.</p>\n
```

### Canvas Rendering

```typescript
import { MDParser, u8 } from './parser';

const parser = new MDParser();
const canvas = document.createElement('canvas');
canvas.width = 800;

const markdown = '# Hello Canvas\n\nRendering Markdown to canvas!';
parser.renderToCanvas(u8(markdown), canvas);

document.body.appendChild(canvas);
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

#### `parse(u8arr: Uint8Array): string`

Parses Markdown (as Uint8Array) and returns an HTML string.

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

### Build

This is designed to work with Vite or similar modern bundlers.

```bash
npm install
npm run dev
```

## License

MIT

