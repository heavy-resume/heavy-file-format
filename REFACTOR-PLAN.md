# Slot/Child Nesting Refactor Plan

## Goal

Move HVY block format from attribute-driven components to pure DOM-style
whitespace nesting. Slot markers become empty `{}` (or carry only slot-level
metadata); the real component lives one indent deeper as its own directive.

## Target format

**Before:**
```
  <!--hvy:component-list:0 {"id":"skill-se","component":"skill-record","expandableAlwaysShowStub":true,"expandableExpanded":false,"css":"..."}-->

   <!--hvy:expandable:0 {"component":"text","css":"margin: 0;"}-->
    Software Engineering

   <!--hvy:expandable:1 {"component":"text","css":"..."}-->
    #### Description
```

**After:**
```
  <!--hvy:component-list:0 {}-->

    <!--hvy:skill-record {"id":"skill-se","expandableAlwaysShowStub":true,"expandableExpanded":false,"css":"..."}-->

      <!--hvy:expandable:stub {}-->

        <!--hvy:text {"css":"margin: 0;"}-->
         Software Engineering

      <!--hvy:expandable:content {}-->

        <!--hvy:text {"css":"..."}-->
         #### Description
```

## Rules

- `component-list:N`, `container:N`, `table:R:D`, `grid:N` slot markers: always `{}`. All component props move to the nested child.
- `expandable:stub` / `expandable:content`: may carry `{lock: true}` only. Replaces `expandable:0` / `expandable:1`.
- `<!--hvy:expandable-->` and `<!--hvy:grid-->` host base-type props (`expandableAlwaysShowStub`, `expandableExpanded`, `gridColumns`) that previously sat on the custom-component parent when baseType was expandable/grid. With custom components (baseType expandable/grid), those props stay on the custom component marker (e.g., `<!--hvy:skill-record {expandableAlwaysShowStub:true,...}-->`).
- Child component: one indent deeper, tagged with its own component name (`<!--hvy:text {...}-->`, `<!--hvy:xref-card {...}-->`, `<!--hvy:skill-record {...}-->`, etc.).
- Grid `column` field is removed entirely. CSS grid auto-flow places items in order. Add optional `span: "full"` on the child when an item must break the flow (`grid-column: 1 / -1`). Removes `GridColumn` type, `coerceGridColumn`, column-picker UI.
- The old `"component":"X"` property on slot markers is a parse error (no backwards compat — repo has no prior users).

## Files to change

### Core parser/serializer
- **`src/serialization.ts`** — `parseBlocks` and `serializeNestedBlocks` / helpers. Largest change.
  - Parser: slot markers push attach-point frames with indent; nested child directive creates the block and attaches via innermost slot frame. Indent closes frames.
  - Serializer: emit empty slot markers (or `{lock}` / `{span:"full"}` where applicable) + nested child directive one indent deeper.

### Types
- **`src/editor/types.ts`** — remove `GridColumn` type; drop `column` from `GridItem`; add `span?: 'full'`.

### Grid logic
- **`src/grid-ops.ts`** — remove `coerceGridColumn` and placement logic; `createGridItem` no longer sets column; `parseGridItems` no longer reads column.

### Renderers
- **`src/editor/components/grid.ts`** — remove column-left/right classes; css grid already handles logic. Remove column picker UI if applicable.
- **`src/reader/render.ts`** grid path — same CSS changes.
- **`src/style.css`** — remove `.grid-item.column-left` / `.column-right`; add `.grid-item.span-full { grid-column: 1 / -1; }`.

### Seed / templates
- **`src/document-factory.ts`** — any seeded grid items lose `column`.
- **`src/editor/template.ts`** — ditto.
- **`src/bind-ui.ts`** — any column-change handlers removed.

### Examples (instance usage migration)
- **`examples/resume.hvy`** — migrate ~40 slot markers:
  - `expandable:0` → `expandable:stub`; `expandable:1` → `expandable:content`.
  - Drop `"component"` from all slot markers.
  - Move component props to nested child one indent deeper.
  - Drop `column` from grid slots;
  - Remove the spurious empty `<!--hvy:expandable {}-->` wrappers added during prior WIP (they are inside custom-component `skill-record`/`history-record` slots where the custom component's baseType already IS expandable — the wrapper is redundant).
- **`examples/resume.thvy`** — same rules.
- **`examples/example.hvy`** — same rules.

### Spec
- **`HVY-SPEC.md`** — document:
  - Slot markers carry only slot-level metadata.
  - Nesting via whitespace (Python-style) is required.
  - `expandable:stub` / `expandable:content` replace `expandable:0/1`.
  - Grid auto-flow; `span:"full"` for full-width items.

## Suggested phasing

**Phase 1 — serialization + examples + spec (bulk of the structural work):**
1. Rewrite `parseBlocks` in `src/serialization.ts` for new format.
2. Rewrite `serializeNestedBlocks` and slot helpers for new format.
3. Migrate `examples/resume.hvy`, `resume.thvy`, `example.hvy` (Python regex script is practical for the mechanical transform).
4. Update `HVY-SPEC.md`.
5. Run `tsc`; boot dev server; verify resume.hvy round-trips.

**Phase 2 — drop `column`, introduce `span`:**
1. Update `src/editor/types.ts`, `src/grid-ops.ts`.
2. Update `src/editor/components/grid.ts`, `src/reader/render.ts`, `src/style.css`.
3. Update `src/document-factory.ts`, `src/editor/template.ts`, `src/bind-ui.ts`.
4. Remove column picker UI; add full-width toggle.
5. `tsc`; manual browser test.

Phase 1 leaves a working repo even if Phase 2 isn't started. Phase 2 is a cleaner standalone change once Phase 1 has landed.

## Design notes for parser rewrite

Slot frames don't own a block — they're attach points. Proposed frame union:

```ts
type Frame =
  | { kind: 'component'; block: VisualBlock; indent: number }    // hvy:expandable / hvy:grid / hvy:container / hvy:component-list / hvy:table / custom
  | { kind: 'slot-expandable'; parent: VisualBlock; part: 0 | 1; indent: number }
  | { kind: 'slot-grid'; parent: VisualBlock; itemIndex: number; indent: number }
  | { kind: 'slot-component-list'; parent: VisualBlock; indent: number }
  | { kind: 'slot-container'; parent: VisualBlock; indent: number }
  | { kind: 'slot-table-details'; parent: VisualBlock; rowIndex: number; indent: number };
```

Child directive resolution: on seeing `<!--hvy:TYPE {...}-->` at indent N, close frames with `indent >= N`; then the innermost frame is the parent context. If it's a slot frame, the created block attaches into its collection; if it's a component frame with implicit container behavior (container / component-list), attach there; otherwise top-level.

Serializer mirrors: for each block with nested children (expandable stub+content, grid items, container items, component-list items, table details), emit an empty slot marker then serialize the child one indent deeper with its own `<!--hvy:TYPE {...}-->` directive.

## Things to verify after Phase 1

- `component_defs` in YAML front matter uses the internal schema shape (`expandableStubBlocks.children: [...]`) — that is an **in-memory schema format**, not wire format, and should NOT change. Only inline document markdown markers change.
- Editor renderers for expandable/grid don't read from wire format directly — they read from `block.schema`. Should keep working.
- Template Mode (thvy) behavior unchanged beyond the marker rewrite.

## DONE

- Rename `hvy:expandable:0` / `hvy:expandable:1` → `hvy:expandable:stub` / `hvy:expandable:content` in parser, serializer, and all example + spec files. `tsc` passes. Old numeric-indexed form removed from parser (no backwards compat). Slot markers can still carry the old `{component, ...}` payload at this stage — the empty-slot + nested-child restructuring is still pending.
