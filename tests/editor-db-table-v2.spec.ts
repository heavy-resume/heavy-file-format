import { expect, test, type Page } from '@playwright/test';

test.setTimeout(5_000);

async function loadDbTableV2Crm(page: Page, contacts = ['Jane Smith']): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
plugins:
  - id: hvy.db-table-v2
---

<!--hvy: {"id":"crm"}-->
#! CRM

<!--hvy:plugin {"id":"contacts","plugin":"hvy.db-table-v2","pluginConfig":{"source":"with-file","table":"contacts","columns":{"id":{"visibility":"compact","width":"5rem"},"relationship_id":{"label":"Organization","width":"16rem","foreignDisplayColumn":"organization"}}}}-->
`);
  await expect(page.locator('#rawEditor')).toHaveValue(/hvy\.db-table-v2/u);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('#rawEditor')).toHaveValue(/hvy\.db-table-v2/u);
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.evaluate(async (contactNames) => {
    const { state, getRenderApp } = await import('/src/state.ts');
    const { setActiveEditorBlock } = await import('/src/block-ops.ts');
    const { createScriptingDbRuntime } = await import('/src/plugins/db-table.ts');
    const runtime = await createScriptingDbRuntime(state.document);
    try {
      runtime.api.execute('CREATE TABLE relationships (id INTEGER PRIMARY KEY, organization TEXT NOT NULL)');
      runtime.api.execute('CREATE TABLE contacts (id INTEGER PRIMARY KEY, contact TEXT NOT NULL, relationship_id INTEGER NOT NULL REFERENCES relationships(id) ON DELETE CASCADE)');
      runtime.api.execute("INSERT INTO relationships (organization) VALUES ('Acme Corp'), ('Globex')");
      for (const contactName of contactNames) {
        runtime.api.execute('INSERT INTO contacts (contact, relationship_id) VALUES (?, 1)', [contactName]);
      }
    } finally {
      runtime.dispose();
    }
    const section = state.document.sections[0];
    const block = section?.blocks[0];
    if (!section || !block || block.schema.plugin !== 'hvy.db-table-v2') throw new Error('DB Table v2 fixture did not create its component.');
    setActiveEditorBlock(section.key, block.id);
    getRenderApp()();
  }, contacts);
  await expect(page.locator('.hvy-db-table-v2-editor [data-db-v2-field="cell"][data-column-name="contact"]').first()).toHaveValue('Jane Smith');
}

test('db-table-v2 edits relationships, stages required rows, and controls column visibility', async ({ page }) => {
  await loadDbTableV2Crm(page);
  const plugin = page.locator('.hvy-db-table-v2-editor');

  // BEFORE
  await expect(plugin.locator('thead')).toContainText('Id');
  await expect(plugin.locator('thead')).toContainText('Organization');
  await expect(plugin.locator('[data-db-v2-field="cell"][data-column-name="relationship_id"] option:checked')).toHaveText('Acme Corp');

  // TOOL CALL
  await plugin.getByRole('button', { name: 'Columns' }).click();
  await plugin.locator('.db-v2-column-card').first().locator('[data-db-v2-field="column-visibility"]').selectOption('hidden');
  await plugin.getByRole('button', { name: 'Close column settings' }).click();
  await plugin.getByRole('button', { name: 'Add Row' }).click();
  await plugin.getByRole('button', { name: 'Save' }).click();

  // AFTER
  await expect(plugin.locator('thead').getByText('Id', { exact: true })).toHaveCount(0);
  await expect(plugin.getByRole('alert')).toHaveText('Complete the required fields before saving this row.');
  const draftContact = plugin.locator('[data-db-v2-draft-control][data-column-name="contact"]');
  await draftContact.fill('Alex Doe');
  await expect(draftContact).toBeFocused();
  await plugin.locator('select[data-db-v2-draft-control][data-column-name="relationship_id"]').selectOption({ label: 'Globex' });
  await plugin.getByRole('button', { name: 'Save' }).click();
  await expect(plugin.locator('[data-db-v2-field="cell"][data-column-name="contact"]').nth(1)).toHaveValue('Alex Doe');
  await expect(plugin.locator('[data-db-v2-field="cell"][data-column-name="relationship_id"]').nth(1).locator('option:checked')).toHaveText('Globex');
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const { createScriptingDbRuntime } = await import('/src/plugins/db-table.ts');
    const runtime = await createScriptingDbRuntime(state.document);
    try {
      return runtime.api.query("SELECT relationship_id, typeof(relationship_id) AS storage_type FROM contacts WHERE contact = 'Alex Doe'")[0];
    } finally {
      runtime.dispose();
    }
  })).toMatchObject({ relationship_id: 2, storage_type: 'integer' });
});

test('db-table-v2 carries forward schema editing, row attachments, and confirmed row deletion', async ({ page }) => {
  await loadDbTableV2Crm(page);
  const plugin = page.locator('.hvy-db-table-v2-editor');

  // BEFORE
  await expect(plugin.locator('[data-db-v2-field="cell"][data-column-name="contact"]')).toHaveValue('Jane Smith');

  // TOOL CALL
  await plugin.getByRole('button', { name: 'Columns' }).click();
  await plugin.getByRole('button', { name: 'Add Column' }).click();
  const addedColumn = plugin.locator('[data-db-v2-field="schema-column-name"][value="Column 1"]');
  await expect(addedColumn).toBeVisible();
  await addedColumn.fill('Notes');
  await addedColumn.blur();

  // AFTER
  await expect(plugin.locator('[data-db-v2-field="schema-column-name"][value="Notes"]')).toBeVisible();
  const notesCard = plugin.locator('[data-db-v2-field="schema-column-name"][value="Notes"]').locator('xpath=ancestor::div[contains(@class,"db-v2-column-card")]');
  await notesCard.getByRole('button', { name: 'Delete database column Notes' }).click();
  await page.getByRole('dialog', { name: 'Confirm deletion?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(plugin.locator('[data-db-v2-field="schema-column-name"][value="Notes"]')).toHaveCount(0);

  await plugin.getByRole('button', { name: 'Close column settings' }).click();
  await plugin.getByRole('button', { name: 'Add details' }).click();
  await expect(page.locator('#modalRoot h3')).toHaveText('contacts / 1');
  await page.locator('#modalRoot').getByRole('button', { name: 'Cancel' }).click();

  await plugin.getByRole('button', { name: 'Delete row' }).click();
  await page.getByRole('dialog', { name: 'Confirm deletion?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(plugin.locator('[data-db-v2-field="cell"][data-column-name="contact"]')).toHaveCount(0);
});

test('db-table-v2 uses queryLimit as the single page size without changing an authored SQL limit', async ({ page }) => {
  await loadDbTableV2Crm(page, ['Jane Smith', 'Alex Doe', 'Blair Doe', 'Casey Doe', 'Devon Doe']);
  const plugin = page.locator('.hvy-db-table-v2-editor');

  // BEFORE
  await expect(plugin.locator('[data-db-v2-field="cell"][data-column-name="contact"]')).toHaveCount(5);

  // TOOL CALL
  await plugin.locator('.db-v2-query summary').click();
  await plugin.getByLabel('Rows per page').fill('2');
  await plugin.getByLabel('Rows per page').blur();

  // AFTER
  await expect(plugin.locator('[data-db-v2-field="cell"][data-column-name="contact"]')).toHaveCount(2);
  await expect(plugin.locator('.db-v2-pager')).toContainText('Rows 1–2');
  await plugin.getByRole('button', { name: 'Next rows' }).click();
  await expect(plugin.locator('[data-db-v2-field="cell"][data-column-name="contact"]').first()).toHaveValue('Blair Doe');
  await expect(plugin.locator('.db-v2-pager')).toContainText('Rows 3–4');

  await plugin.locator('.db-v2-query summary').click();
  await plugin.getByLabel('Optional read-only SELECT').fill('SELECT contact FROM contacts ORDER BY id LIMIT 3');
  await plugin.getByLabel('Optional read-only SELECT').blur();
  await expect(plugin.locator('.db-v2-table-heading')).toContainText('Query result · read-only');
  await expect(plugin.locator('tbody tr')).toHaveCount(2);
  await expect(plugin.getByRole('button', { name: 'Add Row' })).toHaveCount(0);
  await plugin.getByRole('button', { name: 'Next rows' }).click();
  await expect(plugin.locator('tbody')).toContainText('Blair Doe');
  await expect(plugin.getByRole('button', { name: 'Next rows' })).toBeDisabled();
});

test('db-table-v2 cell and destructive schema edits share async document undo', async ({ page }) => {
  await loadDbTableV2Crm(page);
  const plugin = page.locator('.hvy-db-table-v2-editor');
  const contact = plugin.locator('[data-db-v2-field="cell"][data-column-name="contact"]');

  // BEFORE / TOOL CALL / AFTER: logical inverse
  await contact.fill('Janet Smith');
  await contact.blur();
  await expect(contact).toHaveValue('Janet Smith');
  await page.evaluate(async () => {
    const { undoStateAsync } = await import('/src/history.ts');
    await undoStateAsync();
  });
  await expect(plugin.locator('[data-db-v2-field="cell"][data-column-name="contact"]')).toHaveValue('Jane Smith');
  await page.evaluate(async () => {
    const { redoStateAsync } = await import('/src/history.ts');
    await redoStateAsync();
  });
  await expect(plugin.locator('[data-db-v2-field="cell"][data-column-name="contact"]')).toHaveValue('Janet Smith');

  // BEFORE / TOOL CALL / AFTER: full checkpoint
  await plugin.getByRole('button', { name: 'Columns' }).click();
  await plugin.getByRole('button', { name: 'Add Column' }).click();
  await expect(plugin.locator('[data-db-v2-field="schema-column-name"][value="Column 1"]')).toBeVisible();
  await plugin.getByRole('button', { name: 'Delete database column Column 1' }).click();
  await page.getByRole('dialog', { name: 'Confirm deletion?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(plugin.locator('[data-db-v2-field="schema-column-name"][value="Column 1"]')).toHaveCount(0);
  await page.evaluate(async () => {
    const { undoStateAsync } = await import('/src/history.ts');
    await undoStateAsync();
  });
  if (await plugin.locator('.db-v2-column-settings').count() === 0) {
    await plugin.getByRole('button', { name: 'Columns' }).click();
  }
  await expect(plugin.locator('[data-db-v2-field="schema-column-name"][value="Column 1"]')).toBeVisible();
});
