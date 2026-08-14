# Static Table Column Presentation Plan

## Status

Implemented in the reference format, editor, reader, CLI, AI guidance, and PDF export. Remaining unchecked items identify follow-up coverage or refactoring opportunities rather than blockers for the initial capability.

## Goal

Add spreadsheet-style sizing and formatting controls to built-in static table columns without changing `tableColumns` from its intentionally simple array of strings or moving searchable table values back into directive JSON.

The first implementation should focus on direct column sizing, wrapping, alignment, and safe overflow inside the rendered document surface. It should reuse the existing database-table interaction patterns where practical.

## File format

Keep column labels and row values unchanged:

```json
"tableColumns": ["Stage", "Applications", "Interviews"]
```

```markdown
| Stage | Applications | Interviews |
| --- | --- | --- |
| Applied | 12 | 0 |
```

Add an optional sparse presentation map keyed by the exact authored column string:

```json
"tableColumnProperties": {
  "Stage": {
    "width": "12rem",
    "wrap": true
  },
  "Applications": {
    "width": "8rem",
    "align": "right"
  },
  "Interviews": {
    "align": "right"
  }
}
```

The complete inline table remains compact because only non-default properties are emitted:

```markdown
<!--hvy:table {"tableColumns":["Stage","Applications","Interviews"],"tableColumnProperties":{"Stage":{"width":"12rem","wrap":true},"Applications":{"width":"8rem","align":"right"},"Interviews":{"align":"right"}}}-->
| Stage | Applications | Interviews |
| --- | --- | --- |
| Applied | 12 | 0 |
```

Initial property shape:

```ts
interface TableColumnProperties {
  width?: string;
  wrap?: boolean;
  truncate?: boolean;
  align?: 'left' | 'center' | 'right';
  headerAlign?: 'left' | 'center' | 'right';
}
```

Rich text inside a header or cell remains content Markdown. Column properties control the presentation of the column as a whole.

## Property lookup and lifecycle

- Property keys match the exact stored `tableColumns` string, including any Markdown or HVY inline annotations.
- Do not match rendered plain text, introduce aliases, or perform fuzzy matching.
- Renaming a column through the editor also moves its property entry from the old exact key to the new exact key.
- Reordering a column requires no property-key rewrite.
- Removing the last column with a given name removes its property entry.
- A property entry with no matching column should be reported by the table linter and ignored by renderers.
- Duplicate column names share one property entry. Different presentation for two identically named columns is intentionally unsupported in this design.

## Implicit defaults and serialization

Effective defaults preserve current static-table behavior:

```ts
{
  width: 'auto',
  wrap: false,
  truncate: true,
  align: 'left',
  headerAlign: 'center'
}
```

For static tables, automatic width means:

- When every column is automatic, columns divide the available table width equally based on the number of columns.
- When some columns have authored widths, automatic columns divide the remaining width equally.
- When authored widths require more than the available surface width, the table becomes horizontally scrollable inside its table frame.

Serialization rules:

- Do not materialize implicit defaults into document state.
- Omit properties equal to their implicit defaults.
- Omit empty column-property objects.
- Omit `tableColumnProperties` when no columns have non-default presentation.
- Accepting an explicit `"width":"auto"` may be useful at input boundaries, but normalization should remove it because it equals the implicit default.
- Resetting a width removes the authored `width` field.
- Resetting all properties should return the component directive to the existing static-table format.

## Width and overflow behavior

The initial implementation will not attempt to determine whether an authored CSS width is reasonable.

- Store an authored width as a string.
- Do not add a new semantic CSS-width validator, maximum-width warning, or authored-width clamp as part of this feature.
- Use the existing CSS safety/sanitization boundary when placing document-authored values into rendered output.
- If the browser cannot use a width value, normal browser CSS behavior applies and the column effectively falls back to automatic layout.
- If a valid configured width makes the table wider than its container, preserve the width and provide horizontal scrolling inside `.reader-table-frame` or `.table-editor-frame`.
- The table must not widen the document, escape the emulated preview frame, or create viewport-level overflow.

Interactive resize and auto-fit produce concrete pixel widths. Reset returns the column to implicit automatic width.

## Spreadsheet-style editor interaction

- Show a resize target at the right edge of each editable column header.
- Drag the boundary to resize the column with immediate local DOM feedback.
- Double-click the boundary to auto-fit the rendered header and cell contents, then store the measured pixel width.
- Provide a column control or contextual menu for:
  - Auto-fit contents.
  - Reset to automatic width.
  - Toggle wrapping and reader truncation.
  - Set body-cell alignment.
  - Set header alignment.
  - Enter an explicit width for keyboard and accessibility use.
- Keep header-text editing separate from selecting or configuring the whole column.
- Do not perform a full `getRenderApp()()` rerender while dragging, typing a width, or changing ordinary presentation properties.
- Mutate document state, update the relevant `<col>` and table DOM locally, and refresh passive reader surfaces without replacing the focused editor.

## Rendering approach

Use a `<colgroup>` in both the static-table editor and reader so the same resolved properties drive active and passive views.

```html
<colgroup>
  <col style="width:12rem">
  <col style="width:8rem">
  <col>
</colgroup>
```

Use semantic classes or data attributes for wrapping and alignment rather than generating selector-based CSS. Keep the table frame responsible for horizontal overflow.

The static table and database table should share reusable utilities for column-width resolution, content measurement, resize pointer handling, and auto-fit behavior rather than maintaining two nearly identical implementations.

## CLI and AI exposure

Expose a writable static-table file alongside the existing data files:

```text
tableColumns.json
tableColumnProperties.json
tableRows.json
```

`tableColumnProperties.json` contains the same sparse object serialized in the component directive. The existing `tableColumns.json` remains a JSON string array, and `tableRows.json` remains a JSON array of row objects.

AI and component documentation should explain:

- Static table labels remain in `tableColumns.json`.
- Static table values remain in `tableRows.json` and serialize into the GFM body.
- Width, wrapping, and alignment belong in `tableColumnProperties.json`.
- Property keys use exact authored column strings.
- Missing properties use implicit defaults.
- Resetting a property means removing it rather than writing the default.
- Selector CSS in the component's inline CSS field is not a column-formatting mechanism.

## Compatibility

- Existing files remain valid because the new field is optional and all behavior has implicit defaults.
- New readers render old tables exactly as they do today when the field is absent.
- Readers that do not understand `tableColumnProperties` should ignore the unknown field and render the existing table data with their default column layout.
- Opening and re-saving a new file in an older authoring client may discard the unknown field; render compatibility does not guarantee lossless editing in old clients.
- The GFM table body and search indexing rules do not change.

## PDF and other non-scrollable outputs

HTML editor/viewer overflow is the first implementation target. PDF cannot scroll, so export needs a separate fit-to-page policy.

The anticipated behavior is to interpret supported widths as preferences, assign remaining space to automatic columns, and proportionally fit an over-wide table to the printable content area with wrapping. Exact CSS-unit conversion and unsupported-width behavior should be specified when implementing the PDF portion rather than expanding the initial browser-layout scope.

## Implementation TODOs

### Specification and types

- [x] Add `tableColumnProperties` to the static table section of `HVY-SPEC.md`.
- [x] Document exact-key matching, duplicate-name behavior, implicit defaults, sparse serialization, and overflow behavior.
- [x] Add `TableColumnProperties` and the property map to the static table schema types.
- [x] Add a shared resolver that returns effective properties without materializing defaults.

### Parsing and serialization

- [x] Parse and normalize the optional property map while preserving `tableColumns` as strings.
- [x] Serialize only non-default properties and omit empty entries/maps.
- [x] Ensure component definitions, reusable templates, cloning, encryption, and raw component replacement preserve the field.
- [x] Ensure unknown or orphaned entries do not enter content search or semantic indexing.
- [x] Add round-trip coverage for absent, partial, reset, annotated-label, and duplicate-label property maps.

### Table operations

- [x] Move a property key when a unique column is renamed.
- [ ] Define and test rename behavior when the old or new label is duplicated.
- [x] Remove orphaned properties when columns are removed.
- [x] Preserve properties across reorder, row edits, and structural cloning.
- [x] Ensure undo and redo treat each presentation action as one coherent edit.

### Shared column behavior

- [x] Extract reusable width resolution and content measurement from the database-table implementation.
- [ ] Extract reusable pointer resize and double-click auto-fit behavior.
- [x] Keep database-specific configuration and static-table schema mutations behind separate adapters.
- [x] Avoid a new full application rerender path for ordinary presentation changes.

### Editor UX

- [x] Add vector-based resize handles to static table column headers.
- [x] Add drag-to-resize with local `<col>` updates.
- [x] Add double-click auto-fit.
- [x] Add reset-to-automatic-width.
- [x] Add themed, accessible column settings for width, wrap, body alignment, and header alignment.
- [x] Verify header editing, column dragging, column removal, and the new resize target do not create overlapping click handlers.
- [x] Verify focus and caret survive ordinary property edits.

### Reader and responsive layout

- [x] Render static table `<colgroup>` elements from resolved properties.
- [x] Apply body and header alignment independently.
- [x] Apply per-column wrapping without changing default nowrap behavior.
- [x] Preserve automatic equal distribution for tables without authored widths.
- [x] Make over-wide tables scroll inside the document/emulated preview frame.
- [ ] Verify Full, Desktop, Tablet, and Phone preview widths.

### CLI and AI

- [x] Add `tableColumnProperties.json` to the CLI virtual filesystem.
- [x] Add component documentation and CLI help examples.
- [x] Update AI static-table guidance to use the property map rather than component CSS.
- [x] Add lint output for property keys that do not match a current column.
- [ ] Add AI/CLI tests using BEFORE, TOOL CALL, and AFTER structure.

### PDF and export

- [x] Specify fit-to-page behavior for mixed automatic and authored widths.
- [x] Map supported width units into PDF column widths.
- [x] Wrap content when a table must be fitted to a finite page.
- [ ] Add PDF tests for automatic, mixed-width, and over-wide tables.

### Regression coverage

- [x] Verify existing static tables serialize without the new field.
- [x] Verify drag resize persists a concrete width.
- [x] Verify auto-fit persists a measured width and reset removes it.
- [x] Verify an over-wide table scrolls without widening the document surface.
- [ ] Verify rename, reorder, add, remove, clone, undo, and redo preserve the intended map.
- [x] Verify duplicate labels receive shared presentation.
- [x] Verify search indexes column labels and cell values only once and does not index property-map scaffolding.
- [x] Run adjacent static-table, database-table, serialization, CLI, editor, responsive, and PDF tests.

## Explicit non-goals for the first pass

- Converting `tableColumns` into objects.
- Moving searchable labels or row values into presentation metadata.
- Selector-based per-column CSS.
- Determining whether an authored CSS width is subjectively too large.
- Adding compatibility aliases or fuzzy matching for column property keys.
- Supporting different presentation for duplicate column labels.
- Recreating the full Excel cell-format model, including arbitrary fills, borders, number formats, or fonts.
