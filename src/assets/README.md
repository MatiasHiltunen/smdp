# Assets

## Overview
- Holds bundled content that ships with the app. Today the directory contains the canonical markdown fixture used across demos, tests, and the offline fallback path.
- Assets are copied by the build and resolved relative to the app server so the client can fetch them with a simple `/test.md` request when no external URL is supplied.

## Files
- `test.md` &mdash; exhaustive markdown sample that exercises the parser and renderers. It includes:
  - Headings, paragraphs, emphasis, strong text, strikethrough, lists (ordered/unordered), footnotes, blockquotes, tables, callout blocks (`::: info` etc.), and inline HTML-like constructs.
  - Syntax-highlighted fenced JavaScript code and inline code spans to validate both HTML and canvas renderers.
  - External resource references (links, images) to verify URL allowlisting, base URL resolution, and image virtualization in the canvas renderer.
  - Unicode-heavy content (combining marks, Hangul, emoji) that stresses the grapheme-aware wrapping logic in `parser/canvas-renderer.ts`.

## Runtime Usage
- `client/fetch.ts` defaults to `/test.md` whenever the route does not supply an external URL or base64 payload, ensuring the UI always boots with meaningful content.
- Parser regression tests (within `tests/`) load this fixture to guarantee coverage of new markdown features.
- The canvas renderer uses the file to keep its measurement cache warm and to validate lazy image loading logic.

## Extending
- Additional canned documents should live beside `test.md` and follow the same naming convention. Update the fetch fallback (`client/fetch.ts:7`) if you replace the default sample.
- Keep fixtures small enough to load quickly, but rich in feature coverage so regressions surface early.

## Improvement Notes
- Introduce separate fixtures for targeted scenarios (e.g., one focused on tables, one on emoji/RTL) so tests can isolate regressions faster instead of diffing the large omnibus file.
- Add a manifest (JSON/YAML) describing each asset, allowing the client to list demo documents dynamically rather than hard-code `/test.md`.
- Build a lightweight generator script that can synthesize combinatorial markdown samples (different fence languages, nested lists) to keep coverage up-to-date as new syntax support lands.
