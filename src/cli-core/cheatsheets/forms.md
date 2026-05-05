# Forms Cheatsheet

Create a form:

```shell
hvy add plugin form /chore-chart add-chore "Add chore" "Title:text:required" "Description:textarea"
```

Field format:

```text
Label:type[:required][:option A|option B]
```

Common field types:

```text
text
textarea
select
datetime
```

Create a form with submit logic:

```shell
hvy add plugin form /chore-chart complete-chore "Complete chore" "Chore:text:required" "Completed by:select:required:Dad|Mom|Child" --script submit "chore = doc.form.get_value('Chore')\nperson = doc.form.get_value('Completed by')\ndoc.db.execute('INSERT INTO completions (chore_id, completed_by, completed_at) VALUES (?, ?, datetime(''now''))', [chore, person])" --on-submit-script submit
```

Use `--script NAME PYTHON` to store a named script. Use `--on-submit-script NAME` to run it when the submit button is pressed.

Populate a select from the current SQL backend when the form renders:

```shell
hvy add plugin form /chore-chart assign-chore "Assign chore" "Chore:select:required" "Assigned to:select:required:Dad|Mom|Child" --script load "rows = doc.db.query('SELECT id, title FROM chores ORDER BY id')\ndoc.form.set_options('Chore', [{'label': row['title'], 'value': str(row['id'])} for row in rows])" --initial-script load
```

There is no `optionsQuery` YAML key. Dynamic select/radio options are set from scripts with `doc.form.set_options(label, options)`.

When editing an existing form, keep the split clear:

- `plugin.json` stores form-level behavior in `pluginConfig`.
- `plugin.txt` stores fields and named script bodies.

Example `plugin.json`:

```json
{
  "plugin": "dev.heavy.form",
  "pluginConfig": {
    "version": "0.1",
    "submitLabel": "Assign chore",
    "initialScript": "load",
    "submitScript": "submit"
  }
}
```

Example `plugin.txt`:

```yaml
fields:
  - label: Chore
    type: select
    required: true
  - label: Assigned to
    type: select
    required: true
    options:
      - Dad
      - Mom
      - Child
scripts:
  load: >-
    rows = doc.db.query("SELECT id, title FROM chores ORDER BY id")
    doc.form.set_options("Chore", [{"label": row["title"], "value": str(row["id"])} for row in rows])
  submit: >-
    chore = doc.form.get_value("Chore")
    person = doc.form.get_value("Assigned to")
```
