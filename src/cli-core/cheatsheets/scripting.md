# Scripting Cheatsheet

Create a scripting plugin:

```shell
hvy insert 0 plugin /demo-area widget-script dev.hvy.scripting
echo "doc.header.set('fake_widget_status', 'ready')" > /body/demo-area/widget-script/script.py
```

Scripts are sandboxed Brython/Python with one injected global:

```python
doc
```

Useful APIs:

```python
doc.header.get("key")
doc.header.set("key", "value")
doc.db.query("SELECT * FROM fake_widgets")
doc.db.execute("INSERT INTO fake_widgets (label) VALUES (?)", ["Orbital Widget"])
doc.cli.run("hvy request_structure --collapse")
doc.cli.write("/id/example/text.txt", "Updated text")
doc.tool.request_structure()
```

`doc.cli.run(COMMAND)` runs one synchronous virtual CLI command and returns stdout. It supports document/file commands such as `hvy insert`, `hvy remove`, `hvy request_structure`, `cat`, `rg`, `find`, and `sed`. It does not run pipes, shell chains, redirection, `ask`, `done`, or db-table SQL commands; use `doc.db.query` and `doc.db.execute` for SQL.

`doc.cli.write(PATH, CONTENT)` replaces one writable non-raw virtual file, such as generated component `.json`, `.css`, `.txt`, and table data files. It intentionally refuses `raw.hvy`; use structured CLI commands for component creation and removal.

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
summary = doc.tool.request_structure()
hits = doc.tool.grep(query="TODO", flags="i")
component = doc.tool.view_component(component_ref="C3")
doc.tool.patch_component(component_ref="C3", edits=[{"op": "replace", "start_line": 2, "end_line": 2, "text": " New text"}])
```

Form scripts also get:

```python
doc.form.get_value("Field label")
doc.form.set_value("Field label", "value")
doc.form.set_error("Field label", "Message")
```

Scripts are wrapped in a generated function before Brython runs them, so `return` can stop a script early.
