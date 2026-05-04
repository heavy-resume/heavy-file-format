# Forms Cheatsheet

Create a form:

```shell
hvy add plugin form /chore-chart add-chore "Add chore" "title:Title:text:required" "description:Description:textarea"
```

Field format:

```text
name:Label:type[:required][:option A|option B]
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
hvy add plugin form /chore-chart complete-chore "Complete chore" "chore_id:Chore:text:required" "completed_by:Completed by:select:required:Dad|Mom|Child" --script submit "chore = doc.form.get_value('chore_id')\nperson = doc.form.get_value('completed_by')\ndoc.db.execute('INSERT INTO completions (chore_id, completed_by, completed_at) VALUES (?, ?, datetime(''now''))', [chore, person])" --on-submit-script submit
```

Use `--script NAME PYTHON` to store a named script. Use `--on-submit-script NAME` to run it when the submit button is pressed.
