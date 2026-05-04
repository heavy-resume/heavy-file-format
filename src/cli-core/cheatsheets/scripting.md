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

Use tool help for exact `doc.tool` call shapes:

```shell
man hvy plugin scripting tool
man hvy plugin scripting tool request_structure
man hvy plugin scripting tool grep
man hvy plugin scripting tool view_component
man hvy plugin scripting tool patch_component
man hvy plugin scripting tool create_component
man hvy plugin scripting tool remove_component
man hvy plugin scripting tool create_section
man hvy plugin scripting tool execute_sql
```

Common `doc.tool` examples:

```python
summary = doc.tool("request_structure", {})
hits = doc.tool("grep", {"query": "TODO", "flags": "i"})
component = doc.tool("view_component", {"component_ref": "C3"})
doc.tool("patch_component", {"component_ref": "C3", "edits": [{"op": "replace", "start_line": 2, "end_line": 2, "text": " New text"}]})
```

Form scripts also get:

```python
doc.form.get_value("field")
doc.form.set_value("field", "value")
doc.form.set_error("field", "Message")
```

Top-level `return` is a syntax error. Define helper functions if you need returns.
