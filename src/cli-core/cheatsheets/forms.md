# Forms Cheatsheet

Create a form:

```shell
hvy insert 0 plugin form /demo-area widget-form
```

Then edit `widget-form/plugin.txt` for fields/scripts and `widget-form/plugin.json` for submit settings.

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
hvy insert 0 plugin form /demo-area widget-submit-form
echo '{"id":"widget-submit-form","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","submitLabel":"Store widget","showSubmit":true,"submitScript":"submit"}}' > /body/demo-area/widget-submit-form/plugin.json
```

Store fields and named scripts in `plugin.txt`. Use `pluginConfig.submitScript` in `plugin.json` to run a named script when the submit button is pressed.

Populate a select from the current SQL backend when the form renders:

```shell
hvy insert 0 plugin form /demo-area widget-choice-form
echo '{"id":"widget-choice-form","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","submitLabel":"Choose widget","showSubmit":true,"initialScript":"load","submitScript":"submit"}}' > /body/demo-area/widget-choice-form/plugin.json
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
    "submitLabel": "Choose widget",
    "initialScript": "load",
    "submitScript": "submit"
  }
}
```

Example `plugin.txt`:

```yaml
fields:
  - label: Widget
    type: select
    required: true
  - label: Widget zone
    type: select
    required: true
    options:
      - Zone A
      - Zone B
      - Zone C
scripts:
  load: |
    rows = doc.db.query("SELECT id, label FROM fake_widgets ORDER BY id")
    doc.form.set_options("Widget", [{"label": row["label"], "value": str(row["id"])} for row in rows])
  submit: |
    widget = doc.form.get_value("Widget")
    zone = doc.form.get_value("Widget zone")
```

Use `|` for script bodies in `plugin.txt`. Do not use `>` or `>-` for Python scripts; folded YAML can collapse newlines and break indentation.
