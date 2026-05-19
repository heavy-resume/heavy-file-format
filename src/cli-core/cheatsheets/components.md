# Components Cheatsheet

Component directives store metadata as JSON on the `hvy:` comment. Individual `css` metadata values are still plain inline CSS declaration strings, not nested JSON:

```markdown
<!--hvy:COMPONENT_NAME {"id":"example","css":"margin: 0;"}-->
TEXT_DATA (optional)
```

Create a top-level section:

```shell
hvy insert 0 section /body demo-area "Demo Area"
```

Create builtin or custom components:

```shell
hvy insert 0 text /demo-area intro-blurb
hvy insert -1 table /demo-area sample-grid
hvy insert -1 xref-card /demo-area pointer-card
```

Creation only answers "what is it?" and "where is it?". After creation, edit the generated files:

```shell
echo "Example visible text" > /body/demo-area/intro-blurb/text.txt
echo '["Widget","State"]' > /body/demo-area/sample-grid/tableColumns.json
echo '[{"cells":["Alpha widget","Ready"]}]' > /body/demo-area/sample-grid/tableRows.json
echo '{"id":"pointer-card","xrefTitle":"Example pointer","xrefTarget":"target-widget"}' > /body/demo-area/pointer-card/xref-card.json
```

Insert into the middle of existing ordered children:

```shell
hvy insert 2 text /demo-area middle-note
hvy insert -2 text /demo-area before-last-note
```

Sort and group component-list items in the reader without changing source order:

```shell
cat /body/demo-area/widget-list/widget-alpha/xref-card.json
cat /body/demo-area/widget-list/component-list.json
```

Set item `sortKeys` on child component JSON for sorting, for example `{"Example Rank":92}`. Set item `groupKeys` for grouping, for example `{"Example Group":"Blue"}`. Set `componentListDefaultSortKey`, `componentListDefaultSortDirection`, and `componentListDefaultGroupKey` on the component-list JSON. Grouped reader display creates virtual collapsed containers only in the reader; `children-order.json` stays the source item order.

`hvy insert INDEX table` creates a blank static document table. Rows and columns are stored directly on the component in `tableColumns.json` and `tableRows.json`. Use `hvy insert INDEX plugin db-table` for dynamic data-backed rows.

Inspect before editing:

```shell
hvy request_structure --collapse
hvy request_structure COMPONENT_ID --describe
hvy preview /body/demo-area/example-component
cat /body/demo-area/example-component/component.txt
cat /body/demo-area/example-component/component.json
```

Remove whole components or sections:

```shell
hvy remove /body/demo-area/example-component
hvy remove /body/demo-area/example-component --prune-xref
hvy prune-xref target-id
```
