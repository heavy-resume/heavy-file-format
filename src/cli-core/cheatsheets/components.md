# Components Cheatsheet

Create a top-level section:

```shell
hvy append-child section / my-section "My Section"
```

Create builtin or custom components:

```shell
hvy append-child text /my-section intro "Visible text"
hvy append-child table /my-section table-id "Name,Status" --row "Dishes,Active"
hvy append-child skill-record /body/skills/component-list-1 --id skill-new "New Skill"
```

`hvy append-child table` creates a static document table: rows and columns are stored directly on the component. Use `hvy append-child plugin db-table` for dynamic data-backed rows.

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
