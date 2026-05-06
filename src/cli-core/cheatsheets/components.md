# Components Cheatsheet

Create a top-level section:

```shell
hvy insert 0 section / a-section "A Section"
```

Create builtin or custom components:

```shell
hvy insert 0 text /a-section intro "Visible text"
hvy insert -1 table /a-section a-table "Name,Status" --row "Example,Active"
hvy insert -1 xref-card /a-section a-reference "Reference title" --config '{"xrefTarget":"target-id"}'
```

Insert into the middle of existing ordered children:

```shell
hvy insert 2 text /a-section middle-note "Inserted before the current third child"
hvy insert -2 text /a-section before-last "Inserted before the current last child"
```

`hvy insert INDEX table` creates a static document table: rows and columns are stored directly on the component. Use `hvy insert INDEX plugin db-table` for dynamic data-backed rows.

Inspect before editing:

```shell
hvy request_structure --collapse
hvy request_structure COMPONENT_ID --describe
hvy preview /body/a-section/a-component
cat /body/a-section/a-component/component.txt
cat /body/a-section/a-component/component.json
```

Remove whole components or sections:

```shell
hvy remove /body/a-section/a-component
hvy remove /body/a-section/a-component --prune-xref
hvy prune-xref target-id
```
