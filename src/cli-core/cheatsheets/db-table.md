# DB Table Cheatsheet

There is no separate database component to add. The document has an attached SQLite database; start using it with SQL.

Create or change tables and views:

```shell
hvy plugin db-table exec "CREATE TABLE chores (id INTEGER PRIMARY KEY, title TEXT NOT NULL, assigned_to TEXT, completed_at TEXT)"
hvy plugin db-table exec "CREATE VIEW weekly_chore_leaders AS SELECT assigned_to, COUNT(*) AS completed_count FROM chores WHERE completed_at >= datetime('now', '-7 days') GROUP BY assigned_to"
```

Inspect the database:

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
