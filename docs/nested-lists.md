# Nested Lists Feature Design

## Goals
- Support arbitrarily nested ordered and unordered lists using indentation.
- Preserve existing behaviour for flat lists, task list items, and mixed list kinds.
- Maintain compatibility with both HTML and canvas renderers without requiring downstream API changes.

## Parsing Strategy
- Track active list stack entries as `{ kind, indent }`.
- Measure indentation in columns (spaces count as 1, tabs as 4) by combining the leading column offset (the distance from the line start to the marker) with the existing `parseListMarker` helper. The indent reflects the column where the list marker begins.
- When a new list marker is encountered:
  1. Close stack entries while their `indent` is greater than the incoming indent — returning control to an outer list level.
  2. If the top stack entry has the same indent but a different `kind`, close it so the new list can replace it at that level.
  3. If the incoming indent is greater than the top stack entry's indent, open a nested list.
  4. Emit a `listItem` event for the current line after handling the stack.
- Blank lines continue to close all open lists.
- EOF still flushes any open lists.

## Rendering Strategy
- HTML renderer maintains its own `listStack`; it relies on parser-emitted open/close events. No structural changes are required — the improved event discipline guarantees the stack only reflects currently active lists.
- Canvas renderer similarly uses a stack paired with a visual indent (`INDENT` constant). Updated parser events ensure the renderer receives `listOpen`/`listClose` sequences that mirror the logical structure.

## Testing
- Update golden tests to assert proper nesting for a mixture of ordered/unordered/task lists.
- Add focused unit coverage for nested scenarios (including indent increases, decreases, and kind switches) to catch regressions.
- Execute the existing property tests to ensure broader parsing expectations remain valid.
