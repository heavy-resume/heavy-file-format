# Components Cheatsheet

Create a top-level section:

```shell
hvy add section / my-section "My Section"
```

Create builtin or custom components:

```shell
hvy add text /my-section intro "Visible text"
hvy add table /my-section table-id "Name,Status" --row "Dishes,Active"
hvy add skill-record /body/skills/component-list-1/component-list --id skill-new "New Skill"
```

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
hvy remove /body/tools-technologies/tool-typescript --prune-xref
hvy prune-xref tool-typescript
```
