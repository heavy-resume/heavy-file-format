import { expect, test, type Page } from '@playwright/test';

test.setTimeout(5_000);

async function loadDbTableCrm(page: Page, contacts = ['Jane Smith']): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
plugins:
  - id: hvy.db-table
---

<!--hvy: {"id":"crm"}-->
#! CRM

<!--hvy:plugin {"id":"contacts","plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"contacts","columns":{"id":{"visibility":"compact","width":"5rem"},"relationship_id":{"label":"Organization","width":"16rem","foreignDisplayColumn":"organization"}}}}-->
`);
  await expect(page.locator('#rawEditor')).toHaveValue(/hvy\.db-table/u);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('#rawEditor')).toHaveValue(/hvy\.db-table/u);
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
    if (!section || !block || block.schema.plugin !== 'hvy.db-table') throw new Error('DB Table fixture did not create its component.');
    setActiveEditorBlock(section.key, block.id);
    getRenderApp()();
  }, contacts);
  await expect(page.locator('.hvy-database-table-editor [data-db-table-field="cell"][data-column-name="contact"]').first()).toHaveValue('Jane Smith');
}

test('database-table edits relationships, stages required rows, and controls column visibility', async ({ page }) => {
  await loadDbTableCrm(page);
  const plugin = page.locator('.hvy-database-table-editor');

  // BEFORE
  // Editable headers are inputs, so the visible name is a value rather than text.
  await expect(plugin.getByLabel('Display name for id')).toHaveValue('Id');
  await expect(plugin.getByLabel('Display name for relationship_id')).toHaveValue('Organization');
  await expect(plugin.locator('[data-db-table-field="cell"][data-column-name="relationship_id"] option:checked')).toHaveText('Acme Corp');

  // TOOL CALL
  await plugin.getByRole('button', { name: 'Columns' }).click();
  await plugin.locator('.db-table-column-card').first().locator('[data-db-table-field="column-visibility"]').selectOption('hidden');
  await plugin.getByRole('button', { name: 'Close column settings' }).click();
  await plugin.getByRole('button', { name: 'Row', exact: true }).click();
  await plugin.getByRole('button', { name: 'Save' }).click();

  // AFTER
  await expect(plugin.getByLabel('Display name for id')).toHaveCount(0);
  await expect(plugin.getByRole('alert')).toHaveText('Complete the required fields before saving this row.');
  const draftContact = plugin.locator('[data-db-table-draft-control][data-column-name="contact"]');
  await draftContact.fill('Alex Doe');
  await expect(draftContact).toBeFocused();
  await plugin.locator('select[data-db-table-draft-control][data-column-name="relationship_id"]').selectOption({ label: 'Globex' });
  await plugin.getByRole('button', { name: 'Save' }).click();
  await expect(plugin.locator('[data-db-table-field="cell"][data-column-name="contact"]').nth(1)).toHaveValue('Alex Doe');
  await expect(plugin.locator('[data-db-table-field="cell"][data-column-name="relationship_id"]').nth(1).locator('option:checked')).toHaveText('Globex');
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

test('database-table carries forward schema editing, row attachments, and confirmed row deletion', async ({ page }) => {
  await loadDbTableCrm(page);
  const plugin = page.locator('.hvy-database-table-editor');

  // BEFORE
  await expect(plugin.locator('[data-db-table-field="cell"][data-column-name="contact"]')).toHaveValue('Jane Smith');

  // TOOL CALL
  await plugin.getByRole('button', { name: 'Columns' }).click();
  await plugin.getByRole('button', { name: 'Column', exact: true }).click();
  const addedColumn = plugin.locator('.db-table-column-settings [data-db-table-field="schema-column-name"][value="Column 1"]');
  await expect(addedColumn).toBeVisible();
  await addedColumn.fill('Notes');
  await addedColumn.blur();

  // AFTER
  await expect(plugin.locator('.db-table-column-settings [data-db-table-field="schema-column-name"][value="Notes"]')).toBeVisible();
  const notesCard = plugin.locator('.db-table-column-settings [data-db-table-field="schema-column-name"][value="Notes"]').locator('xpath=ancestor::div[contains(@class,"db-table-column-card")]');
  await notesCard.getByRole('button', { name: 'Delete database column Notes' }).click();
  await page.getByRole('dialog', { name: 'Confirm deletion?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(plugin.locator('.db-table-column-settings [data-db-table-field="schema-column-name"][value="Notes"]')).toHaveCount(0);

  await plugin.getByRole('button', { name: 'Close column settings' }).click();
  await plugin.getByRole('button', { name: 'Add details' }).click();
  await expect(page.locator('#modalRoot h3')).toHaveText('contacts / 1');
  await page.locator('#modalRoot').getByRole('button', { name: 'Cancel' }).click();

  await plugin.getByRole('button', { name: 'Delete row' }).click();
  await page.getByRole('dialog', { name: 'Confirm deletion?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(plugin.locator('[data-db-table-field="cell"][data-column-name="contact"]')).toHaveCount(0);
});

test('database-table renames database columns directly from spreadsheet headers', async ({ page }) => {
  await loadDbTableCrm(page);
  const plugin = page.locator('.hvy-database-table-editor');
  const columnName = plugin.getByLabel('Display name for contact');

  // BEFORE
  await expect(columnName).toHaveValue('Contact');

  // TOOL CALL
  await columnName.focus();
  await plugin.getByRole('button', { name: 'DB Column' }).click();
  // Switching modes retargets the same header input at the database name.
  const databaseName = plugin.getByLabel('Database name for contact');
  await databaseName.fill('contact_name');
  await databaseName.blur();

  // AFTER
  await expect(plugin.getByLabel('Display name for contact_name')).toHaveValue('Contact');
  await expect(plugin.locator('[data-db-table-field="cell"][data-column-name="contact_name"]')).toHaveValue('Jane Smith');
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const { createScriptingDbRuntime } = await import('/src/plugins/db-table.ts');
    const runtime = await createScriptingDbRuntime(state.document);
    try {
      return runtime.api.query('PRAGMA table_info(contacts)').map((column) => column.name);
    } finally {
      runtime.dispose();
    }
  })).toContain('contact_name');
});

test('database-table resizes columns and auto-fits data within the document maximum', async ({ page }) => {
  await loadDbTableCrm(page);
  const plugin = page.locator('.hvy-database-table-editor');
  const contactHeader = plugin.locator('.db-table-column-name-input[data-column-name="contact"]').locator('xpath=ancestor::th');
  const resizeHandle = contactHeader.locator('.db-table-resize-handle');
  await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    state.document.meta.database_table_max_column_width = '30rem';
  });

  // BEFORE
  const initialWidth = (await contactHeader.boundingBox())?.width ?? 0;
  const handleBox = await resizeHandle.boundingBox();
  expect(handleBox).not.toBeNull();

  // TOOL CALL
  await resizeHandle.dispatchEvent('pointerdown', { button: 0, clientX: handleBox!.x, pointerId: 7 });
  await page.evaluate((clientX) => window.dispatchEvent(new PointerEvent('pointermove', { clientX, pointerId: 7 })), handleBox!.x + 45);
  await page.evaluate((clientX) => window.dispatchEvent(new PointerEvent('pointerup', { clientX, pointerId: 7 })), handleBox!.x + 45);

  // AFTER
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return String(state.document.sections[0]?.blocks[0]?.schema.pluginConfig.columns?.contact?.width ?? '');
  })).toMatch(/px$/u);
  expect((await contactHeader.boundingBox())?.width ?? 0).toBeGreaterThan(initialWidth);

  await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    state.document.meta.database_table_max_column_width = '10rem';
  });
  const contact = plugin.locator('[data-db-table-field="cell"][data-column-name="contact"]').first();
  await contact.fill('A deliberately very long contact value that exceeds the configured maximum');
  await contact.blur();
  await resizeHandle.dblclick();
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0]?.blocks[0]?.schema.pluginConfig.columns?.contact?.width;
  })).toBe('160px');
});

test('database-table uses queryLimit as the single page size without changing an authored SQL limit', async ({ page }) => {
  await loadDbTableCrm(page, ['Jane Smith', 'Alex Doe', 'Blair Doe', 'Casey Doe', 'Devon Doe']);
  const plugin = page.locator('.hvy-database-table-editor');

  // BEFORE
  await expect(plugin.locator('[data-db-table-field="cell"][data-column-name="contact"]')).toHaveCount(5);

  // TOOL CALL
  await plugin.locator('.db-table-query summary').click();
  await plugin.getByLabel('Rows per page').fill('2');
  await plugin.getByLabel('Rows per page').blur();

  // AFTER
  await expect(plugin.locator('[data-db-table-field="cell"][data-column-name="contact"]')).toHaveCount(2);
  await expect(plugin.locator('.db-table-pager')).toContainText('Rows 1–2');
  await plugin.getByRole('button', { name: 'Next rows' }).click();
  await expect(plugin.locator('[data-db-table-field="cell"][data-column-name="contact"]').first()).toHaveValue('Blair Doe');
  await expect(plugin.locator('.db-table-pager')).toContainText('Rows 3–4');

  await plugin.locator('.db-table-query summary').click();
  await plugin.getByLabel('Optional read-only SELECT').fill('SELECT contact FROM contacts ORDER BY id LIMIT 3');
  await plugin.getByLabel('Optional read-only SELECT').blur();
  await expect(plugin.locator('.db-table-table-heading')).toContainText('Query result · read-only');
  await expect(plugin.locator('tbody tr')).toHaveCount(2);
  await expect(plugin.getByRole('button', { name: 'Row', exact: true })).toHaveCount(0);
  await plugin.getByRole('button', { name: 'Next rows' }).click();
  await expect(plugin.locator('tbody')).toContainText('Blair Doe');
  await expect(plugin.getByRole('button', { name: 'Next rows' })).toBeDisabled();
});

test('database-table cell and destructive schema edits share async document undo', async ({ page }) => {
  await loadDbTableCrm(page);
  const plugin = page.locator('.hvy-database-table-editor');
  const contact = plugin.locator('[data-db-table-field="cell"][data-column-name="contact"]');

  // BEFORE / TOOL CALL / AFTER: logical inverse
  await contact.fill('Janet Smith');
  await contact.blur();
  await expect(contact).toHaveValue('Janet Smith');
  await page.evaluate(async () => {
    const { undoStateAsync } = await import('/src/history.ts');
    await undoStateAsync();
  });
  await expect(plugin.locator('[data-db-table-field="cell"][data-column-name="contact"]')).toHaveValue('Jane Smith');
  await page.evaluate(async () => {
    const { redoStateAsync } = await import('/src/history.ts');
    await redoStateAsync();
  });
  await expect(plugin.locator('[data-db-table-field="cell"][data-column-name="contact"]')).toHaveValue('Janet Smith');

  // BEFORE / TOOL CALL / AFTER: full checkpoint
  await plugin.getByRole('button', { name: 'Columns' }).click();
  await plugin.getByRole('button', { name: 'Column', exact: true }).click();
  await expect(plugin.locator('.db-table-column-settings [data-db-table-field="schema-column-name"][value="Column 1"]')).toBeVisible();
  await plugin.getByRole('button', { name: 'Delete database column Column 1' }).click();
  await page.getByRole('dialog', { name: 'Confirm deletion?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(plugin.locator('.db-table-column-settings [data-db-table-field="schema-column-name"][value="Column 1"]')).toHaveCount(0);
  await page.evaluate(async () => {
    const { undoStateAsync } = await import('/src/history.ts');
    await undoStateAsync();
  });
  if (await plugin.locator('.db-table-column-settings').count() === 0) {
    await plugin.getByRole('button', { name: 'Columns' }).click();
  }
  await expect(plugin.locator('.db-table-column-settings [data-db-table-field="schema-column-name"][value="Column 1"]')).toBeVisible();
});

test('an embedded writable host source drives the real db-table editor', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="warehouseMount"></div>';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ '/src/embed-full.ts');
    const root = document.querySelector<HTMLElement>('#warehouseMount');
    if (!root) throw new Error('Warehouse mount missing.');

    // A source with no SQLite behind it at all: rows live in this array.
    const rows = [{ rowId: 1, hasAttachedComponent: false, values: { name: 'Existing' } }];
    const column = {
      name: 'name',
      type: 'text',
      notNull: false,
      defaultValue: null,
      primaryKeyOrder: 0,
      generated: false,
      foreignKey: null,
    };
    const testWindow = window as Window & { warehouseCalls?: string[] };
    testWindow.warehouseCalls = [];

    mountHvy({
      root,
      document: deserializeDocumentBytes(new TextEncoder().encode(`---
hvy_version: 0.1
plugins:
  - id: hvy.db-table
---

<!--hvy: {"id":"warehouse"}-->
#! Warehouse

<!--hvy:plugin {"id":"items","plugin":"hvy.db-table","pluginConfig":{"source":"warehouse","table":"work_items"}}-->
`), '.hvy'),
      mode: 'editor',
      plugins: [plugins.dbTable],
      databaseSources: [{
        id: 'warehouse',
        label: 'Warehouse',
        async readPage(request) {
          return {
            objectType: 'table',
            editable: true,
            queryActive: false,
            columns: [column],
            rows: rows.map((row) => ({ ...row, values: { ...row.values } })),
            offset: request.offset,
            hasNextPage: false,
            hasTriggers: false,
          };
        },
        write: {
          undo: 'logical',
          async createTable() { testWindow.warehouseCalls?.push('createTable'); },
          async addColumn() { testWindow.warehouseCalls?.push('addColumn'); return 'Column 1'; },
          async addNamedColumn(_request, name) { testWindow.warehouseCalls?.push(`addNamedColumn:${name}`); },
          async dropColumn(_request, name) { testWindow.warehouseCalls?.push(`dropColumn:${name}`); },
          async renameColumn(_request, from, to) { testWindow.warehouseCalls?.push(`renameColumn:${from}->${to}`); return to; },
          async updateCell(_request, rowId, target, value) {
            testWindow.warehouseCalls?.push(`updateCell:${rowId}:${target.name}=${String(value)}`);
            const row = rows.find((candidate) => candidate.rowId === rowId);
            if (row) row.values[target.name] = value as string;
          },
          async insertRow(_request, values) {
            testWindow.warehouseCalls?.push(`insertRow:${values.map((entry) => String(entry.value)).join(',')}`);
            const inserted = { rowId: rows.length + 1, values: Object.fromEntries(values.map((entry) => [entry.column.name, entry.value])) };
            rows.push({ rowId: inserted.rowId, hasAttachedComponent: false, values: { ...inserted.values } as Record<string, string> });
            return inserted;
          },
          async deleteRow(_request, rowId) {
            testWindow.warehouseCalls?.push(`deleteRow:${rowId}`);
            const index = rows.findIndex((candidate) => candidate.rowId === rowId);
            if (index >= 0) rows.splice(index, 1);
          },
          async restoreRow() { testWindow.warehouseCalls?.push('restoreRow'); },
        },
      }],
    });
  });

  // Activate the block the way an author would.
  await page.locator('#warehouseMount .editor-block-passive').first().click();

  const plugin = page.locator('#warehouseMount .hvy-database-table-editor');
  const cells = plugin.locator('[data-db-table-field="cell"][data-column-name="name"]');

  // BEFORE: a source declaring writes renders editable, with no SQLite involved.
  await expect(cells).toHaveValue('Existing');
  await expect(plugin.getByRole('button', { name: 'Row', exact: true })).toBeVisible();

  // TOOL CALL: edit a cell and add a row through the normal editor affordances.
  await cells.first().fill('Renamed');
  await cells.first().blur();
  await plugin.getByRole('button', { name: 'Row', exact: true }).click();
  await plugin.locator('[data-db-table-draft-control][data-column-name="name"]').fill('Added');
  await plugin.getByRole('button', { name: 'Save' }).click();

  // AFTER: the host source received both writes and the grid shows its data.
  await expect(cells).toHaveCount(2);
  await expect(cells.nth(1)).toHaveValue('Added');
  expect(await page.evaluate(() => (window as Window & { warehouseCalls?: string[] }).warehouseCalls)).toEqual([
    'updateCell:1:name=Renamed',
    'insertRow:Added',
  ]);
});
