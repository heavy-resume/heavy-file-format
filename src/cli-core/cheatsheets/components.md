# Components Cheatsheet

Create a top-level section:

```shell
hvy insert 0 section / my-section "My Section"
```

Create builtin or custom components:

```shell
hvy insert 0 text /my-section intro "Visible text"
hvy insert -1 table /my-section table-id "Name,Status" --row "Dishes,Active"
hvy insert 0 skill-record /body/skills/component-list-1 --id skill-new "New Skill"
```

Insert into the middle of existing ordered children:

```shell
hvy insert 2 text /my-section middle-note "Inserted before the current third child"
hvy insert -2 skill-record /body/skills/component-list-1 --id skill-before-last "Before Last"
```

`hvy insert INDEX table` creates a static document table: rows and columns are stored directly on the component. Use `hvy insert INDEX plugin db-table` for dynamic data-backed rows.

Inspect before editing:

```shell
hvy request_structure --collapse
hvy request_structure COMPONENT_ID --describe
hvy preview /body/section/component-id
cat /body/section/component-id/component.txt
cat /body/section/component-id/component.json
```

Remove whole components or sections:

```shell
hvy remove /body/section/component-id
hvy remove /body/tools-technologies/component-list-1/tool-typescript --prune-xref
hvy prune-xref tool-typescript
```
