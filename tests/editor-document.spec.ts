import { expect, test } from '@playwright/test';

test('can add section and undo/redo', async ({ page }) => {
  await page.goto('/');

  const sections = page.locator('[data-action="remove-section"]');
  const initialCount = await sections.count();

  await page.locator('[data-action="add-top-level-section"]').click();
  await expect(sections).toHaveCount(initialCount + 1);

  await page.keyboard.press('Control+z');
  await expect(sections).toHaveCount(initialCount);

  await page.keyboard.press('Control+y');
  await expect(sections).toHaveCount(initialCount + 1);
});

test('section remove requires confirmation', async ({ page }) => {
  await page.goto('/');

  const sections = page.locator('[data-action="remove-section"]');
  const initialCount = await sections.count();

  await page.locator('[data-action="add-top-level-section"]').click();
  await expect(sections).toHaveCount(initialCount + 1);

  const removeButton = sections.nth(initialCount);
  await removeButton.dispatchEvent('click');
  await expect(sections).toHaveCount(initialCount + 1);
  await expect(page.getByRole('dialog', { name: 'Confirm deletion?' })).toBeVisible();
  await expect(removeButton).toHaveText('Remove');

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirm deletion?' })).toHaveCount(0);
  await expect(sections).toHaveCount(initialCount + 1);

  await removeButton.dispatchEvent('click');
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(async () => sections.count()).toBeLessThan(initialCount + 1);
});

test('reader max width keeps focus while typing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();

  const readerMaxWidth = page.locator('[data-field="meta-reader-max-width"]');
  await readerMaxWidth.fill('');
  await readerMaxWidth.type('60rem');

  await expect(readerMaxWidth).toBeFocused();
  await expect(readerMaxWidth).toHaveValue('60rem');
});

test('responsive preview controls resize document frame without resizing app chrome', async ({ page }) => {
  await page.goto('/');

  const surface = page.locator('.hvy-surface').first();
  const previewFrame = page.locator('.editor-shell').first();
  const pane = page.locator('.full-pane').first();
  const workspace = page.locator('.workspace-shell').first();
  const initialWorkspaceWidth = (await workspace.boundingBox())?.width ?? 0;
  const initialPaneWidth = (await pane.boundingBox())?.width ?? 0;
  expect(initialPaneWidth).toBeGreaterThan(768);

  await page.getByRole('button', { name: 'Phone 390' }).click();
  await expect.poll(async () => Math.round((await pane.boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await previewFrame.boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await surface.boundingBox())?.width ?? 0)).toBeGreaterThan(320);
  expect(Math.round((await surface.boundingBox())?.width ?? 0)).toBeLessThan(390);
  const phonePaneBox = await pane.boundingBox();
  const phoneSurfaceBox = await surface.boundingBox();
  expect(phonePaneBox).not.toBeNull();
  expect(phoneSurfaceBox).not.toBeNull();
  expect(Math.round(phonePaneBox!.x + phonePaneBox!.width - (phoneSurfaceBox!.x + phoneSurfaceBox!.width))).toBeGreaterThanOrEqual(8);
  expect(Math.round((await workspace.boundingBox())?.width ?? 0)).toBe(Math.round(initialWorkspaceWidth));

  await page.getByRole('button', { name: 'Tablet 768' }).click();
  await expect.poll(async () => Math.round((await pane.boundingBox())?.width ?? 0)).toBe(768);
  await expect.poll(async () => Math.round((await previewFrame.boundingBox())?.width ?? 0)).toBe(768);
  await expect.poll(async () => Math.round((await surface.boundingBox())?.width ?? 0)).toBeGreaterThan(700);
  expect(Math.round((await surface.boundingBox())?.width ?? 0)).toBeLessThan(768);
  const tabletPaneBox = await pane.boundingBox();
  const tabletSurfaceBox = await surface.boundingBox();
  expect(tabletPaneBox).not.toBeNull();
  expect(tabletSurfaceBox).not.toBeNull();
  expect(Math.round(tabletPaneBox!.x + tabletPaneBox!.width - (tabletSurfaceBox!.x + tabletSurfaceBox!.width))).toBeGreaterThanOrEqual(10);
  expect(Math.round((await workspace.boundingBox())?.width ?? 0)).toBe(Math.round(initialWorkspaceWidth));

  await page.getByRole('button', { name: 'Full' }).click();
  await expect.poll(async () => Math.round((await pane.boundingBox())?.width ?? 0)).toBe(Math.round(initialPaneWidth));
  await expect.poll(async () => Math.round((await previewFrame.boundingBox())?.width ?? 0)).toBeGreaterThan(768);
  const fullPaneBox = await pane.boundingBox();
  const fullSurfaceBox = await surface.boundingBox();
  expect(fullPaneBox).not.toBeNull();
  expect(fullSurfaceBox).not.toBeNull();
  expect(Math.round(fullPaneBox!.x + fullPaneBox!.width - (fullSurfaceBox!.x + fullSurfaceBox!.width))).toBeGreaterThanOrEqual(12);

  await page.getByRole('button', { name: 'Desktop' }).click();
  await expect.poll(async () => Math.round((await pane.boundingBox())?.width ?? 0)).toBeGreaterThan(768);
  const desktopPaneBox = await pane.boundingBox();
  const desktopSurfaceBox = await surface.boundingBox();
  expect(desktopPaneBox).not.toBeNull();
  expect(desktopSurfaceBox).not.toBeNull();
  expect(Math.round(desktopPaneBox!.x + desktopPaneBox!.width - (desktopSurfaceBox!.x + desktopSurfaceBox!.width))).toBeGreaterThanOrEqual(12);
});

test('responsive preview applies to pullout document surfaces', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.getByRole('button', { name: 'Phone 390' }).click();

  await page.locator('.editor-sidebar-tab').click();
  await expect.poll(async () => Math.round((await page.locator('.editor-pane').boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await page.locator('.editor-shell').boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await page.locator('.editor-sidebar').boundingBox())?.width ?? 0)).toBeLessThan(390);
  await expect.poll(async () => Math.round((await page.locator('.editor-sidebar-panel .hvy-surface').boundingBox())?.width ?? 0)).toBeLessThan(390);

  await page.getByRole('button', { name: 'Viewer' }).click();
  await page.locator('.viewer-sidebar-tab').click();
  await expect.poll(async () => Math.round((await page.locator('.reader-pane').boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await page.locator('.viewer-shell').boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await page.locator('.viewer-sidebar').boundingBox())?.width ?? 0)).toBeLessThan(390);
  await expect.poll(async () => Math.round((await page.locator('.viewer-sidebar-panel .hvy-surface').boundingBox())?.width ?? 0)).toBeLessThan(390);
});

test('responsive preview frame clips its own overflow while document surfaces scroll', async ({ page }) => {
  await page.goto('/');

  for (const preview of ['Phone 390', 'Tablet 768', 'Desktop']) {
    await page.getByRole('button', { name: preview }).click();
    await expect(page.locator('.pane.hvy-preview-frame')).toHaveCSS('overflow-x', 'clip');
    await expect(page.locator('.pane.hvy-preview-frame')).toHaveCSS('overflow-y', 'clip');
    await expect(page.locator('.editor-tree')).toHaveCSS('overflow-y', 'auto');
  }

  await page.getByRole('button', { name: 'Viewer' }).click();

  for (const preview of ['Phone 390', 'Tablet 768', 'Desktop']) {
    await page.getByRole('button', { name: preview }).click();
    await expect(page.locator('.pane.hvy-preview-frame')).toHaveCSS('overflow-x', 'clip');
    await expect(page.locator('.pane.hvy-preview-frame')).toHaveCSS('overflow-y', 'clip');
    await expect(page.locator('.reader-document')).toHaveCSS('overflow-y', 'auto');
  }
});

test('compact pullout tab overlays and reveals after scroll idle', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.getByRole('button', { name: 'Phone 390' }).click();

  const shell = page.locator('.editor-shell');
  const tab = page.locator('.editor-sidebar-tab');
  const tree = page.locator('.editor-tree');
  const surface = page.locator('.editor-tree > .hvy-surface').first();

  await expect.poll(async () => Math.round((await surface.boundingBox())?.x ?? 0) - Math.round((await tree.boundingBox())?.x ?? 0)).toBeGreaterThanOrEqual(8);
  await expect.poll(async () => {
    const surfaceBox = await surface.boundingBox();
    const treeBox = await tree.boundingBox();
    if (!surfaceBox || !treeBox) {
      return 0;
    }
    return Math.round(treeBox.x + treeBox.width - (surfaceBox.x + surfaceBox.width));
  }).toBeGreaterThanOrEqual(8);
  await expect(tab).toBeVisible();

  await page.locator('.editor-sidebar-tab').click();
  const openTreeBox = await tree.boundingBox();
  const openSurfaceBox = await surface.boundingBox();
  expect(openTreeBox).not.toBeNull();
  expect(openSurfaceBox).not.toBeNull();
  expect(Math.round(openSurfaceBox!.x - openTreeBox!.x)).toBeGreaterThanOrEqual(30);

  await page.locator('.editor-sidebar-tab').click();
  await expect.poll(async () => Math.round((await surface.boundingBox())?.x ?? 0) - Math.round((await tree.boundingBox())?.x ?? 0)).toBeGreaterThanOrEqual(8);

  await tree.evaluate((node) => {
    node.scrollTop = 240;
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.locator('.editor-sidebar-help-balloon')).toHaveCount(0);
  await expect(shell).toHaveClass(/is-sidebar-tab-hidden/);
  await expect(tab).toHaveCSS('transition-duration', /0\.54s/);

  await expect(shell).toHaveClass(/is-sidebar-tab-visible/, { timeout: 1500 });
});

test('responsive preview applies container query defaults', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  await editor.evaluate((node) => {
    node.innerHTML =
      '<p><span class="hvy-alt" data-hvy-alt="true"><span class="hvy-alt-full">Tools &amp; Technologies</span><span class="hvy-alt-compact">Tools &amp; Tech</span></span></p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  await expect(editor.locator('.hvy-alt-full')).toBeVisible();
  await expect(editor.locator('.hvy-alt-compact')).toBeHidden();

  await page.getByRole('button', { name: 'Phone 390' }).click();
  await expect(editor.locator('.hvy-alt-full')).toBeHidden();
  await expect(editor.locator('.hvy-alt-compact')).toBeVisible();
});

test('tables resize inside narrow responsive preview containers', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-test"}-->
#! Table Test

<!--hvy:table {"id":"narrow-table","tableColumns":["Tool","<!--hvy:alt {\\"compact\\":\\"Desc\\"}-->Description<!--/hvy:alt-->","Status"],"tableShowHeader":true,"tableRows":[{"cells":["Heavy File Format","Responsive table text should wrap inside the phone preview instead of pushing the table wider than its container.","In progress"]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();
  await page.getByRole('button', { name: 'Phone 390' }).click();

  const pane = page.locator('.reader-pane');
  const frame = page.locator('.reader-table-frame');
  const table = page.locator('.reader-table');

  await expect.poll(async () => Math.round((await pane.boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await frame.boundingBox())?.width ?? 0)).toBeLessThan(360);
  await expect.poll(async () => Math.round((await table.boundingBox())?.width ?? 0)).toBeLessThanOrEqual(Math.round((await frame.boundingBox())?.width ?? 0) + 1);
  await expect(table.locator('th').first()).toHaveAttribute('title', 'Tool');
  await expect(table.locator('th').nth(1).locator('.hvy-alt-full')).toBeHidden();
  await expect(table.locator('th').nth(1).locator('.hvy-alt-compact')).toHaveText('Desc');
  await expect(table.locator('th').nth(1).locator('.hvy-alt-compact')).toHaveCSS('border-style', 'none');
  await expect(table.locator('td').nth(1)).toHaveCSS('white-space', 'nowrap');
  await expect(table.locator('td').nth(1)).toHaveCSS('text-overflow', 'ellipsis');
  await expect(table.locator('td').nth(1)).toHaveAttribute('title', 'Responsive table text should wrap inside the phone preview instead of pushing the table wider than its container.');
});

test('document ai context is editable metadata and keeps focus while typing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();

  const aiContext = page.locator('[data-field="meta-ai-context"]');
  await aiContext.fill('');
  await aiContext.type('Use top skills as featured skills.');

  await expect(aiContext).toBeFocused();
  await expect(aiContext).toHaveValue('Use top skills as featured skills.');

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('ai-context: Use top skills as featured skills.');
});

test('description generate button appears only for empty component descriptions', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    const payload = route.request().postDataJSON() as { model?: string; openAiReasoningEffort?: string };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: `AI description from ${payload.model} with reasoning ${payload.openAiReasoningEffort}`,
      }),
    });
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"profile"}-->
#! Profile

<!--hvy:text {"id":"empty-description"}-->
 Empty description body

<!--hvy:text {"id":"filled-description","description":"Existing description"}-->
 Filled description body
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Empty description body' }).click();
  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await activeBlock.getByRole('button', { name: 'Meta' }).click();
  const metaModal = page.locator('.component-meta-modal', { hasText: 'Component Meta: text' });
  await expect(metaModal.locator('[data-action="generate-block-description"]')).toBeVisible();

  await metaModal.locator('[data-action="generate-block-description"]').click();
  await expect(metaModal.locator('[data-action="generate-block-description"]')).toHaveCount(0);
  await expect(metaModal.locator('[data-field="block-description"]')).toHaveValue('AI description from gpt-5.4-nano with reasoning none');
  await expect(activeBlock).toHaveAttribute('data-active-editor-block', 'true');
  await metaModal.locator('[data-field="block-description"]').fill('');
  await expect(metaModal.locator('[data-action="generate-block-description"]')).toBeVisible();
  await expect(metaModal.locator('[data-field="block-description"]')).toBeFocused();

  await page.getByRole('button', { name: 'Close' }).click();
  await activeBlock.getByRole('button', { name: 'Done' }).click();
  await page.locator('.editor-block-passive', { hasText: 'Filled description body' }).click();
  await page.locator('.editor-block[data-active-editor-block="true"]').getByRole('button', { name: 'Meta' }).click();
  await expect(page.locator('.component-meta-modal', { hasText: 'Component Meta: text' }).locator('[data-action="generate-block-description"]')).toHaveCount(0);
});

test('document meta populates missing descriptions parent first', async ({ page }) => {
  const contexts: string[] = [];
  await page.route('**/api/chat', async (route) => {
    const payload = route.request().postDataJSON() as { context?: string };
    contexts.push(payload.context ?? '');
    await new Promise((resolve) => setTimeout(resolve, 80));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: contexts.length === 1 ? 'Profile area' : 'Profile summary list',
      }),
    });
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"profile"}-->
#! Profile

<!--hvy:component-list {"id":"summary-list"}-->

 <!--hvy:component-list:0 {}-->

  <!--hvy:text {"id":"summary"}-->
   Summary body
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();

  await expect(page.locator('.document-meta-view')).toBeVisible();
  await expect(page.locator('#editorTree')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open chat' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open search' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Populate Missing' }).click();

  await expect(page.locator('.description-progress-modal')).toBeVisible();
  await expect(page.locator('.description-progress-modal')).toContainText(/0 of 2|1 of 2|2 of 2/);
  await expect(page.locator('.description-progress-modal')).toContainText('Last generated');
  await expect(page.locator('.description-progress-modal')).toContainText('Profile area');
  await expect(page.locator('.description-progress-modal')).toContainText('1 component skipped');
  await expect(page.locator('.meta-panel')).toContainText('Generated 2 missing descriptions.');
  expect(contexts).toHaveLength(2);
  expect(contexts[1]).toContain('Profile - Profile area');
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('"description":"Profile area"');
  await expect(page.locator('#rawEditor')).toContainText('"description":"Profile summary list"');
  await expect(page.locator('#rawEditor')).not.toContainText('Summary body","description"');
});

test('resume template shows friendly empty component-list add prompts before activation', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();

  await expect(page.locator('.editor-block-passive .ghost-label', { hasText: 'Add Skill' }).first()).toBeVisible();
  await expect(page.locator('.editor-block-passive .ghost-label', { hasText: 'Add Tool / Tech' }).first()).toBeVisible();
});

test('resume template spaces stacked location labels from block css', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();

  const locationBlock = page.locator('.reader-block-text', { hasText: 'Target Location(s)' }).first();
  await expect(locationBlock).toHaveCSS('white-space', 'pre-line');

  const labels = locationBlock.locator('strong');
  await expect(labels).toHaveCount(2);

  const firstBox = await labels.nth(0).boundingBox();
  const secondBox = await labels.nth(1).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(secondBox!.y - (firstBox!.y + firstBox!.height)).toBeGreaterThan(1);
});

test('custom component templates open a fill modal before editor insertion', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: card-record
    baseType: container
    schema:
      containerBlocks:
        - text: "{% title %}"
          schema:
            component: text
            placeholder: Title
        - text: "{% details | block %}"
          schema:
            component: text
            placeholder: Details
---

<!--hvy: {"id":"cards"}-->
#! Cards

<!--hvy:component-list {"id":"card-list","componentListComponent":"card-record"}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.ghost-label', { hasText: 'Add Card' }).click();
  const modal = page.locator('.component-meta-modal', { hasText: 'card-record' });
  await expect(modal).toBeVisible();
  await expect(modal.locator('input[data-template-variable="title"]')).toBeVisible();
  await expect(modal.locator('textarea[data-template-variable="details"]')).toBeVisible();

  await modal.locator('input[data-template-variable="title"]').fill('Launch Notes');
  await modal.locator('textarea[data-template-variable="details"]').fill('Line one\nLine two');
  await modal.getByRole('button', { name: 'Insert' }).click();

  const inserted = page.locator('.editor-block', { hasText: 'card-record' });
  await expect(inserted.locator('.editor-block-passive', { hasText: 'Launch Notes' })).toBeVisible();
  await expect(inserted.locator('.editor-block-passive', { hasText: 'Line one' })).toBeVisible();
});

test('custom component template modal cancel leaves the document unchanged', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: card-record
    baseType: text
    schema:
      id: "{% title %}"
      placeholder: Card title
---

<!--hvy: {"id":"cards"}-->
#! Cards

<!--hvy:component-list {"id":"card-list","componentListComponent":"card-record"}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.ghost-label', { hasText: 'Add Card' }).click();
  const modal = page.locator('.component-meta-modal', { hasText: 'card-record' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.reader-block-text', { hasText: 'Card title' })).toHaveCount(0);
});

test('text component fenced python code is syntax highlighted', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"code-sample"}-->
#! Code Sample

<!--hvy:text {"id":"python-example"}-->
\`\`\`python
def greet(name):
    return f"hello {name}"
\`\`\`
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const code = page.locator('.reader-code-block code.language-python').first();
  await expect(code).toBeVisible();
  const defKeyword = code.locator('.hljs-keyword', { hasText: 'def' }).first();
  const functionTitle = code.locator('.hljs-title.function_', { hasText: 'greet' }).first();
  await expect(defKeyword).toBeVisible();
  await expect(functionTitle).toBeVisible();
  await expect(code.locator('.hljs-keyword', { hasText: 'return' })).toBeVisible();
  await expect.poll(async () => ({
    keyword: await defKeyword.evaluate((node) => getComputedStyle(node).color),
    functionTitle: await functionTitle.evaluate((node) => getComputedStyle(node).color),
  })).toMatchObject({
    keyword: expect.not.stringMatching(/^$/),
    functionTitle: expect.not.stringMatching(/^$/),
  });
  expect(await defKeyword.evaluate((node) => getComputedStyle(node).color)).not.toBe(
    await functionTitle.evaluate((node) => getComputedStyle(node).color)
  );
});

test('trailing spaces after bold labels remain editable outside bold text', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"locations"}-->
#! Locations

 <!--hvy:text {"css":"margin: 0.5rem 0; line-height: 1.5;","lock":true}-->
  **Location:** 

  **Target Location(s):** 
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Location:' }).click();

  const editor = page.locator('.rich-editor').first();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('Location:');
  await expect(editor).toContainText('Target Location(s):');
  await expect(editor.locator('p').first()).toHaveJSProperty('innerHTML', '<strong>Location:</strong>&nbsp;');

  await editor.evaluate((node) => {
    const paragraph = node.querySelector('p');
    const trailingSpace = paragraph?.lastChild;
    if (!paragraph || !trailingSpace) {
      throw new Error('Expected trailing editable space after Location label.');
    }
    const range = document.createRange();
    range.setStart(trailingSpace, trailingSpace.textContent?.length ?? 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.type('Seattle, WA');

  await expect(editor.locator('p').first().locator('strong')).toHaveText('Location:');
  await expect(editor.locator('p').first()).toContainText('Location: Seattle, WA');

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('**Location:** Seattle, WA');
});
