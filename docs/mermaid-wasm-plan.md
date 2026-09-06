# Native Mermaid-compatible diagrams plan

Status: Phase 1 implemented; compatibility closure remains in progress, 2026-09-06

## Current implementation snapshot

The repository now contains the first vertical slice and the breadth scaffold
for the pinned Mermaid 11.17.2 target:

- a separate, no-import, hand-written SIMD WAT module scans diagram source into
  bounded fixed-width line records and is loaded only when diagram code runs;
- a checked host bridge copies the fenced source once, validates every returned
  span/count/cursor, and drains more than one result batch;
- all pinned diagram-family declarations are recognized and produce a bounded
  renderer-neutral scene through a family-specific or shared baseline layout;
- HTML emits accessible inline SVG, Canvas executes the same scene commands,
  and PDF maps them to native vector and searchable text operators;
- unsafe callbacks, JavaScript URLs, scripts, and `foreignObject` content are
  rejected; failures retain the original source block and following Markdown;
- narrow HTML views retain a legible minimum diagram width inside a local
  scroller without widening the document viewport; and
- `package.json` still has no runtime dependency section.

This is not yet the plan's definition of full support. Semantic parsing,
layout, routing, and SVG serialization currently live in TypeScript after the
SIMD line/token front end. Several specialist dialects intentionally render a
baseline visual rather than every Mermaid construct. The exact gaps are kept
in the [11.17.2 compatibility ledger](mermaid-compatibility-11.17.2.md). Moving
those stages behind the diagram ABI and closing that ledger remain the next
implementation phases.

## Outcome and compatibility contract

SMDP will render fenced `mermaid` blocks in HTML, Canvas, and PDF without
loading Mermaid, a layout library, a sanitizer, an icon package, a font, or a
network resource. Parsing, semantic validation, layout, edge routing, and scene
generation will run in a hand-written WebAssembly SIMD core. TypeScript will
remain a thin platform adapter for browser text measurement and the final
Canvas/PDF API calls.

"Full support" needs a stable target because Mermaid syntax continues to grow.
Before implementation starts, pin one Mermaid reference release and snapshot
its [diagram syntax index](https://mermaid.js.org/intro/syntax-reference.html)
and [configuration schema](https://mermaid.js.org/config/schema-docs/config.html).
Compatibility then means:

- every diagram type and non-experimental construct in that snapshot parses;
- beta diagram types are supported against their pinned syntax, with an
  explicit compatibility flag;
- node, edge, grouping, label, ordering, and configuration semantics match the
  reference behavior;
- layout is deterministic and semantically equivalent, but it is not required
  to be pixel-for-pixel identical to Mermaid's third-party layout engines;
- unsupported or unsafe behavior produces a source-located diagnostic and
  preserves the original fenced block instead of silently dropping content.

No dependency means the published package keeps an empty runtime dependency
graph. It must not add `mermaid`, D3, Dagre, ELK, DOMPurify, icon packs, CDN
assets, or remote fonts. Local dynamic imports are allowed to keep the diagram
chunk off the ordinary Markdown path. The existing build-only WAT-to-WASM
verification path can continue, while the authored WAT and exact compiled
binaries remain checked in.

## Architectural fit

The Markdown parser already emits fenced-code byte spans and the renderers
buffer each code block once for multiline syntax highlighting. Mermaid blocks
will use the same boundary without introducing a Markdown document tree.

```text
Markdown block stream
  -> one buffered mermaid source span
  -> lazy diagram SIMD module
       -> dialect parse + semantic arena
       -> text metric requests <-> host metric adapter
       -> layout + edge routing
       -> typed scene-command stream
            -> safe SVG bytes for HTML
            -> Canvas command sink
            -> native vector/text PDF sink
```

The diagram core may keep a temporary graph arena inside WASM memory because
graph layout requires random access. That arena must not become a JavaScript
object tree. Source text remains byte ranges into the single copied input, and
the host drains bounded command batches as it does for the current syntax
tokenizer.

## Proposed modules

```text
src/diagram/
  abi.ts                 typed command and error decoding
  runtime.ts             lazy module lifecycle and bounded memory policy
  metrics.ts             browser/PDF text-metric adapters
  svg-renderer.ts        trusted byte result insertion and accessibility shell
  canvas-renderer.ts     scene-command to CanvasRenderingContext2D
  pdf-renderer.ts        scene-command to existing native PDF primitives
  theme.ts               CSS/PDF theme token packing

src/wasm/
  smdp-diagram-core.wat
  smdp-diagram-core.wasm
  smdp-diagram-binary.ts

tests/diagram/
  corpus/
  reference/
  malformed/
```

Keep the diagram binary separate from `smdp-core.wasm` and load it only after a
`mermaid` fence is encountered. Ordinary Markdown should not pay its download,
compile, or memory cost.

## Diagram ABI

Use a separate versioned diagram ABI rather than changing the existing line and
highlight tokenizer ABI.

Suggested exports:

- `diagram_abi_version() -> i32`
- `diagram_uses_simd() -> i32`
- `diagram_begin(src, length, options, result) -> status`
- `diagram_metric_requests(handle, cursor, out, capacity, result) -> status`
- `diagram_supply_metrics(handle, metrics, count, result) -> status`
- `diagram_layout(handle, viewport, result) -> status`
- `diagram_scene(handle, cursor, out, capacity, result) -> status`
- `diagram_svg(handle, cursor, out, capacity, result) -> status`
- `diagram_diagnostics(handle, cursor, out, capacity, result) -> status`
- `diagram_drop(handle)`

All tables use little-endian fixed-width records. Records refer to source text
with `(start, end)` byte offsets or to an internal string arena with
`(pointer, length)`. The host validates every count, offset, length, enum, and
cursor before reading memory.

The scene vocabulary should be small and renderer-neutral:

- group begin/end and clipping;
- line, polyline, cubic path, rectangle, rounded rectangle, ellipse, polygon;
- fill/stroke using theme-token indexes or validated packed colors;
- text run, multiline text, label background, and underline;
- marker definitions and marker references;
- link/focus hit regions and accessibility metadata;
- z-order and stable source identifiers.

SVG serialization belongs in WASM so HTML receives a complete, safe SVG byte
stream. Canvas and PDF adapters execute the same typed scene stream because the
platform drawing APIs cannot be invoked directly from a no-import WASM module.

## SIMD and memory strategy

SIMD should accelerate byte-heavy work, not be forced into graph algorithms
where scalar operations are clearer:

- 16-byte delimiter, newline, whitespace, comment, quote, and identifier scans;
- character-class masks for numbers, arrows, brackets, and punctuation;
- case-folded diagram declaration detection;
- batched numeric parsing and bounds checks where measurable;
- scene-record validation and copies.

Graph traversal, cycle breaking, ranking, and routing stay scalar inside WASM.
The module remains the parser-renderer even when a particular algorithm does
not benefit from vector instructions.

Memory rules:

- copy each diagram source into WASM exactly once;
- use bump arenas reset by `diagram_drop`, with no per-node host allocations;
- drain metric, scene, SVG, and diagnostic output in fixed-size batches;
- retain at most a small LRU of compiled/runtime instances;
- evict oversized memories instead of retaining their grown high-water mark;
- enforce checked arithmetic before every pointer/length calculation;
- cancel and discard stale renders when live editing supersedes a request.

Provisional defensive limits should be explicit and configurable: source bytes,
nodes, edges, label bytes, nesting depth, layout iterations, total scene
commands, and output bytes. Limit failures are diagnostics, never partial
success.

## Text measurement

Exact layout depends on font metrics that WASM cannot discover on its own. Use
a deterministic resume protocol:

1. WASM parses labels and emits unique metric requests containing text ranges,
   font role, size, weight, and line-height.
2. The browser adapter measures them with one hidden Canvas context; the PDF
   adapter uses the exporter's actual font metrics.
3. The host writes compact measurements back into WASM.
4. WASM performs wrapping, layout, routing, and scene generation.

Cache metric tuples by font fingerprint and text bytes. Never pass DOM nodes or
HTML fragments through this boundary. Mermaid Markdown labels are tokenized by
the diagram core into text spans; raw HTML labels are represented with safe
text/style primitives rather than `foreignObject`.

## Syntax coverage waves

The pinned compatibility matrix is authoritative. The waves below organize work
by shared grammar and layout primitives, not by product priority.

| Wave | Diagram families | Shared implementation work |
| --- | --- | --- |
| 0 | All dialects | declaration probe, comments, frontmatter, directives, config validation, titles, accessibility text, styles, class assignment, diagnostics |
| 1 | Flowchart, Sequence, Class, State, Entity Relationship | identifiers, labels, graph arena, subgraphs, hierarchical layout, lifelines, cardinalities, edge markers |
| 2 | Mindmap, Block, Architecture, Requirement, C4, Event Modeling, Swimlanes, TreeView | nested containers, ports, boundaries, orthogonal routing, fixed and mixed layout constraints |
| 3 | Gantt, User Journey, Timeline, GitGraph, Kanban | dates and durations, ordered lanes, milestones, branches, cards, axis and calendar logic |
| 4 | Pie, Quadrant, XY, Radar, Sankey, Treemap, Venn | numeric domains, scales, legends, partitions, ribbons, overlap geometry |
| 5 | Packet, Ishikawa, Wardley, Cynefin, Railroad, ZenUML, and every remaining type in the pinned index | bit ranges, specialist axes, grammar rails, dialect-specific layout and final matrix closure |

New Mermaid types appearing after the pinned release do not silently extend the
claim. They enter a new compatibility target and corpus update.

## Common grammar and configuration

Implement shared syntax once in WASM:

- diagram declaration aliases and versioned beta declarations;
- `%%` comments, quoted/escaped labels, entities, and multiline labels;
- YAML-like frontmatter limited to the documented Mermaid keys;
- legacy `%%{...}%%` directives through a bounded JSON subset parser;
- theme variables, `classDef`, `class`, `style`, and link/edge style rules;
- deterministic IDs and a caller-provided seed;
- direction, spacing, curve, wrapping, look, and layout options;
- title and accessibility title/description fields.

Unknown keys follow the pinned reference contract. Dangerous keys and values
are rejected even if loose Mermaid deployments accept them.

## Internal layout engines

All engines are implemented locally and selected by dialect:

- layered directed graph: cycle breaking, ranking, crossing reduction,
  coordinate assignment, and edge routing for flow/state/class-style graphs;
- orthogonal constrained graph: ports, nested boxes, and obstacle routing for
  architecture/block/C4 families;
- ordered lanes: sequence, journey, timeline, Gantt, GitGraph, swimlane, and
  kanban families;
- direct analytic charts: pie, quadrant, XY, radar, packet, and railroad;
- partition/flow geometry: treemap and Sankey;
- set geometry: deterministic circle placement and label regions for Venn;
- tree layout: mindmap, TreeView, and Ishikawa.

Layouts must be deterministic for the same source, metric table, theme, and
viewport. Random or force-directed placement is excluded unless it uses a
documented deterministic seed and a strict iteration budget.

## Renderer integration

### HTML

- Replace a successful `mermaid` fence with inline SVG produced by WASM.
- Use a responsive `viewBox`, `max-width: 100%`, and an intrinsic aspect ratio.
- Add `role="img"`, `<title>`, `<desc>`, stable IDs, and safe link targets.
- Keep source line metadata on the wrapper for editor-preview synchronization.
- On error, show a compact diagnostic followed by the original source block.

### Canvas

- Add diagram commands to the existing measure/draw and virtual-scroll flow.
- Cache the parsed/layout diagram between the measure and paint passes.
- Scale to the reader width without allocating a full-document bitmap.
- Preserve an accessible DOM summary adjacent to the canvas surface.

### PDF

- Map scene paths, fills, strokes, markers, text, and links to native PDF
  operators; never rasterize a whole diagram.
- Reuse document theme colors and actual PDF font metrics.
- Treat a diagram as a keep-together block when it fits; otherwise scale to the
  content width or split only diagram types with a defined semantic split.
- Emit searchable text and link annotations.

## Security and privacy

Typed scene generation replaces post-hoc SVG sanitization. The serializer has
no operation for scripts, event attributes, arbitrary elements, CSS injection,
or `foreignObject`.

- reject `javascript:` and other unsafe URL schemes through the existing URL
  allowlist;
- disable callback execution and arbitrary click handlers;
- make external images opt-in and route them through the existing resolver and
  byte limits;
- accept only registered built-in icon data; do not fetch icon packs;
- validate colors, lengths, class names, IDs, and URL destinations before they
  enter a scene record;
- place hard budgets on parsing and layout to prevent denial-of-service input;
- perform no network requests merely because a Mermaid block exists.

This intentionally targets Mermaid syntax and visual semantics, not unsafe
`securityLevel: loose` behavior.

## Responsive behavior

- Layout against the diagram container's actual inline size, not global
  `window.innerWidth`.
- Re-layout only when the container crosses a meaningful width bucket; scale
  within a bucket to avoid resize thrashing on fold transitions.
- Prefer legible minimum text size. If scaling below it would be required, use a
  locally scrollable diagram surface without widening the document root.
- Include safe-area insets, vertical writing constraints, RTL labels, browser
  zoom, and 280-500 px cover-screen widths in the compatibility matrix.
- Keep the diagram runtime off the main interaction path by using the current
  worker pattern for parse/layout jobs and cancelling superseded work.

## Delivery phases and gates

### Phase 0: compatibility ledger

- Pin the Mermaid reference release and archive links to its syntax/config docs.
- Build one positive, malformed, styling, accessibility, and stress fixture per
  documented construct.
- Record intentional security deviations.
- Gate: every matrix row has an owner wave and an observable expected result.

### Phase 1: ABI and vertical slice

- Ship the lazy diagram module, checked-memory bridge, metric handshake, scene
  decoder, theme packing, and diagnostics.
- Complete Flowchart end to end in HTML, Canvas, and vector PDF.
- Gate: no dependency change; scalar/reference and SIMD differential tests
  agree; malformed fences never consume following Markdown.

### Phase 2: graph families

- Complete Waves 1 and 2, including nested containers, edge labels, markers,
  links, and shared styling.
- Gate: all graph corpus fixtures pass semantic and renderer parity checks.

### Phase 3: ordered and numeric families

- Complete Waves 3 and 4 with deterministic axes, legends, dates, scales, and
  responsive layout.
- Gate: locale/time-zone inputs are explicit and golden output is deterministic.

### Phase 4: specialist dialects

- Complete Wave 5 and every remaining pinned matrix row.
- Gate: zero unsupported non-experimental syntax in the pinned corpus.

### Phase 5: hardening and public API

- Freeze ABI v1 for diagrams, document options, add worker cancellation and
  caches, and run browser/PDF visual QA.
- Gate: memory, fuzz, accessibility, security, and performance budgets pass on
  desktop and narrow mobile viewports.

## Verification strategy

- Parser conformance: source-to-normalized-scene fixtures for every syntax row.
- Differential tests: scalar reference routines versus SIMD scanners for all
  byte primitives and batch boundaries.
- Reference corpus: checked-in expected semantic facts and normalized SVG
  snapshots generated from the pinned Mermaid release, without shipping or
  installing Mermaid at runtime.
- Renderer parity: the same nodes, labels, links, and bounds across SVG, Canvas,
  and PDF sinks.
- Visual goldens: light/dark themes, long labels, Unicode, RTL, dense graphs,
  280/320/360/500 px widths, print sizes, and page breaks.
- Fuzzing: declarations, delimiters, nesting, numeric overflow, malformed UTF-8,
  deep graphs, cycles, and truncated batch buffers.
- Performance: cold module compile, warm parse, metric round-trip, layout,
  scene emission, peak pages, and edit-to-paint latency.
- Failure recovery: invalid diagrams retain their source and subsequent
  Markdown renders normally in all three targets.

## Definition of done

- The pinned Mermaid syntax/config matrix has no unexplained gaps.
- `package.json` still has no runtime dependencies and rendering performs no
  implicit network requests.
- Parsing, semantic analysis, layout, routing, and SVG/scene generation execute
  in the SIMD WASM diagram core.
- HTML is accessible SVG, Canvas uses bounded command execution, and PDF remains
  searchable native text/vector output.
- The Markdown pipeline remains single-pass outside each necessarily buffered
  diagram fence and builds no JavaScript document tree.
- Narrow-screen, malformed-input, fuzz, memory, and renderer-parity gates pass.
