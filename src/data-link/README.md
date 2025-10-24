# Data Link

## Overview
- Encodes markdown + theme metadata into compact, URL-safe payloads for the `/data79/*` and `/edit/data79/*` routes.
- Maintains backward compatibility with legacy base64 links (`/data/*`) while defaulting new shares to the high-density Base79 format with integrity checks.
- Bundles pre-parsed block events so renderers can skip block parsing when consuming a structured payload.

## Modules
- `base79.ts`
  - Implements URL-safe Base79 encoding/decoding with optional FNV-1a checksum suffixes.
  - Preserves leading zero bytes, allowing arbitrary binary buffers (compressed data, AST bytecode).
  - Exports low-level primitives and checksum helpers (`base79EncodeWithChecksum` / `base79DecodeWithChecksum`).
- `payload.ts`
  - Defines the structured payload layout:
    - Header: magic (`SMDP`), version, flags describing included theme variants.
    - Theme sections: mode byte (`dark` / `light`) + length-prefixed UTF-8 data (compact theme diffs).
    - Block section: serialized block event stream (`encodeBlockSection`) for renderer fast-paths.
    - Markdown section: raw UTF-8 markdown bytes.
  - Provides binary writer/reader utilities plus `serializeBinaryPayload` / `deserializeBinaryPayload`.
- `../data-link.ts`
  - Public surface used by the UI:
    - `encodeSharePayload` compresses structured payloads via Compression Streams, then Base79 encodes with checksum.
    - `decodeSharePayload` reverses the process, returning `{ markdown, themes, blocks?, format }`.
    - Legacy helpers (`encodeMarkdownToBase64`, `decodeBase64Markdown*`) route through the same compression layer for `/data/*` URLs.
  - Normalizes environment quirks (missing `Uint8Array.toBase64`, absent Compression Streams) with fallbacks used in node tests.

## Runtime Flow
1. FAB share action (`client/ui.ts`) collects markdown + theme query params.
2. `encodeSharePayload` → UTF-8 bytes → structured payload → gzip (default) → Base79 + checksum.
3. Resulting string embedded in `/data79/{payload}`. Theme params (`?d=…&l=…`) remain in the query for visual parity when the link loads.
4. `main.ts` inspects route; for `/data79/*` the payload is decoded, theme overrides applied, block bytecode passed straight into renderers.
5. Canvas/HTML renderers can skip block generation by calling `MDParser.parseFromBlocks` / `renderToCanvasFromBlocksPayload`.

## Interop Notes
- Legacy `/data/*` links are still decoded; `dataFormat: "legacy"` keeps the UI aware of the payload type.
- `ShareEncodeOptions`/`ShareDecodeOptions` allow forcing `encoding: "base64"` for environments that cannot handle Base79 yet.
- Theme payloads are optional; absent entries simply keep the viewer’s current theme defaults.

## Testing
- `tests/data-link.test.ts` exercises compression fallbacks, structured payload round-trips, and legacy compatibility.
- `tests/base79.test.ts` covers low-level Base79 behaviour (leading zeros, checksum validation).

## Improvement Notes
- Add a streaming decoder so very large payloads can be processed without buffering the entire compressed output.
- Investigate brotli-by-default links once browser support improves; Base79 neutralizes the size penalty, but we need browser detection for Safari.
- Extend the structured payload to include cursor/scroll state or renderer hints (e.g., preferred mode) for richer collaborative links.
