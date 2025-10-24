# Client

## Overview
- Browser-facing utilities that bootstrap the app shell, manage routing, orchestrate views, and provide user interactions (theme editor, export/share flows).
- Modules are framework-agnostic DOM helpers written in TypeScript; everything relies on `document` APIs so the bundle stays light.

## Module Guide
- `dom.ts` &mdash; single helper `createElement` that preserves HTMLElement typing, keeping downstream code terse.
- `fetch.ts` &mdash; wraps `fetch()` to return `{ bytes, baseUrl }` so both HTML and canvas renderers receive raw markdown plus a base URL for resolving relative links.
- `routing.ts` &mdash; builder-based router that compiles declarative route rules into a reusable resolver returning `{ mode, externalUrl, shared, dataPayload }`. Supports:
  - `/shared/*` & `/data/*` read-only embeds with editor/menus disabled.
  - `/data79/*` binary Base79 payloads (read-only) that bundle AST/theme data.
  - `/edit/data79/*` mirrors the binary payload route but keeps the editor/FAB enabled for collaborative tweaking.
  - `/edit/data/*` legacy editor route for historic Base64 links.
  - `/canvas/*` and `/html/*` forcing the renderer selection.
  - Plain `/` or relative paths that treat the path as an external markdown URL.
- `theme.ts` &mdash; lazily instantiates a `ThemeBuilder`, exposes `applyTheme()` to sync CSS custom properties, and persists the dark/light switch to `localStorage`.
- `ui.ts` &mdash; builds the floating action button (FAB) menu:
  - Toggles the markdown editor pane.
  - Opens/closes the theme editor overlay.
  - Switches between light/dark, reapplying URL-provided overrides (via `theme/theme-editor.ts#L142`).
  - Exports rendered HTML (inlines styles, theme overrides, and current viewer markup).
  - Generates shareable `/data79/` links using Base79-compressed structured payloads (`data-link.ts`), copying them to clipboard with fallbacks and theme preservation.
  - Shows inline error banners (`displayError`).
- `views.ts` &mdash; creates the two UI shells:
  - HTML mode: DOM article for rendered markdown plus textarea for editing.
  - Canvas mode: scrollable container with a `<canvas>` synchronized to markdown source.

## Startup Flow (`main.ts`)
1. Instantiate `MDParser` with `allowRawHtml: false`.
2. Resolve the initial theme, apply persisted or URL-provided overrides, and optionally mount the theme editor.
3. Parse the route to choose the renderer (`createHtmlView` or `createCanvasView`) and to determine how markdown should be loaded:
   - `route.dataPayload` → decode with `data-link.ts`.
   - `route.externalUrl` → remote fetch; fallback to bundled `/test.md`.
4. Render the markdown initially (`parser.parse` → HTML innerHTML or `parser.renderToCanvas`).
5. For non-shared routes, wire live preview updates (`textarea` input → `u8()` → renderer), show the FAB menu, and focus the editor when toggled.

## Error Handling & User Feedback
- Network/compression errors bubble to `displayError` which mounts a dismissible banner at the document body root.
- Share/export buttons disable themselves while asynchronous work is pending, leveraging `aria-busy` for accessibility.
- Theme toggle gracefully tolerates storage failures (private browsing) thanks to guarded `try/catch` calls.

## Integration Points
- Relies on `parser/index.ts` for Markdown processing, `theme/*` for styling, and `highlight/*` indirectly through the parser renderers.
- When adding new UI actions, prefer reusing `createElement` so TypeScript retains element-specific properties without explicit casts.
- Any route change logic must stay in `routing.ts` to keep `main.ts` focused solely on state orchestration.

## Improvement Notes
- Consider extracting FAB action wiring into discrete command objects; it would simplify adding future actions (PDF export, theme presets) without further inflating `ui.ts`.
- Build a minimal routing test harness that feeds synthetic `window.location.pathname` values into `parseRoute()` to lock down edge cases (double-encoded URLs, legacy hash links).
- Wrap clipboard/share flows with centralized error handling so we can surface more descriptive UX (e.g., toast + fallback modal) instead of `alert()` dialogs.
- Evaluate bundling `fetchMarkdown` retries/backoff to handle transient network errors, especially for `/shared/` embeds that rely on third-party URLs.
