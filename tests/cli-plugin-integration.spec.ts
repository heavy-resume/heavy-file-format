import { expect, test, type Page } from '@playwright/test';

async function runCliCommand(page: Page, command: string): Promise<void> {
  const lineCount = await page.locator('#cliOutput .cli-line').count();
  const isPlaceholder = (await page.locator('#cliOutput').textContent())?.includes('/ $ man ls') ?? false;
  await page.locator('#cliInput').fill(command);
  await page.keyboard.press('Enter');
  await expect(page.locator('#cliOutput .cli-line')).toHaveCount(isPlaceholder ? lineCount : lineCount + 1);
  await expect(page.locator('#cliOutput .cli-line').last()).toContainText(command.split(/\s+/).slice(0, 4).join(' '));
}

function scriptArg(source: string): string {
  return source.trim().replace(/\n/g, '\\n');
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

  await runCliCommand(page, 'hvy add section /body chore-chart "Chore Chart"');
  await runCliCommand(page, 'hvy add plugin db-table /chore-chart active-chore-chart active_chore_chart "SELECT Chore, Dad, Mom, Child FROM active_chore_chart"');
  await runCliCommand(page, 'hvy add plugin db-table /chore-chart weekly-leaders weekly_chore_leaders "SELECT Person, Completed FROM weekly_chore_leaders"');
  await runCliCommand(
    page,
    `hvy add plugin form /chore-chart add-chore-form "Add chore" "Description:textarea:required" --script submit "${setupChoreDb}" --on-submit-script submit`
  );
  await runCliCommand(
    page,
    `hvy add plugin form /chore-chart assign-chore-form "Assign chore" "Chore:text:required" "Assignee:select:required:Dad|Mom|Child" --script submit "${assignChore}" --on-submit-script submit`
  );
  await runCliCommand(
    page,
    `hvy add plugin form /chore-chart complete-chore-form "Complete chore" "Chore:text:required" "Completed by:select:required:Dad|Mom|Child" --script submit "${completeChore}" --on-submit-script submit`
  );

  await page.getByRole('button', { name: 'Viewer' }).click();

  const addForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add chore' }) });
  await addForm.locator('textarea[name="Description"]').fill('Dishes');
  await addForm.getByRole('button', { name: 'Add chore' }).click();
  await expect(page.locator('.hvy-db-table-plugin-reader').filter({ hasText: 'Dishes' })).toBeVisible({ timeout: 15_000 });

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
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"sandbox"}-->
#! Sandbox

<!--hvy:plugin {"id":"globals-check","plugin":"dev.heavy.scripting","pluginConfig":{"version":"0.1"}}-->
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
    "__hvy_user_globals__",
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
  await page.waitForFunction(() => {
    const scripting = (window as unknown as { __HVY_SCRIPTING__?: { runtimes: Record<string, unknown> } }).__HVY_SCRIPTING__;
    return Boolean(scripting) && Object.keys(scripting.runtimes).length === 0;
  });

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.locator('#rawEditor')).toContainText('sandbox_globals: clean');
  await expect(page.locator('#rawEditor')).toContainText('sandbox_direct: clean');
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
