# Scripting Cheatsheet

Create a scripting plugin:

```shell
hvy add plugin /my-section setup dev.heavy.scripting --config "{\"version\":\"0.1\"}" --body "doc.header.set('status', 'ready')"
```

Scripts are sandboxed Brython/Python with one injected global:

```python
doc
```

Useful APIs:

```python
doc.header.get("key")
doc.header.set("key", "value")
doc.db.query("SELECT * FROM chores")
doc.db.execute("INSERT INTO chores (title) VALUES (?)", ["Dishes"])
doc.tool("request_structure", {})
```

Form scripts also get:

```python
doc.form.get_value("field")
doc.form.set_value("field", "value")
doc.form.set_error("field", "Message")
```

Top-level `return` is a syntax error. Define helper functions if you need returns.
