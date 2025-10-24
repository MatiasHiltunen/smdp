# Data-Link Redesign Plan

## 1. Current Flow Audit

### Share Path
- `client/ui.ts#createFabMenu` handles the “Share as Data Link” action.
- Flow: read markdown from the active textarea → `encodeMarkdownToBase64(markdown)` (in `src/data-link.ts`) → construct `/data/<payload>` URL → copy to clipboard.
- Theme customisations are appended as query params (`?d=<serialized-dark>&l=<serialized-light>`) via `theme/theme-editor.ts#saveThemeToUrl`.

### Load Path
- `client/routing.parseRoute` classifies `/data/<payload>` as shared HTML mode and exposes `dataPayload`.
- `main.ts` calls `decodeBase64Markdown(dataPayload)` which:
  1. Base64url decodes to compressed bytes.
  2. Decompresses via Compression Streams (defaults to gzip).
  3. Returns the original markdown bytes (UTF‑8).
- Resulting markdown is rendered normally; the renderer never sees the shared theme unless query params survive the share link.

### Pain Points
- Theme customisations are separated from the payload and lost if query params are stripped.
- The payload duplicates the entire markdown string; rebuild time on load (parse + render) is paid again.
- Base64 over gzip is easy but suboptimal for very long documents; the `/data/` path length grows quickly.

## 2. Goals
1. **Embed theme state** (dark + light variants) within the payload so the link is self-contained.
2. **Reduce render cost** by shipping a pre-parsed representation (block/inline events) that can be materialised without running the full parser.
3. **Improve compactness** with a higher-radix encoding (Base79) and potentially a slimmer binary representation than plain UTF‑8.
4. Maintain **backwards compatibility** with existing `/data/<base64>` links.

## 3. Proposed Binary Payload

### High-Level Pipeline
```
Markdown (UTF-8) ──parse──▶ Block/Inline events ──serialize──▶ Binary buffer ──compress──▶ Base79 url-safe string
                                                                                      │
                                                        Theme presets (dark/light) ───┘
```

### Routing
- Legacy payloads stay on `/data/<payload>`.
- New binary/Base79 payloads will live under `/data79/<payload>` so clients can switch based on `route.dataFormat` without breaking historic links.

### Serializer Components
| Section | Description | Notes |
|---------|-------------|-------|
| Header  | Magic `"SMDP"` (4 bytes) + version (u8) + flags (u8) + reserved (u16) | Implemented by `serializeBinaryPayload`. Theme flag bits mirror embedded sections. |
| Theme   | Each mode (dark/light) stored as length-prefixed payload produced by the existing theme serializer. | Applied immediately on decode; still mirrored into query params for legacy code. |
| Blocks  | Length-prefixed bytecode representing the block event stream (`encodeBlockSection`). Each record stores the event opcode plus offsets back into the markdown buffer. | Current implementation serialises the exact events produced by `parser/blocks`, enabling renderers to replay without reparsing. |
| Markdown | Length-prefixed raw markdown bytes retained for fallbacks and text arenas. | Allows legacy renderers to continue to operate while the AST path matures. |

### Encoding
- **Compression:** Continue with gzip via Compression Streams (fast, already polyfilled in tests).
- **Base79 Conversion:** Replace Base64 with the proposed alphabet to squeeze ~5% extra density and eliminate padding; add checksum support (see helper snippet below).

### Decoding Strategy
1. Detect payload type:
   - If prefixed with `"SMDP"` after base decoding → new binary format.
   - Otherwise fall back to legacy (gzip + markdown UTF‑8).
2. For binary payloads:
   - Verify checksum.
   - Hydrate theme tokens before rendering; apply immediately if query params absent.
   - Reconstruct block/inline structures and feed directly into renderers (HTML + Canvas). This will require new entry points on the renderer side (e.g. `renderBlocksToHtml(events)`).

## 4. Base79 Helper Integration
- Create `src/data-link/base79.ts` with:
  - `base79UrlSafeEncode(bytes: Uint8Array): string`
  - `base79UrlSafeDecode(text: string): Uint8Array`
  - Optional checksum wrappers (`base79EncodeWithChecksum`, `base79DecodeWithChecksum`)
- Use BigInt-based conversion as per the provided snippet.
- Add tests covering round-trip, leading zeros, checksum mismatch.

## 5. Incremental Migration Plan
1. **Phase 1 — Theme Embedding Frictionless Upgrade**
   - Extend current Base64 payload structure with a small header that includes serialised themes (still using markdown + gzip).
   - Update decoder to prefer embedded themes but continue supporting query params.
   - Mark payloads with a version byte so we can detect new format.
2. **Phase 2 — Binary AST & Base79**
   - Implement serializers/deserialisers for block/inline events.
   - Introduce Base79 helpers and switch encoder/decoder to the new pipeline when supported; keep legacy path for older links.
   - Add rendering entry points capable of consuming the binary AST without reparsing.
3. **Phase 3 — Cleanup**
   - Deprecate query-parameter theme persistence once adoption of embedded themes is high.
   - Monitor payload size/regression metrics; add benchmarks for encode/decode.

## 6. Open Questions / TODO
- Determine minimal AST schema: do we need full block & inline fidelity, or will storing HTML + metadata suffice?
- Should the binary include raw markdown for debugging/fallback?
- Decide on compression fallback in environments lacking Compression Streams (ship wasm gzip?).
- Ensure share links remain under common URL length limits (~2000 chars for some browsers).

## 7. Test Strategy
- **Legacy compatibility:** fixture containing existing Base64 payload should continue to decode; add regression tests that feed known `/data/<legacy>` strings through the new decoder.
- **Binary payload validation:** unit tests for serializer/deserializer round-trips (structural equality), checksum enforcement, and theme application.
- **End-to-end share link:** integration test simulating `createFabMenu` share flow → route parse → decode → render, verifying both light and dark themes match originals.
- **Property tests:** fuzz binary encoding with random block sequences to ensure decoder never throws and checksum detects corruption.
