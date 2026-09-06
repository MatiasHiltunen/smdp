# Mermaid 11.17.2 compatibility ledger

Reference target: Mermaid 11.17.2 (`mermaid@11.17.2`, source commit
`dcb694d`). This ledger describes SMDP's native implementation; it does not
mean the Mermaid package is bundled or executed.

Status terms:

- **Baseline**: common declarations and representative semantics have a native
  renderer plus automated coverage.
- **Scaffold**: the declaration is recognized and a bounded specialist visual
  is produced, but substantial grammar or semantic work remains.
- **Conformant**: every non-experimental construct in the pinned corpus matches
  the documented semantic result. No family has reached this status yet.

| Family | Current native path | Status | Important remaining work |
| --- | --- | --- | --- |
| Flowchart / graph | Layered nodes, common shapes, labeled/dashed/thick directed edges, TB/BT/LR/RL | Baseline | chained edges, nested subgraphs, link/style/class rules, curves and complete shape set |
| Sequence | Participants, actors, messages, dashed replies, lifelines and basic notes/fragments | Baseline | activations, boxes, autonumber, complete fragment/note placement and links |
| Class | Class declarations and inheritance/association edges through shared graph layout | Baseline | members, annotations, namespaces, generics, cardinality and relation-end markers |
| State | States, transitions and start/end boundary labels through shared graph layout | Baseline | composite/concurrent states, notes, forks, joins and exact pseudo-state geometry |
| Entity relationship | Entities, relationship labels and solid/dashed relations | Baseline | attributes, identifying semantics and complete cardinality markers |
| Pie | Numeric slices, labels and legend | Baseline | showData/config parity, label collision handling and negative-input diagnostics |
| Quadrant | Axes, quadrants and positioned points | Baseline | documented axis/title directives, point styling and boundary labels |
| XY | Bar/line series with axes | Baseline | x-axis categories/ranges, multiple named series, scales and chart config |
| Radar | Axes and polygon series | Baseline | multiple curves, legends, ticks, options and missing-value rules |
| Sankey | Weighted source/target lanes | Scaffold | node conservation, iterative ordering, true ribbon geometry and link labels |
| Treemap | Weighted proportional cells | Scaffold | hierarchy, sections, padding, value rules and squarified partitioning |
| Venn | Deterministic set circles and labels | Scaffold | region expressions, weighted overlap solving and intersection labels |
| User journey | Ordered section lanes and scored items | Baseline | actor/task semantics, score presentation and exact ordering/style rules |
| Gantt | Ordered section lanes and task labels | Scaffold | date parser, duration/dependency scheduling, excludes, milestones, ticks and today marker |
| Timeline | Ordered sections and events | Baseline | periods, multiline events, icon/type semantics and exact grouping |
| Git graph | Ordered branch/commit lanes | Scaffold | branch topology, checkout/merge/cherry-pick semantics, tags and commit options |
| Kanban | Ordered columns/cards | Scaffold | YAML metadata, assignments, tickets, priorities and constraints |
| Swimlanes | Ordered section/item lanes | Scaffold | pinned beta grammar, lane relationships and nested content |
| Mindmap | Indentation tree with deterministic placement | Baseline | complete node shapes, icons/classes and richer wrapping |
| TreeView | Indentation tree with deterministic placement | Scaffold | pinned beta grammar, metadata and exact connector rules |
| Ishikawa | Indentation tree using the shared tree engine | Scaffold | spine/branch semantics, sided placement and cause grouping |
| Requirement | Shared directed graph | Scaffold | requirement/element blocks, risk/method fields and relationship types |
| C4 | Common Person/System/Container/Component calls and Rel calls | Baseline | boundaries, deployment details, layout directives, tags and sprites |
| Block | Shared directed graph | Scaffold | columns, nested blocks, ports, space nodes and edge endpoint syntax |
| Architecture | Services/groups and common connections through shared graph layout | Scaffold | ports/sides, nesting, junction routing, icons and complete beta grammar |
| Packet | Bit ranges rendered as bounded fields | Baseline | row wrapping rules, range validation, display widths and styling directives |
| Wardley | Components on a visibility/evolution plot | Baseline | anchors, pipelines, inertia, notes, links and evolution labels |
| Cynefin | Native domain grid with statement labels | Scaffold | documented statement grammar, domain placement and styling parity |
| Railroad / ABNF / EBNF / PEG | Rule rows and term rails | Scaffold | grammar parsing, grouping, repetition, choice, terminals and references |
| ZenUML | Sequence-compatible messages and participants | Scaffold | ZenUML blocks, nesting, return rules, annotations and typed declarations |
| Event Modeling | Bounded native event cards | Scaffold | pinned grammar, swimlanes, timelines, command/event/read-model semantics |

## Cross-cutting status

| Area | Implemented | Remaining gate |
| --- | --- | --- |
| Runtime isolation | Separate checked-in WAT/WASM/binary module; no imports; SIMD newline scanning; bounded batch bridge | move semantic arena, layout, routing and scene serialization into ABI v1 |
| HTML | lazy native SVG, title/description, strict SVG allowlist, source-preserving errors | container metric handshake, focus/link regions, RTL and reference visual corpus |
| Canvas | shared scene execution, measure/draw cache, worker-compatible serializable options | adjacent accessible summary and stale-render cancellation |
| PDF | native paths/fills/strokes/text, theme colors, keep-together diagrams, heading lookahead | links, semantic splitting for oversized diagrams and broader print goldens |
| Safety | no callbacks/scripts/foreign objects/implicit network; source, line and command limits | fuzz corpus, complete directive/config validation and external-image policy |
| Responsive | local scroller below 640 px; verified at a 320 px viewport without root overflow | container width buckets, fold transition re-layout, RTL and zoom matrix |

## Compatibility rule

Only rows promoted to **Conformant** may be described as full syntax support.
Until every pinned row reaches that state, public documentation calls the
feature experimental Mermaid-compatible rendering and links to this ledger.
