# Highlight

## Overview
- Implements the zero-dependency syntax highlighting pipeline used by both HTML and canvas renderers.
- Provides a tiny authoring DSL for describing languages, compiles specs into byte-coded automata, and ships a precompiled language bundle for fast startup.

## Architecture
- `language-core.ts`
  - Defines `CompiledLanguageSpec`, `GenericTokenizer`, and `GenericHighlighter`.
  - Tokenizer operates on UTF-8 bytes, producing token spans without allocating substrings. Supports:
    - Unicode-aware identifier detection with bitset lookups.
    - Configurable number literal rules (hex/bin/oct, exponents, BigInts).
    - String delimiters with escape handling and optional multiline support.
    - JavaScript-style template literals and regex detection with context-aware heuristics (`canStartRegex` uses token history to disambiguate `/`).
  - Includes a lightweight `BinaryReader` used to deserialize specs from the precompiled blob.
  - `GenericHighlighter` renders tokens into HTML via `HtmlArena` spans, using pre-baked `<span class="tok-…">` fragments sourced from `precompiled.ts`.
- `precompiled.ts`
  - Auto-generated binary blobs (`LANGUAGE_BINARY`, `SPAN_BINARY`) embedded as base64 strings. Populated by `scripts/precompile-languages.ts`.
- `builtins.ts`
  - Author-mode specs for common languages (C, C++, Rust, Python, Go, etc.).
  - Exposes `htmlLanguageSpec` ensuring markup code blocks always highlight even if the binary bundle lags behind.
- `index.ts`
  - Lazy loads the precompiled bundle, registers each language alias, and exports `highlightCodeBlock()` plus registry helpers (`getRegisteredHighlightLanguages`, `registerHighlightLanguage`).
  - Fallback path `basicHighlight()` wraps plaintext in `<pre><code>` when no spec is found.
- `js-highlighter.ts`
  - Rich JavaScript/TypeScript spec with explicit keyword codes to tweak operator heuristics.
  - Provides a convenience `JSHighlighter` wrapper for consumers that only need JS support.

## Runtime Flow
1. `highlightCodeBlock(bytes, lang?)` ensures the binary bundle is registered (`ensurePrecompiledLoaded()`).
2. Resolves the language alias (case-insensitive, sanitized for CSS class compatibility).
3. If a compiled spec exists, `GenericHighlighter.highlight()` streams tokens to an `HtmlArena`.
4. Renderer receives a ready-to-inject `<pre class="code-block"><code …>` fragment.
5. When no spec matches, `basicHighlight()` produces escaped HTML with a best-effort `language-{slug}` class for consistent styling.

## Extending Language Support
- Author a new spec with the DSL in `builtins.ts` or dynamically call `registerHighlightLanguage({ spec, aliases })`.
- To ship the spec in the precompiled payload, update `scripts/precompile-languages.ts` and regenerate `precompiled.ts`.
- For on-the-fly registration (e.g., plugin languages), call `registerHighlightLanguage()` at startup; it will coexist with precompiled entries and reuse `GenericHighlighter`.

## Integration Tips
- HTML renderer (`parser/html-renderer.ts:93`) awaits `highlightCodeBlock()` so highlight generation is async-ready.
- Canvas renderer tokenizes directly (`canvas-renderer.ts:422`) via `GenericTokenizer` to color text with theme-derived palette.
- If you tweak token class names, keep `src/style.css` and `canvas-renderer.ts` spans in sync to avoid mismatched theming.

## Improvement Notes
- Move language registration to a worker-friendly module so the highlighting pipeline can execute off the main thread without re-downloading the binary blob.
- Add snapshot-based unit tests for `normalizeLanguage()` and alias resolution to ensure future normalization tweaks do not break class names consumed by CSS themes.
- Investigate incremental decoding of the binary bundle (e.g., streaming base64 → Uint8Array) to reduce the upfront cost for large language sets.
