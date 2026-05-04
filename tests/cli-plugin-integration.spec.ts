import { expect, test, type Page } from '@playwright/test';

async function runCliCommand(page: Page, command: string): Promise<void> {
  await page.locator('#cliInput').fill(command);
  await page.keyboard.press('Enter');
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
description = doc.form.get_value('description')
doc.db.execute('INSERT INTO chores (description, active) VALUES (\\'' + description + '\\', 1)')
`);
  const assignChore = scriptArg(`
chore = doc.form.get_value('chore')
assignee = doc.form.get_value('assignee')
doc.db.execute('UPDATE chores SET assigned_to = \\'' + assignee + '\\' WHERE description = \\'' + chore + '\\'')
`);
  const completeChore = scriptArg(`
chore = doc.form.get_value('chore')
person = doc.form.get_value('completed_by')
doc.db.execute('INSERT INTO chore_completions (chore_description, completed_by) VALUES (\\'' + chore + '\\', \\'' + person + '\\')')
doc.db.execute('UPDATE chores SET active = 0 WHERE description = \\'' + chore + '\\'')
`);

  await runCliCommand(page, 'hvy section add /body chore-chart "Chore Chart"');
  await runCliCommand(page, 'db-table add /chore-chart active-chore-chart active_chore_chart "SELECT Chore, Dad, Mom, Child FROM active_chore_chart"');
  await runCliCommand(page, 'db-table add /chore-chart weekly-leaders weekly_chore_leaders "SELECT Person, Completed FROM weekly_chore_leaders"');
  await runCliCommand(
    page,
    `form add /chore-chart add-chore-form "Add chore" "description:Description:textarea:required" --script submit "${setupChoreDb}" --submit submit`
  );
  await runCliCommand(
    page,
    `form add /chore-chart assign-chore-form "Assign chore" "chore:Chore:text:required" "assignee:Assignee:select:required:Dad|Mom|Child" --script submit "${assignChore}" --submit submit`
  );
  await runCliCommand(
    page,
    `form add /chore-chart complete-chore-form "Complete chore" "chore:Chore:text:required" "completed_by:Completed by:select:required:Dad|Mom|Child" --script submit "${completeChore}" --submit submit`
  );

  await page.getByRole('button', { name: 'Viewer' }).click();

  const addForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add chore' }) });
  await addForm.locator('textarea[name="description"]').fill('Dishes');
  await addForm.getByRole('button', { name: 'Add chore' }).click();
  await expect(page.locator('.hvy-db-table-plugin-reader').filter({ hasText: 'Dishes' })).toBeVisible();

  const assignForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Assign chore' }) });
  await assignForm.locator('input[name="chore"]').fill('Dishes');
  await assignForm.locator('select[name="assignee"]').selectOption('Child');
  await assignForm.getByRole('button', { name: 'Assign chore' }).click();
  await expect(page.locator('.hvy-db-table-plugin-reader').filter({ hasText: 'assigned' })).toBeVisible();

  const completeForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Complete chore' }) });
  await completeForm.locator('input[name="chore"]').fill('Dishes');
  await completeForm.locator('select[name="completed_by"]').selectOption('Child');
  await completeForm.getByRole('button', { name: 'Complete chore' }).click();

  const weeklyLeaders = page.locator('#weekly-leaders .hvy-db-table-plugin-reader');
  await expect(weeklyLeaders).toContainText('Child');
  await expect(weeklyLeaders).toContainText('1');
});
