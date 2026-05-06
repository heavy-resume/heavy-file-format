# Dynamic Table Cheatsheet

Use the `db-table` plugin when rows should come from a live data source instead of static table component rows. The current built-in backend is the attached SQL database, so start by creating tables or views with SQL.

Dynamic table components have two separate parts:

- `plugin.json` stores `pluginConfig.table`, which must be the name of an existing table or view in the current backend.
- `plugin.txt` stores optional read-only `SELECT` or `WITH` SQL for displaying rows. This SQL does not create tables or views.

Create or change tables and views:

```shell
hvy plugin db-table exec "CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT NOT NULL, assigned_to TEXT, completed_at TEXT)"
hvy plugin db-table exec "CREATE VIEW weekly_item_leaders AS SELECT assigned_to, COUNT(*) AS completed_count FROM items WHERE completed_at >= datetime('now', '-7 days') GROUP BY assigned_to"
```

Inspect the current backend:

```shell
hvy plugin db-table tables
hvy plugin db-table schema items
hvy plugin db-table schema
hvy plugin db-table query "SELECT * FROM items"
```

Use `hvy plugin db-table tables` and `hvy plugin db-table schema` to inspect the current backend. Do not search the document for `CREATE TABLE`; that can find examples, recipes, scratchpad notes, or stale setup scripts instead of the live backend schema.

Display rows in the document:

```shell
hvy insert 0 plugin db-table /a-section active-items items "SELECT title, assigned_to FROM items WHERE completed_at IS NULL"
hvy insert -1 plugin db-table /a-section weekly-leaders weekly_item_leaders "SELECT assigned_to, completed_count FROM weekly_item_leaders"
```

Fix an existing DB Table component:

```shell
cat /body/a-section/active-items/plugin.json
cat /body/a-section/active-items/plugin.txt
hvy plugin db-table tables
hvy plugin db-table exec "CREATE VIEW active_items AS SELECT title, assigned_to FROM items WHERE completed_at IS NULL"
echo '{"id":"active-items","css":"","plugin":"dev.heavy.db-table","pluginConfig":{"table":"active_items"}}' > /body/a-section/active-items/plugin.json
echo 'SELECT title, assigned_to FROM active_items' > /body/a-section/active-items/plugin.txt
hvy lint
```
