# Dynamic Table Cheatsheet

Use the `db-table` plugin when rows should come from a live data source instead of static table component rows. The current built-in backend is the attached SQL database, so start by creating tables or views with SQL.

Dynamic table components have two separate parts:

- `plugin.json` stores `pluginConfig.table`, which must be the name of an existing table or view in the current backend.
- `plugin.txt` stores optional read-only `SELECT` or `WITH` SQL for displaying rows. This SQL does not create tables or views.

Create or change tables and views:

```shell
hvy plugin db-table exec "CREATE TABLE fake_widgets (id INTEGER PRIMARY KEY, label TEXT NOT NULL, zone TEXT, archived_at TEXT)"
hvy plugin db-table exec "CREATE VIEW fake_widget_zone_totals AS SELECT zone, COUNT(*) AS widget_count FROM fake_widgets WHERE archived_at IS NULL GROUP BY zone"
```

Inspect the current backend:

```shell
hvy plugin db-table tables
hvy plugin db-table schema fake_widgets
hvy plugin db-table schema
hvy plugin db-table query "SELECT * FROM fake_widgets"
```

Use `hvy plugin db-table tables` and `hvy plugin db-table schema` to inspect the current backend. Do not search the document for `CREATE TABLE`; that can find examples, recipes, scratchpad notes, or stale setup scripts instead of the live backend schema.

Display rows in the document:

```shell
hvy insert 0 plugin db-table /demo-area visible-widgets
echo '{"id":"visible-widgets","plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"fake_widgets","queryLimit":10}}' > /body/demo-area/visible-widgets/plugin.json
echo 'SELECT label, zone FROM fake_widgets WHERE archived_at IS NULL' > /body/demo-area/visible-widgets/plugin.txt
hvy insert -1 plugin db-table /demo-area widget-zone-totals
echo '{"id":"widget-zone-totals","plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"fake_widget_zone_totals","queryLimit":10}}' > /body/demo-area/widget-zone-totals/plugin.json
echo 'SELECT zone, widget_count FROM fake_widget_zone_totals' > /body/demo-area/widget-zone-totals/plugin.txt
```

Fix an existing DB Table component:

```shell
cat /body/demo-area/visible-widgets/plugin.json
cat /body/demo-area/visible-widgets/plugin.txt
hvy plugin db-table tables
hvy plugin db-table exec "CREATE VIEW fake_visible_widgets AS SELECT label, zone FROM fake_widgets WHERE archived_at IS NULL"
echo '{"id":"visible-widgets","css":"","plugin":"hvy.db-table","pluginConfig":{"table":"fake_visible_widgets"}}' > /body/demo-area/visible-widgets/plugin.json
echo 'SELECT label, zone FROM fake_visible_widgets' > /body/demo-area/visible-widgets/plugin.txt
hvy lint
```
