import { expect, test, type Page } from '@playwright/test';

const PLUGIN_SETTLE_TIMEOUT_MS = 1_000;
const SCRIPTING_IDLE_TIMEOUT_MS = 1_000;

async function runCliCommand(page: Page, command: string): Promise<void> {
  const lineCount = await page.locator('#cliOutput .cli-line').count();
  const isPlaceholder = (await page.locator('#cliOutput').textContent())?.includes('/ $ man ls') ?? false;
  await page.locator('#cliInput').fill(command);
  await page.keyboard.press('Enter');
  await expect(page.locator('#cliOutput .cli-line')).toHaveCount(isPlaceholder ? lineCount : lineCount + 1);
  await expect(page.locator('#cliOutput .cli-line').last()).toContainText(command.split(/\s+/).slice(0, 4).join(' '));
}

function scriptArg(source: string): string {
  return source.trim().replace(/\n/g, '\n    ');
}

function writeFileCommand(path: string, content: string): string {
  return `echo ${JSON.stringify(content.trimEnd().replace(/\n/g, '\\n'))} > ${path}`;
}

async function waitForScriptingIdle(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const scripting = (window as unknown as { __HVY_SCRIPTING__?: { runtimes: Record<string, unknown> } }).__HVY_SCRIPTING__;
    return Boolean(scripting) && Object.keys(scripting.runtimes).length === 0;
  }, undefined, { timeout: SCRIPTING_IDLE_TIMEOUT_MS });
}

async function waitForDocumentMeta(page: Page, key: string, expectedValue: string): Promise<void> {
  await expect.poll(() => page.evaluate(async (metaKey) => {
    const { state } = await import(/* @vite-ignore */ '/src/state.ts');
    return state.document.meta[metaKey];
  }, key), { timeout: SCRIPTING_IDLE_TIMEOUT_MS }).toBe(expectedValue);
}

test('cli-created chore chart form and db-table plugins run end to end', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'CLI' }).click();

  const setupChoreDb = scriptArg(`
doc.db.execute('CREATE TABLE IF NOT EXISTS chores (id INTEGER PRIMARY KEY, description TEXT NOT NULL, assigned_to TEXT, active INTEGER NOT NULL DEFAULT 1)')
doc.db.execute('CREATE TABLE IF NOT EXISTS chore_completions (id INTEGER PRIMARY KEY, chore_description TEXT, completed_by TEXT, completed_at TEXT DEFAULT CURRENT_TIMESTAMP)')
doc.db.execute('DROP VIEW IF EXISTS active_chore_chart')
doc.db.execute('''CREATE VIEW active_chore_chart AS SELECT description AS Chore, CASE WHEN assigned_to = 'Dad' THEN 'assigned' ELSE '' END AS Dad, CASE WHEN assigned_to = 'Mom' THEN 'assigned' ELSE '' END AS Mom, CASE WHEN assigned_to = 'Child' THEN 'assigned' ELSE '' END AS Child FROM chores WHERE active = 1 ORDER BY id''')
doc.db.execute('DROP VIEW IF EXISTS weekly_chore_leaders')
doc.db.execute('''CREATE VIEW weekly_chore_leaders AS SELECT completed_by AS Person, COUNT(*) AS Completed FROM chore_completions WHERE completed_at >= datetime('now', '-7 days') GROUP BY completed_by ORDER BY Completed DESC''')
description = doc.form.get_value('Description')
doc.db.execute('INSERT INTO chores (description, active) VALUES (\\'' + description + '\\', 1)')
`);
  const assignChore = scriptArg(`
chore = doc.form.get_value('Chore')
assignee = doc.form.get_value('Assignee')
doc.db.execute('UPDATE chores SET assigned_to = \\'' + assignee + '\\' WHERE description = \\'' + chore + '\\'')
`);
  const completeChore = scriptArg(`
chore = doc.form.get_value('Chore')
person = doc.form.get_value('Completed by')
doc.db.execute('INSERT INTO chore_completions (chore_description, completed_by) VALUES (\\'' + chore + '\\', \\'' + person + '\\')')
doc.db.execute('UPDATE chores SET active = 0 WHERE description = \\'' + chore + '\\'')
`);

  await runCliCommand(page, 'hvy insert 0 section /body chore-chart "Chore Chart"');
  await runCliCommand(page, 'hvy insert 0 plugin db-table /chore-chart active-chore-chart');
  await runCliCommand(page, writeFileCommand('/chore-chart/active-chore-chart/plugin.json', '{"id":"active-chore-chart","plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"active_chore_chart","queryLimit":10}}'));
  await runCliCommand(page, writeFileCommand('/chore-chart/active-chore-chart/plugin.txt', 'SELECT Chore, Dad, Mom, Child FROM active_chore_chart'));
  await runCliCommand(page, 'hvy insert -1 plugin db-table /chore-chart weekly-leaders');
  await runCliCommand(page, writeFileCommand('/chore-chart/weekly-leaders/plugin.json', '{"id":"weekly-leaders","plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"weekly_chore_leaders","queryLimit":10}}'));
  await runCliCommand(page, writeFileCommand('/chore-chart/weekly-leaders/plugin.txt', 'SELECT Person, Completed FROM weekly_chore_leaders'));
  await runCliCommand(page, 'hvy insert 0 plugin form /chore-chart add-chore-form');
  await runCliCommand(page, writeFileCommand('/chore-chart/add-chore-form/plugin.json', '{"id":"add-chore-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitLabel":"Add chore","showSubmit":true,"submitScript":"submit"}}'));
  await runCliCommand(page, writeFileCommand('/chore-chart/add-chore-form/plugin.txt', `fields:
  - label: Description
    type: textarea
    required: true
scripts:
  submit: |
    ${setupChoreDb}`));
  await runCliCommand(page, 'hvy insert -1 plugin form /chore-chart assign-chore-form');
  await runCliCommand(page, writeFileCommand('/chore-chart/assign-chore-form/plugin.json', '{"id":"assign-chore-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitLabel":"Assign chore","showSubmit":true,"submitScript":"submit"}}'));
  await runCliCommand(page, writeFileCommand('/chore-chart/assign-chore-form/plugin.txt', `fields:
  - label: Chore
    type: text
    required: true
  - label: Assignee
    type: select
    required: true
    options:
      - Dad
      - Mom
      - Child
scripts:
  submit: |
    ${assignChore}`));
  await runCliCommand(page, 'hvy insert -1 plugin form /chore-chart complete-chore-form');
  await runCliCommand(page, writeFileCommand('/chore-chart/complete-chore-form/plugin.json', '{"id":"complete-chore-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitLabel":"Complete chore","showSubmit":true,"submitScript":"submit"}}'));
  await runCliCommand(page, writeFileCommand('/chore-chart/complete-chore-form/plugin.txt', `fields:
  - label: Chore
    type: text
    required: true
  - label: Completed by
    type: select
    required: true
    options:
      - Dad
      - Mom
      - Child
scripts:
  submit: |
    ${completeChore}`));

  await page.getByRole('button', { name: 'Viewer' }).click();

  const addForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add chore' }) });
  await addForm.locator('textarea[name="Description"]').fill('Dishes');
  await addForm.getByRole('button', { name: 'Add chore' }).click();
  await expect(page.locator('.hvy-db-table-plugin-reader').filter({ hasText: 'Dishes' })).toBeVisible({
    timeout: PLUGIN_SETTLE_TIMEOUT_MS,
  });

  const assignForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Assign chore' }) });
  await assignForm.locator('input[name="Chore"]').fill('Dishes');
  await assignForm.locator('select[name="Assignee"]').selectOption('Child');
  await assignForm.getByRole('button', { name: 'Assign chore' }).click();
  await expect(page.locator('.hvy-db-table-plugin-reader').filter({ hasText: 'assigned' })).toBeVisible();

  const completeForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Complete chore' }) });
  await completeForm.locator('input[name="Chore"]').fill('Dishes');
  await completeForm.locator('select[name="Completed by"]').selectOption('Child');
  await completeForm.getByRole('button', { name: 'Complete chore' }).click();

  const weeklyLeaders = page.locator('#weekly-leaders .hvy-db-table-plugin-reader');
  await expect(weeklyLeaders).toContainText('Child');
  await expect(weeklyLeaders).toContainText('1');
});

test('scripting globals do not expose browser globals or wrapper internals', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"sandbox"}-->
#! Sandbox

<!--hvy:plugin {"id":"globals-check","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
forbidden = [
    "window",
    "document",
    "browser",
    "__BRYTHON__",
    "__hvy_window__",
    "__hvy_globals__",
    "__hvy_runtime__",
    "__hvy_source__",
    "__hvy_instrumented_source__",
    "__hvy_builtin_import__",
    "__hvy_user_globals__",
    "__hvy_user_main__",
]
names = globals()
globals_leaked = [name for name in forbidden if name in names]
direct_leaked = []
for name in forbidden:
    try:
        eval(name)
        direct_leaked.append(name)
    except Exception:
        pass
doc.header.set("sandbox_globals", ",".join(globals_leaked) or "clean")
doc.header.set("sandbox_direct", ",".join(direct_leaked) or "clean")
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();
  await waitForScriptingIdle(page);

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.locator('#rawEditor')).toContainText('sandbox_globals: clean');
  await expect(page.locator('#rawEditor')).toContainText('sandbox_direct: clean');
});

test('scripting sandbox blocks dynamic imports eval globals and frame escapes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"sandbox"}-->
#! Sandbox

<!--hvy:plugin {"id":"dynamic-check","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
results = []

def record(label, action):
    try:
        action()
        results.append(label + ":leaked")
    except BaseException:
        results.append(label + ":blocked")

record("direct_import", lambda: __import__("browser"))
record("eval_import", lambda: eval("__import__('browser')"))
record("builtins_import", lambda: eval("__builtins__")["__import__"]("browser"))
record("builtin_import", lambda: __hvy_builtin_import__("browser"))
record("eval_builtin_import", lambda: eval("__hvy_builtin_import__('browser')"))
record("frame_import", lambda: eval("__import__('sys')._getframe(1).f_globals.get('__hvy_window__')"))
record("custom_eval_globals", lambda: eval("window", {"window": "leaked"}))

doc.header.set("sandbox_dynamic", ",".join(results))
`);
  const expectedResult = 'direct_import:blocked,eval_import:blocked,builtins_import:blocked,builtin_import:blocked,eval_builtin_import:blocked,frame_import:blocked,custom_eval_globals:blocked';
  await page.getByRole('button', { name: 'Apply' }).click();
  await waitForDocumentMeta(page, 'sandbox_dynamic', expectedResult);

  const expectedState = await page.evaluate(async () => {
    const { state } = await import(/* @vite-ignore */ '/src/state.ts');
    return {
      sandboxDynamic: state.document.meta.sandbox_dynamic,
    };
  });
  expect(expectedState).toEqual({
    sandboxDynamic: expectedResult,
  });
});

test('scripting supports standard attribute lookup detection assignment and deletion', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"attribute-sandbox"}-->
#! Attribute Sandbox

<!--hvy:plugin {"id":"attribute-check","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
class Example:
    pass

item = Example()
setattr(item, "answer", 42)
assigned = getattr(item, "answer")
detected_before = hasattr(item, "answer")
delattr(item, "answer")
detected_after = hasattr(item, "answer")

doc.header.set("attribute_builtins", f"{assigned}|{detected_before}|{detected_after}")
`);
  const expectedResult = '42|True|False';
  await page.getByRole('button', { name: 'Apply' }).click();
  await waitForDocumentMeta(page, 'attribute_builtins', expectedResult);

  const expectedState = await page.evaluate(async () => {
    const { state } = await import(/* @vite-ignore */ '/src/state.ts');
    return state.document.meta.attribute_builtins;
  });
  expect(expectedState).toBe(expectedResult);
});

test('attribute builtins do not reach restricted browser capabilities', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"attribute-capability-sandbox"}-->
#! Attribute Capability Sandbox

<!--hvy:plugin {"id":"attribute-capability-check","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
results = []

def record_restricted_capability(label, action):
    try:
        action()
        results.append(label + ":reached")
    except BaseException:
        results.append(label + ":blocked")

def browser_global(name):
    js_doc = getattr(doc, "_HvyDocProxy__js_doc")
    constructor = getattr(getattr(js_doc, "constructor"), "constructor")
    return constructor("return " + name)()

def wrapper_global(name):
    bound_method = getattr(doc, "__getattr__")
    function = getattr(bound_method, "__func__")
    return getattr(function, "__globals__")[name]

def hidden_doc_from_instance_dict():
    instance_attributes = getattr(doc, "__dict__")
    return instance_attributes["_HvyDocProxy__js_doc"]

record_restricted_capability("direct_window", lambda: getattr(doc, "window"))
record_restricted_capability("direct_document", lambda: getattr(doc, "document"))
record_restricted_capability("window", lambda: browser_global("window"))
record_restricted_capability("document", lambda: browser_global("document"))
record_restricted_capability("scripting_runtime", lambda: browser_global("window.__HVY_SCRIPTING__"))
record_restricted_capability("brython_runtime", lambda: browser_global("window.__BRYTHON__"))
record_restricted_capability("hidden_js_doc", lambda: getattr(doc, "_HvyDocProxy__js_doc"))
record_restricted_capability("instance_dict_js_doc", hidden_doc_from_instance_dict)
record_restricted_capability("wrapper_window", lambda: getattr(wrapper_global("__hvy_window__"), "document"))
record_restricted_capability("wrapper_runtime", lambda: getattr(wrapper_global("__hvy_window__"), "__HVY_SCRIPTING__"))
record_restricted_capability("browser_import", lambda: __builtins__["__import__"]("browser"))

doc.header.set("attribute_capabilities", ",".join(results))
`);
  const expectedResult = 'direct_window:blocked,direct_document:blocked,window:blocked,document:blocked,scripting_runtime:blocked,brython_runtime:blocked,hidden_js_doc:blocked,instance_dict_js_doc:blocked,wrapper_window:blocked,wrapper_runtime:blocked,browser_import:blocked';
  await page.getByRole('button', { name: 'Apply' }).click();
  await waitForDocumentMeta(page, 'attribute_capabilities', expectedResult);
});

test('scripting checked regex library runs without Brython native re import', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"regex"}-->
#! Regex

<!--hvy:plugin {"id":"regex-check","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1","libraries":["re"]}}-->
import re
from re import search as find, sub

match = re.search(r"Order\\s+(\\d+)", "Order 42")
compiled = re.compile(r"item-(\\d+)", re.I)
found = compiled.findall("ITEM-1 item-2")
clean = sub(r"\\s+", "-", "a b  c")
direct = find(r"b+", "abbbc").group(0)
doc.header.set("regex_result", f"{match.group(1)}|{','.join(found)}|{clean}|{direct}|{match.span(0)[0]}-{match.span(0)[1]}")
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await waitForDocumentMeta(page, 'regex_result', '42|1,2|a-b-c|bbb|0-8');
});

test('scripting checked datetime library supports safe calendar arithmetic and ISO weeks', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"datetime"}-->
#! Datetime

<!--hvy:plugin {"id":"datetime-check","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1","libraries":["datetime"]}}-->
from datetime import datetime, timedelta

value = datetime.strptime("2021-01-03 23:59:58.123456", "%Y-%m-%d %H:%M:%S.%f")
monday_year, monday_week, _ = value.isocalendar()
adjusted = value + timedelta(days=1)
sunday_year, sunday_week, _ = adjusted.isocalendar()
monday = adjusted - timedelta(days=adjusted.weekday())
week_start = monday - timedelta(days=1)
leap = datetime(2024, 2, 28) + timedelta(days=1, hours=2)
rolled = datetime(2026, 12, 31, 23, 59, 59, 999999) + timedelta(microseconds=1)
elapsed = rolled - datetime(2026, 12, 31, 23, 59, 59, 999999)
parsed = datetime.fromisoformat("2026-07-21T10:11:12.345")

invalid = "missed"
try:
    datetime(2025, 2, 29)
except ValueError:
    invalid = "blocked"

doc.header.set("datetime_result", f"{monday_year}-W{monday_week:02d}|{sunday_year}-W{sunday_week:02d}|{week_start.date().isoformat()}|{leap.isoformat()}|{rolled.isoformat()}|{elapsed.total_seconds()}|{parsed.strftime('%Y/%m/%d %H:%M:%S.%f')}|{invalid}|{timedelta(microseconds=-1).days}|{parsed}|{timedelta(microseconds=-1)}")
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await waitForDocumentMeta(
    page,
    'datetime_result',
    '2020-W53|2021-W01|2021-01-03|2024-02-29T02:00:00|2027-01-01T00:00:00|1e-06|2026/07/21 10:11:12.345000|blocked|-1|2026-07-21 10:11:12.345000|-1 day, 23:59:59.999999'
  );
});

test('scripting checked datetime library does not expose runtime capabilities', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"datetime-sandbox"}-->
#! Datetime Sandbox

<!--hvy:plugin {"id":"datetime-sandbox-check","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1","libraries":["datetime"]}}-->
import datetime

results = []

def record(label, action):
    try:
        action()
        results.append(label + ":leaked")
    except BaseException:
        results.append(label + ":blocked")

record("window", lambda: datetime.window)
record("browser", lambda: datetime.browser)
record("globals", lambda: datetime.datetime.__init__.__globals__)
record("unchecked_time", lambda: __builtins__["__import__"]("time"))
doc.header.set("datetime_sandbox", ",".join(results))
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await waitForDocumentMeta(page, 'datetime_sandbox', 'window:blocked,browser:blocked,globals:blocked,unchecked_time:blocked');
});

test('scripting checked regex library does not expose Brython re dependency modules', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"regex-sandbox"}-->
#! Regex Sandbox

<!--hvy:plugin {"id":"regex-sandbox-check","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1","libraries":["re"]}}-->
import re

results = []

def record(label, action):
    try:
        action()
        results.append(label + ":leaked")
    except BaseException:
        results.append(label + ":blocked")

record("re_python_re", lambda: re.python_re)
record("re_enum", lambda: re.enum)
try:
    from re import python_re
    results.append("from_python_re:leaked")
except BaseException:
    results.append("from_python_re:blocked")
try:
    from re import enum
    results.append("from_enum:leaked")
except BaseException:
    results.append("from_enum:blocked")
record("builtin_re_python_re", lambda: __builtins__["__import__"]("re").python_re)
record("builtin_python_re", lambda: __builtins__["__import__"]("python_re"))

doc.header.set("regex_dependency_modules", ",".join(results))
`);
  const expectedResult = 're_python_re:blocked,re_enum:blocked,from_python_re:blocked,from_enum:blocked,builtin_re_python_re:blocked,builtin_python_re:blocked';
  await page.getByRole('button', { name: 'Apply' }).click();
  await waitForDocumentMeta(page, 'regex_dependency_modules', expectedResult);
});

test('visibleScript uses the shared scripting sandbox', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"visibility"}-->
#! Visibility

<!--hvy:text {"id":"safe-visible","visibleScript":"return len('ok') == 2"}-->
Safe visible text

<!--hvy:text {"id":"blocked-visible","visibleScript":"try:\\n    __import__('browser')\\n    return True\\nexcept Exception:\\n    return False"}-->
Blocked visible text
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await expect(page.locator('[data-component-id="safe-visible"]').first()).toBeVisible({
    timeout: SCRIPTING_IDLE_TIMEOUT_MS,
  });
  await expect(page.locator('[data-component-id="blocked-visible"]').first()).toBeHidden({
    timeout: SCRIPTING_IDLE_TIMEOUT_MS,
  });
});

test('scripting and form scripts allow return to stop execution', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"return-check"}-->
#! Return Check

<!--hvy:plugin {"id":"startup-script","plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
doc.header.set("script_return", "before")
return
doc.header.set("script_return", "after")

<!--hvy:plugin {"id":"return-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitLabel":"Submit","submitScript":"submit"}}-->
fields:
  - label: Value
    type: text
scripts:
  submit: |-
    doc.header.set("form_return", doc.form.get_value("Value"))
    return
    doc.header.set("form_return", "after")
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();
  await waitForScriptingIdle(page);

  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Submit' }) });
  await form.locator('input[name="Value"]').fill('before');
  await form.getByRole('button', { name: 'Submit' }).click();

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('script_return: before');
  await expect(page.locator('#rawEditor')).toContainText('form_return: before');
  await expect(page.locator('#rawEditor')).not.toContainText('script_return: after');
  await expect(page.locator('#rawEditor')).not.toContainText('form_return: after');
});

test('form initial scripts accept tuple-shaped dynamic options', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"tuple-options"}-->
#! Tuple Options

<!--hvy:plugin {"id":"tuple-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitLabel":"Submit","initialScript":"load"}}-->
fields:
  - label: Choice
    type: select
scripts:
  load: |-
    doc.form.set_options("Choice", [("a", "Alpha"), ("b", "Beta")])
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Submit' }) });
  await expect(form.locator('select[name="Choice"] option')).toContainText(['Alpha', 'Beta']);
});

test('chore chart example populates chore dropdowns from the attached database', async ({ page }) => {
  await page.goto('/');
  await page.locator('#fileInput').setInputFiles('examples/chore-chart-3.hvy');
  await expect(page.getByLabel('Download file name')).toHaveValue('chore-chart-3.hvy');

  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(page.locator('#chores-pivot')).toContainText('Pick up clothes');

  const assignForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Assign chore' }) });
  await expect(assignForm.locator('select[name="Chore"] option')).toContainText(['1: Pick up clothes']);

  const completeForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Complete chore' }) });
  await expect(completeForm.locator('select[name="Chore"] option')).toContainText(['1: Pick up clothes']);

  const addForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add chore' }) });
  await addForm.locator('input[name="Title"]').fill('Wash dishes');
  await addForm.locator('textarea[name="Description"]').fill('After dinner');
  await addForm.getByRole('button', { name: 'Add chore' }).click();

  await expect(page.locator('#chores-pivot')).toContainText('Wash dishes');
  await expect(assignForm.locator('select[name="Chore"] option')).toContainText(['1: Pick up clothes', '2: Wash dishes']);
  await expect(completeForm.locator('select[name="Chore"] option')).toContainText(['1: Pick up clothes', '2: Wash dishes']);
});
