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

test('responsive preview controls resize only the document surface', async ({ page }) => {
  await page.goto('/');

  const surface = page.locator('.hvy-surface').first();
  const pane = page.locator('.full-pane').first();
  const initialPaneWidth = (await pane.boundingBox())?.width ?? 0;

  await page.getByRole('button', { name: 'Phone 390' }).click();
  await expect.poll(async () => Math.round((await surface.boundingBox())?.width ?? 0)).toBe(390);
  expect(Math.round((await pane.boundingBox())?.width ?? 0)).toBe(Math.round(initialPaneWidth));

  await page.getByRole('button', { name: 'Tablet 768' }).click();
  await expect.poll(async () => Math.round((await surface.boundingBox())?.width ?? 0)).toBe(768);
  expect(Math.round((await pane.boundingBox())?.width ?? 0)).toBe(Math.round(initialPaneWidth));
});

test('responsive preview applies container query defaults', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  await editor.evaluate((node) => {
    node.innerHTML =
      '<p><span class="hvy-short" data-hvy-short="true"><span class="hvy-short-full">Tools &amp; Technologies</span><span class="hvy-short-value">Tools &amp; Tech</span></span></p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  await expect(editor.locator('.hvy-short-full')).toBeVisible();
  await expect(editor.locator('.hvy-short-value')).toBeHidden();

  await page.getByRole('button', { name: 'Phone 390' }).click();
  await expect(editor.locator('.hvy-short-full')).toBeHidden();
  await expect(editor.locator('.hvy-short-value')).toBeVisible();
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
  await expect(metaModal.locator('[data-field="block-description"]')).toHaveValue(/empty-description - text .* Empty description body/);
  await expect(activeBlock).toHaveAttribute('data-active-editor-block', 'true');

  await page.getByRole('button', { name: 'Close' }).click();
  await activeBlock.getByRole('button', { name: 'Done' }).click();
  await page.locator('.editor-block-passive', { hasText: 'Filled description body' }).click();
  await page.locator('.editor-block[data-active-editor-block="true"]').getByRole('button', { name: 'Meta' }).click();
  await expect(page.locator('.component-meta-modal', { hasText: 'Component Meta: text' }).locator('[data-action="generate-block-description"]')).toHaveCount(0);
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
