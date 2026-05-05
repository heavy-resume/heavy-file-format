# Dynamic Table Cheatsheet

Use the `db-table` plugin when rows should come from a live data source instead of static table component rows. The current built-in backend is the attached SQL database, so start by creating tables or views with SQL.

Dynamic table components have two separate parts:

- `plugin.json` stores `pluginConfig.table`, which must be the name of an existing table or view in the current backend.
- `plugin.txt` stores optional read-only `SELECT` or `WITH` SQL for displaying rows. This SQL does not create tables or views.

Create or change tables and views:

```shell
hvy plugin db-table exec "CREATE TABLE chores (id INTEGER PRIMARY KEY, title TEXT NOT NULL, assigned_to TEXT, completed_at TEXT)"
hvy plugin db-table exec "CREATE VIEW weekly_chore_leaders AS SELECT assigned_to, COUNT(*) AS completed_count FROM chores WHERE completed_at >= datetime('now', '-7 days') GROUP BY assigned_to"
```

Inspect the current backend:

```shell
hvy plugin db-table tables
hvy plugin db-table schema chores
hvy plugin db-table query "SELECT * FROM chores"
```

Display rows in the document:

```shell
hvy add plugin db-table /chore-chart active-chores chores "SELECT title, assigned_to FROM chores WHERE completed_at IS NULL"
hvy add plugin db-table /chore-chart weekly-leaders weekly_chore_leaders "SELECT assigned_to, completed_count FROM weekly_chore_leaders"
```

Fix an existing DB Table component:

```shell
cat /body/chore-chart/active-chores/plugin.json
cat /body/chore-chart/active-chores/plugin.txt
hvy plugin db-table tables
hvy plugin db-table exec "CREATE VIEW active_chores AS SELECT title, assigned_to FROM chores WHERE completed_at IS NULL"
echo '{"id":"active-chores","css":"","plugin":"dev.heavy.db-table","pluginConfig":{"table":"active_chores"}}' > /body/chore-chart/active-chores/plugin.json
echo 'SELECT title, assigned_to FROM active_chores' > /body/chore-chart/active-chores/plugin.txt
hvy lint
```
