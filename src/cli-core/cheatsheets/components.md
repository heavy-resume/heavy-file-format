# Components Cheatsheet

Create a top-level section:

```shell
hvy insert 0 section / a-section "A Section"
```

Create builtin or custom components:

```shell
hvy insert 0 text /a-section intro
hvy insert -1 table /a-section a-table
hvy insert -1 xref-card /a-section a-reference
```

Creation only answers "what is it?" and "where is it?". After creation, edit the generated files:

```shell
echo "Visible text" > /body/a-section/intro/text.txt
echo '["Name","Status"]' > /body/a-section/a-table/tableColumns.json
echo '[{"cells":["Example","Active"]}]' > /body/a-section/a-table/tableRows.json
echo '{"id":"a-reference","xrefTitle":"Reference title","xrefTarget":"target-id"}' > /body/a-section/a-reference/xref-card.json
```

Insert into the middle of existing ordered children:

```shell
hvy insert 2 text /a-section middle-note
hvy insert -2 text /a-section before-last
```

Sort and group component-list items in reader views without changing canonical order:

```shell
cat /body/a-section/skills/skill-postgres/xref-card.json
cat /body/a-section/skills/component-list.json
```

Set item `sortKeys` on child component JSON, for example `{"Job Match":92,"Category":"Database"}`. Set `componentListViews` and `componentListDefaultView` on the component-list JSON. Grouped reader views create virtual collapsed containers only in the reader; `children-order.json` stays the canonical item order.

`hvy insert INDEX table` creates a blank static document table. Rows and columns are stored directly on the component in `tableColumns.json` and `tableRows.json`. Use `hvy insert INDEX plugin db-table` for dynamic data-backed rows.

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
