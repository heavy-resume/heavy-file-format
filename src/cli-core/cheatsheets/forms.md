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
