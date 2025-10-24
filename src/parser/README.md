# Parser

## Overview
- Core markdown engine that transforms UTF-8 bytes into HTML strings or canvas rendering commands.
- Emphasizes performance:
  - Single pass block generator (`blocks()`) over byte spans with no substring allocation.
  - Inline parser that yields tokens as `{ kind, s, e }` spans.
  - Renderers built around arena-style buffers (HTML) or immediate-mode drawing (Canvas) with measurement caches.

## Processing Pipeline
1. **Input** &mdash; `MDParser` accepts either a `Uint8Array` or string (converted via `u8()` helper).
2. **Line segmentation** (`line-parser.ts`) splits bytes into `{ start, end }` spans, handling all newline conventions.
3. **Block analysis** (`block-parser.ts`) walks line spans to emit events such as headings, lists, tables, info blocks, fenced code, footnotes. State machine tracks:
   - Blockquote depth, list stacks (type + indent), fenced code fences, table alignment row, info-block mode.
4. **Inline tokenization** (`inline-parser.ts`) is invoked on-demand per event span:
   - Handles emphasis (`*`, `_`), strong emphasis, strikethrough, inline/code fences, images, links (including autolinks), and footnote references.
5. **Rendering** either:
   - `html-renderer.ts` → `HtmlArena` (byte buffer) → `string`.
   - `canvas-renderer.ts` → 2D context operations (with fallback virtualization for massive docs).

## Key Modules
- `arena.ts`
  - `HtmlArena` is a growable `Uint8Array` buffer with byte-level write helpers and HTML escaping (`writeEscaped` replaces `&`, `<`, `>`, quotes).
  - Used by both HTML renderer and syntax highlighter to avoid constant string concatenation.
- `constants.ts`
  - Pre-encoded tag fragments and theming constants shared between renderers.
- `index.ts`
  - Public surface (`MDParser`) storing default options (raw HTML off, URL allowlist).
  - Exposes the full pipeline (`parse`, `renderToCanvas`, `u8`) and re-exports types for downstream tooling.
- `render-pipeline.ts`
  - Small visitor orchestrator: compose one or more `BlockVisitor`s and stream block events through them.
  - Supports async handlers (awaited automatically) as well as `runSync()` for renderers that must stay synchronous (canvas measurement pass).
  - Keeps renderer code declarative: each visitor focuses on event handling while the pipeline manages iteration and finalization.
- `utils.ts`
  - Byte helpers: whitespace skipping, fence detection, list parsing, info-block detection, autolink scanning, table parsing.
  - Ensures block parser remains declarative and focused on control flow.
- `types.ts`
  - Shared structural types: `BlockEvent`, `InlineToken`, render-time styles, etc.

## HTML Renderer
- `renderHTMLFromBlocks`
  - Iterates block events, opening/closing tags via `TAG` constants to guarantee consistent formatting.
  - Footnotes collected during block walk and appended as `<div class="footnotes">`.
  - Code fences buffered line-by-line and passed to `highlight/highlightCodeBlock()`. Awaited result is already sanitized.
  - Uses URL allowlist/base URL utilities to strip disallowed links or resolve relative resources.

## Canvas Renderer
- `renderToCanvasFromBlocks`
  - Two-pass approach: measure off-screen canvas to compute total height, then draw either directly or via virtualization if taller than the viewport.
  - Virtualization path renders onto an offscreen canvas and blits visible slices on scroll (sticky viewport canvas + spacer element).
  - Theme aware:
    - `getThemeColors()` + CSS custom properties keep colors synchronized with the active theme builder.
    - Code highlights colored via `GenericTokenizer` with theme token palette.
  - Rich inline support:
    - `drawInline()` wraps text, applies emphasis styles, draws inline code backgrounds, link underlines, footnote superscripts.
    - Image caching with lazy rerender to accommodate async loading; placeholders maintain layout during measure pass.
  - Block-level styling:
    - Tracks blockquote rectangles, code blocks, info blocks, table geometry, and paints backgrounds/borders after content to avoid clipping.
    - Ordered list marker width caching ensures alignment across nested lists.

## Options & Extensibility
- `ParserOptions`:
  - `allowRawHtml` (guarded, default false) &mdash; toggle custom HTML handling (currently disabled; raw HTML detection to be implemented).
  - `urlAllowlist` &mdash; predicate controlling link/image acceptance.
  - `baseUrl` &mdash; resolves relative URLs for renderers and share/export features.
- To add new block syntax:
  - Extend `utils.ts` with helpers if byte-level scanning is required.
  - Modify `blocks()` to emit new event types and update `BlockEvent` typing.
  - Implement rendering behavior in both `html-renderer.ts` and `canvas-renderer.ts`.
- For new inline markup:
  - Update `inline-parser.ts` to detect spans and emit a new `InlineToken` variant.
  - Teach `renderInline` and `drawInline` how to represent the token.

## Testing Hooks
- `tests/markdown.spec.ts` (Playwright/Vitest) exercises parser outputs against `assets/test.md`.
- Canvas renderer exposes DOM dataset flags (`data-render-ready`, `data-virtualized`) for e2e assertions.

## Improvement Notes
- Revisit raw HTML support: today `allowRawHtml` is a placeholder. Adding a sandboxed HTML pass (with configurable sanitizer) would unblock richer embeds in trusted environments.
- Split the monolithic `canvas-renderer.ts` (≈1700 LOC) into composable modules (layout, drawing, virtualization) to ease future maintenance and enable targeted unit tests.
- Cache `lineSpans` results across consecutive renders when the markdown source is unchanged; it would reduce work for live preview typing where only inline parsing should rerun.
- Introduce fuzz tests feeding random markdown into `blocks()` + renderers to harden against malformed inputs and ensure the generator never throws.
