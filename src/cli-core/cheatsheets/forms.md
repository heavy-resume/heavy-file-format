# Forms Cheatsheet

Create a form:

```shell
hvy insert 0 plugin form /a-section add-item
```

Then edit `add-item/plugin.txt` for fields/scripts and `add-item/plugin.json` for submit settings.

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
hvy insert 0 plugin form /a-section complete-item
echo '{"id":"complete-item","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","submitLabel":"Complete item","showSubmit":true,"submitScript":"submit"}}' > /body/a-section/complete-item/plugin.json
```

Store fields and named scripts in `plugin.txt`. Use `pluginConfig.submitScript` in `plugin.json` to run a named script when the submit button is pressed.

Populate a select from the current SQL backend when the form renders:

```shell
hvy insert 0 plugin form /a-section choose-item
echo '{"id":"choose-item","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","submitLabel":"Choose item","showSubmit":true,"initialScript":"load","submitScript":"submit"}}' > /body/a-section/choose-item/plugin.json
```

There is no `optionsQuery` YAML key. Dynamic select/radio options are set from scripts with `doc.form.set_options(label, options)`.

For a focused example, run:

```shell
hvy recipe populate-form-options-from-db
```

`doc.form.set_options` prefers option objects shaped as `{"label": "Visible text", "value": "stored-value"}`.

When editing an existing form, keep the split clear:

- `plugin.json` stores form-level behavior in `pluginConfig`.
- `plugin.txt` stores fields and named script bodies.

Example `plugin.json`:

```json
{
  "plugin": "dev.heavy.form",
  "pluginConfig": {
    "version": "0.1",
    "submitLabel": "Choose item",
    "initialScript": "load",
    "submitScript": "submit"
  }
}
```

Example `plugin.txt`:

```yaml
fields:
  - label: Item
    type: select
    required: true
  - label: Assigned to
    type: select
    required: true
    options:
      - Person A
      - Person B
      - Person C
scripts:
  load: |
    rows = doc.db.query("SELECT id, title FROM items ORDER BY id")
    doc.form.set_options("Item", [{"label": row["title"], "value": str(row["id"])} for row in rows])
  submit: |
    item = doc.form.get_value("Item")
    person = doc.form.get_value("Assigned to")
```

Use `|` for script bodies in `plugin.txt`. Do not use `>` or `>-` for Python scripts; folded YAML can collapse newlines and break indentation.
