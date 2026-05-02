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

test('expandable editor keeps stub and expanded slots unlocked without lock controls', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"expandableAlwaysShowStub":true,"expandableExpanded":false}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {}-->
    ## Summary

  <!--hvy:expandable:content {}-->

   <!--hvy:text {}-->
    Expanded detail
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { has: page.locator('.expandable-reader') }).first().evaluate((node) => {
    (node as HTMLElement).click();
  });
  const activeBlock = page.locator('.editor-block', { has: page.locator('.expand-chooser-grid') }).first();

  await expect(activeBlock.locator('[data-field="block-expandable-stub-lock"]')).toHaveCount(0);
  await expect(activeBlock.locator('[data-field="block-expandable-content-lock"]')).toHaveCount(0);

  await activeBlock.locator('[data-expandable-panel="stub"]').first().click();
  await activeBlock.locator('[data-expandable-panel="expanded"]').first().click();

  await expect(activeBlock.getByRole('button', { name: 'Expandable stub component type' })).toBeVisible();
  await expect(activeBlock.getByRole('button', { name: 'Expandable content component type' })).toBeVisible();
});

test('editor pullout help balloon lists loaded sidebar sections', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();

  const balloon = page.locator('.editor-sidebar-help-balloon');
  await expect(balloon).toBeVisible();
  await expect(balloon.locator('li')).toContainText(['Skills', 'Tools & Technologies']);
  await expect(balloon).toHaveCSS('overflow', 'auto');

  await balloon.click();
  await expect(balloon).toBeHidden();

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await expect(balloon).toBeVisible();
  await page.locator('.editor-sidebar-tab').click();
  await expect(balloon).toBeHidden();
});

test('unlocking a section schema allows removing locked child fields', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"locations","lock":true}-->
#! Locations

 <!--hvy:text {"lock":true}-->
  **Target Location(s):** Remote, Seattle
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Target Location(s)' }).click();
  let activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('[data-action="remove-block"]')).toHaveCount(0);

  await page.locator('.editor-section-head [data-action="focus-modal"]').click();
  await page.getByRole('button', { name: 'Unlock Schema' }).click();
  await page.getByRole('button', { name: 'Close' }).click();

  activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('[data-action="remove-block"]')).toBeVisible();
  await activeBlock.locator('[data-action="remove-block"]').click();
  await expect(page.locator('.editor-tree', { hasText: 'Target Location(s)' })).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Confirm deletion?' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.editor-tree', { hasText: 'Target Location(s)' })).toHaveCount(0);
});

test('component editors do not render subsection side buttons', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();

  await expect(page.locator('.editor-block[data-active-editor-block="true"] .block-nest-toggle')).toHaveCount(0);
  await expect(page.locator('.editor-section-head [data-action="toggle-section-location"]').first()).toBeVisible();
});

test('subsections do not render sidebar location buttons', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"parent"}-->
#! Parent

 <!--hvy:text {}-->
  Parent body

<!--hvy: {"id":"child"}-->
## Child

 <!--hvy:text {}-->
  Child body
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();

  await expect(page.locator('.editor-section-card:not(.editor-subsection-card) > .editor-section-head [data-action="toggle-section-location"]').first()).toBeVisible();
  await expect(page.locator('.editor-subsection-card > .editor-section-head [data-action="toggle-section-location"]')).toHaveCount(0);
});

test('component-list add prompt reveals the active edit path with staggered animation', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.locator('.editor-tree .editor-block-passive .ghost-label', { hasText: 'Add Skill' }).first().click();

  const activatingBlocks = page.locator('.editor-block.is-activating-path');
  await expect(activatingBlocks).toHaveCount(3);
  await expect(activatingBlocks.nth(0)).toHaveAttribute('style', /--editor-activation-delay: 0ms;/);
  await expect(activatingBlocks.nth(1)).toHaveAttribute('style', /--editor-activation-delay: 150ms;/);
  await expect(activatingBlocks.nth(2)).toHaveAttribute('style', /--editor-activation-delay: 300ms;/);
  await expect(page.locator('.editor-block[data-active-editor-block="true"] [contenteditable="true"]').first()).toBeVisible();
});

test('clicking a nested component-list item opens the item editor on first click', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

 <!--hvy:component-list {"id":"skills-list","componentListComponent":"text"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:text {}-->
    Python

  <!--hvy:component-list:1 {}-->

   <!--hvy:text {}-->
    TypeScript
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Python' }).last().click();

  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('.rich-editor')).toBeVisible();
  await expect(activeBlock.locator('.rich-editor')).toContainText('Python');
  await expect(activeBlock.locator('.rich-editor')).not.toContainText('TypeScript');
});

test('clicking an already revealed nested item skips activation reveal animation', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

 <!--hvy:component-list {"id":"skills-list","componentListComponent":"text"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:text {}-->
    Python

  <!--hvy:component-list:1 {}-->

   <!--hvy:text {}-->
    TypeScript
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-blocks > .editor-block-passive').first().dispatchEvent('click');
  await expect(page.locator('.editor-block[data-active-editor-block="true"] .editor-block-title')).toContainText('component-list');

  await page.locator('.editor-block-passive', { hasText: 'Python' }).last().click();

  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('.rich-editor')).toContainText('Python');
  await expect(page.locator('.editor-block.is-activating-path')).toHaveCount(0);
});

test('populated component-list hides the list component type dropdown', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"lists"}-->
#! Lists

 <!--hvy:component-list {"componentListComponent":"text"}-->

 <!--hvy:component-list {"componentListComponent":"text"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:text {}-->
    Python
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive').nth(0).click({ position: { x: 4, y: 4 } });
  let activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.getByText('List Component Type')).toBeVisible();
  await activeBlock.getByRole('button', { name: 'Done' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Python' }).first().click();
  activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('.rich-editor')).toContainText('Python');
  await expect(page.getByText('List type:')).toBeVisible();
  await expect(page.getByText('List Component Type')).toHaveCount(0);
  await expect(page.locator('[data-field="block-component-list-component"]')).toHaveCount(0);
});

test('move arrows only render when there is an adjacent target', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  let activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('[data-action="move-block-up"]')).toHaveCount(0);
  await expect(activeBlock.locator('[data-action="move-block-down"]')).toHaveCount(1);
  await activeBlock.getByRole('button', { name: 'Done' }).click();
  await page.locator('[data-action="activate-block"]').last().click();
  activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('[data-action="move-block-up"]')).toHaveCount(1);
  await expect(activeBlock.locator('[data-action="move-block-down"]')).toHaveCount(0);

  const sections = page.locator('.editor-tree > .editor-tree-body > .editor-section-card');
  await expect(sections.first().locator(':scope > .editor-section-head [data-action="move-section-up"]')).toHaveCount(0);
  await expect(sections.first().locator(':scope > .editor-section-head [data-action="move-section-down"]')).toHaveCount(0);

  await page.locator('[data-action="add-top-level-section"]').click();

  await expect(sections.first().locator(':scope > .editor-section-head [data-action="move-section-up"]')).toHaveCount(0);
  await expect(sections.first().locator(':scope > .editor-section-head [data-action="move-section-down"]')).toHaveCount(1);
  await expect(sections.last().locator(':scope > .editor-section-head [data-action="move-section-up"]')).toHaveCount(1);
  await expect(sections.last().locator(':scope > .editor-section-head [data-action="move-section-down"]')).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.locator('.editor-tree .editor-block-passive .ghost-label', { hasText: 'Add Skill' }).first().click();

  activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('[data-action="move-block-up"]')).toHaveCount(1);
  await expect(activeBlock.locator('[data-action="move-block-down"]')).toHaveCount(0);
});

test('named empty sections offer a heading ghost in editor only', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"profile"}-->
#! Profile
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const headingGhost = page.locator('.empty-section-heading-ghost');
  await expect(headingGhost).toBeVisible();
  await expect(headingGhost.locator('.empty-section-heading-watermark')).toContainText('Profile');
  await expect(headingGhost.getByRole('combobox', { name: 'Heading level' })).toHaveValue('h1');

  await headingGhost.getByRole('combobox', { name: 'Heading level' }).selectOption('h2');
  await page.locator('.section-title-passive', { hasText: 'Profile' }).click();
  await expect(page.locator('.section-title-input')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.section-title-input')).toHaveCount(0);
  await expect(headingGhost.getByRole('combobox', { name: 'Heading level' })).toHaveValue('h2');

  await page.locator('.section-title-passive', { hasText: 'Profile' }).click();
  await expect(page.locator('.section-title-input')).toBeFocused();
  await page.keyboard.press('Control+Enter');

  await expect(page.locator('.editor-block[data-active-editor-block="true"] .rich-editor h2')).toContainText('Profile');
});

test('checkbox action inserts a single inline checkbox without coercing content into a full checklist', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>First item</p><p>Second item</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByRole('button', { name: 'Checkbox' }).first().click();

  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(1);
  await expect(editor.locator('p').nth(0)).toContainText('First item');
  await expect(editor.locator('p').nth(1)).toContainText('Second item');
  await expect(editor.locator('ul, li')).toHaveCount(0);
});

test('checkbox action inserts a checkbox at the current line and backspace removes it', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.focus();
    node.innerHTML = '<p>Draft task</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByRole('button', { name: 'Checkbox' }).first().click();

  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(1);
  await expect(editor.locator('p').first()).toContainText('Draft task');

  const caret = await editor.evaluate((node) => {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    return {
      anchorText: anchorNode?.textContent ?? '',
      offset: selection?.anchorOffset ?? -1,
    };
  });
  expect(caret.anchorText.startsWith('Draft task')).toBe(true);
  expect(caret.offset).toBe(0);

  await editor.evaluate((node) => {
    node.focus();
    const textNode = Array.from(node.querySelector('p')?.childNodes ?? []).find(
      (child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').includes('Draft task')
    );
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await editor.focus();
  await page.keyboard.press('Backspace');

  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(editor.locator('p')).toHaveCount(1);
});

test('list action still creates a normal list without checkbox coercion', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Plain item</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    range.collapse(false);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await page.getByRole('button', { name: 'List' }).first().click();

  await expect(editor.locator('ul')).toHaveCount(1);
  await expect(editor.locator('li')).toHaveCount(1);
  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(0);
});

test('tab indents list items inside the rich editor', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<ul><li>Parent</li><li>Child</li></ul>';
    const textNode = node.querySelectorAll('li')[1]?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await editor.focus();
  await page.keyboard.press('Tab');

  await expect(editor.locator('ul ul li')).toContainText('Child');

  await page.getByRole('button', { name: 'Done' }).first().click();
  await expect(page.locator('.editor-block-passive').first().locator('ul ul li')).toContainText('Child');

  await page.locator('[data-action="activate-block"]').first().click();
  await expect(page.locator('.rich-editor').first().locator('ul ul li')).toContainText('Child');
});

test('markdown shortcuts create quote and code blocks in text editor', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p></p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await editor.focus();
  await page.keyboard.type('>');
  await page.keyboard.press('Space');

  await expect(editor.locator('blockquote')).toHaveCount(1);
  await expect(editor.locator('blockquote')).toHaveText('');

  await editor.evaluate((node) => {
    node.innerHTML = '<p>```json</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, textNode!.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await editor.focus();
  await page.keyboard.press('Enter');

  await expect(editor.locator('pre code.language-json')).toHaveCount(1);
  await expect(editor.locator('pre')).toHaveAttribute('data-code-language', 'json');
});

test('empty code blocks can be removed with backspace and delete', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.focus();
    node.innerHTML = '<pre data-code-language="json"><code class="language-json"></code></pre>';
    const code = node.querySelector('code');
    const textNode = document.createTextNode('');
    code!.appendChild(textNode);
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await editor.focus();
  await page.keyboard.press('Backspace');

  await expect(editor.locator('pre')).toHaveCount(0);

  await editor.evaluate((node) => {
    node.innerHTML = '<pre data-code-language="json"><code class="language-json"></code></pre>';
    const code = node.querySelector('code');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(code!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await editor.focus();
  await page.keyboard.press('Delete');

  await expect(editor.locator('pre')).toHaveCount(0);
});

test('backspace inside a non-empty code block edits text without removing the block', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<pre data-code-language="python"><code class="language-python" contenteditable="true">def python</code></pre>';
    const textNode = node.querySelector('code')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, textNode!.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await editor.focus();
  await page.keyboard.press('Backspace');

  await expect(editor.locator('pre')).toHaveCount(1);
  await expect(editor.locator('code')).toContainText('def pytho');
});

test('backspace after typing in a new code block edits text without removing the block', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p></p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await editor.focus();
  await page.keyboard.type('```python');
  await page.keyboard.press('Enter');
  await page.keyboard.type('def python');
  await page.keyboard.press('Backspace');

  await expect(editor.locator('pre')).toHaveCount(1);
  await expect(editor.locator('code')).toContainText('def pytho');
});

test('triple ticks typed inside a code block remain literal text', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<pre data-code-language="json"><code class="language-json" contenteditable="true">```</code></pre>';
    const textNode = node.querySelector('code')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, textNode!.textContent!.length);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    node.focus();
  });
  await page.keyboard.press('Enter');

  await expect(editor.locator('pre')).toHaveCount(1);
  await expect(editor.locator('code').first()).toContainText('```');
});

test('enter inside a code block inserts code newlines and shift enter exits below it', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<pre data-code-language="python"><code class="language-python" contenteditable="true">first</code></pre>';
    const textNode = node.querySelector('code')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, textNode!.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    node.focus();
  });

  await page.keyboard.press('Enter');
  await page.keyboard.type('second');

  await expect(editor.locator('pre')).toHaveCount(1);
  await expect(editor.locator('code').first()).toHaveText('first\nsecond');

  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Body');

  await expect(editor.locator('pre code')).toHaveText('first\nsecond');
  await expect(editor.locator('p').last()).toHaveText('Body');
  await expect(page.getByRole('button', { name: 'Code block' }).first()).not.toHaveClass(/secondary/);

  await editor.locator('p').last().evaluate((node) => {
    const textNode = node.firstChild!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node.closest('.rich-editor') as HTMLElement | null)?.focus();
  });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(' again');

  await expect(editor.locator('pre code')).toHaveText('first\nsecond again');
  await expect(page.getByRole('button', { name: 'Code block' }).first()).toHaveClass(/secondary/);
});

test('toolbar exposes quote and code block actions', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const quoteButton = page.getByRole('button', { name: 'Quote' }).first();
  const codeBlockButton = page.getByRole('button', { name: 'Code block' }).first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Quoted</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await quoteButton.click();
  await expect(editor.locator('blockquote')).toContainText('Quoted');
  await expect(quoteButton).toHaveClass(/secondary/);

  await quoteButton.click();
  await expect(editor.locator('blockquote')).toHaveCount(0);
  await expect(editor.locator('p')).toContainText('Quoted');
  await expect(quoteButton).not.toHaveClass(/secondary/);

  await editor.evaluate((node) => {
    node.innerHTML = '<p><br></p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await quoteButton.click();
  await page.keyboard.type('Quote typing works');
  await expect(editor.locator('blockquote')).toContainText('Quote typing works');
  await expect(quoteButton).toHaveClass(/secondary/);

  await editor.evaluate((node) => {
    node.innerHTML = '<blockquote></blockquote>';
    const quote = node.querySelector('blockquote');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(quote!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await page.keyboard.press('Backspace');
  await expect(editor.locator('blockquote')).toHaveCount(0);
  await expect(quoteButton).not.toHaveClass(/secondary/);

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Removed</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByRole('button', { name: 'Strikethrough' }).first().click();
  await expect(editor.locator('s, strike, del')).toContainText('Removed');
  await expect(page.locator('[data-rich-action="link"] .link-icon').first()).toBeEmpty();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Underlined</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByRole('button', { name: 'Underline' }).first().click();
  await expect(editor.locator('u')).toContainText('Underlined');

  await editor.evaluate((node) => {
    node.innerHTML = '<p></p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await codeBlockButton.click();
  await expect(editor.locator('pre code')).toHaveCount(1);
  await expect(editor.locator('pre')).toHaveAttribute('data-code-language', '');
  await expect(codeBlockButton).toHaveClass(/secondary/);

  await codeBlockButton.click();
  await expect(editor.locator('pre')).toHaveCount(0);
  await expect(editor.locator('p').last()).toHaveText('');
  await expect(codeBlockButton).not.toHaveClass(/secondary/);

  await editor.evaluate((node) => {
    node.innerHTML = '<pre data-code-language="js"><code class="language-js" contenteditable="true">const value = 1;</code></pre>';
    const textNode = node.querySelector('code')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, textNode!.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await codeBlockButton.click();
  await expect(editor.locator('pre')).toHaveCount(0);
  await expect(editor.locator('p')).toHaveText('const value = 1;');
  await expect(codeBlockButton).not.toHaveClass(/secondary/);
});

test('select all and backspace clears mixed rich editor content', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML =
      '<h1>Title</h1><blockquote>Quote</blockquote><pre data-code-language="js"><code class="language-js" contenteditable="true">console.log(1)</code></pre><p>Tail</p>';
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.keyboard.press('Backspace');

  await expect(editor.locator('h1, blockquote, pre')).toHaveCount(0);
  await expect(editor.locator('p')).toHaveCount(1);
  await expect(editor).toHaveText('');
});

test('select all inside first-line quote and backspace clears quote style', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const quoteButton = page.getByRole('button', { name: 'Quote' }).first();

  await editor.evaluate((node) => {
    node.innerHTML = '<blockquote>Quote first</blockquote><p>After</p>';
    const textNode = node.querySelector('blockquote')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.keyboard.press('Backspace');

  await expect(editor.locator('blockquote')).toHaveCount(0);
  await expect(editor.locator('p')).toHaveCount(2);
  await expect(quoteButton).not.toHaveClass(/secondary/);
  await expect(editor.locator('p').first()).toHaveText('');
});

test('inline toolbar buttons wrap and unwrap selected text', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  const cases = [
    { button: 'Bold', tag: 'strong' },
    { button: 'Italic', tag: 'em' },
    { button: 'Underline', tag: 'u' },
    { button: 'Strikethrough', tag: 's, strike, del' },
  ];

  for (const item of cases) {
    await editor.evaluate((node) => {
      node.innerHTML = '<p>Selected text</p>';
      const textNode = node.querySelector('p')?.firstChild;
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(textNode!);
      selection?.removeAllRanges();
      selection?.addRange(range);
      (node as HTMLElement).focus();
    });
    await page.getByRole('button', { name: item.button }).first().click();
    await expect(editor.locator(item.tag)).toContainText('Selected text');

    await editor.locator(item.tag).first().evaluate((node) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.getByRole('button', { name: item.button }).first().click();
    await expect(editor.locator(item.tag)).toHaveCount(0);
    await expect(editor).toContainText('Selected text');
  }
});

test('inline toolbar actions toggle typing mode at a collapsed caret', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const boldButton = page.getByRole('button', { name: 'Bold' }).first();
  const italicButton = page.getByRole('button', { name: 'Italic' }).first();
  const underlineButton = page.getByRole('button', { name: 'Underline' }).first();
  const strikethroughButton = page.getByRole('button', { name: 'Strikethrough' }).first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p><br></p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await boldButton.click();
  await expect(boldButton).toHaveClass(/secondary/);
  await page.keyboard.type('Bold');
  await expect(editor.locator('strong')).toContainText('Bold');

  await boldButton.click();
  await expect(boldButton).not.toHaveClass(/secondary/);
  await page.keyboard.type(' plain');
  await expect(editor.locator('strong')).toHaveText('Bold');
  await expect(editor).toContainText('Bold plain');

  await page.keyboard.press('Control+B');
  await expect(boldButton).toHaveClass(/secondary/);
  await page.keyboard.type(' shortcut');
  await expect(editor.locator('strong').last()).toContainText('shortcut');

  await page.keyboard.press('Control+B');
  await expect(boldButton).not.toHaveClass(/secondary/);

  await page.keyboard.press('Control+I');
  await expect(italicButton).toHaveClass(/secondary/);
  await page.keyboard.type(' italic');
  await expect(editor.locator('em')).toContainText('italic');

  await page.keyboard.press('Control+I');
  await expect(italicButton).not.toHaveClass(/secondary/);

  await editor.evaluate((node) => {
    node.innerHTML = '<p><br></p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await page.keyboard.press('Control+I');
  await page.keyboard.press('Control+U');
  await page.keyboard.type('both');
  await expect(italicButton).toHaveClass(/secondary/);
  await expect(underlineButton).toHaveClass(/secondary/);
  await page.keyboard.press('Control+I');
  await expect(italicButton).not.toHaveClass(/secondary/);
  await expect(underlineButton).toHaveClass(/secondary/);
  await page.keyboard.type(' underline-only');
  await expect(editor.locator('em')).toHaveText('both');
  await expect(editor.locator('p')).toHaveText('both underline-only');
  await expect(editor.locator('u').first()).toContainText('both');
  await expect(editor.locator('u').last()).toContainText('underline-only');
  await page.keyboard.press('Control+U');
  await expect(underlineButton).not.toHaveClass(/secondary/);

  await page.keyboard.press('Control+U');
  await expect(underlineButton).toHaveClass(/secondary/);
  await page.keyboard.type(' underline');
  await expect(editor.locator('u').last()).toContainText('underline');

  await underlineButton.click();
  await expect(underlineButton).not.toHaveClass(/secondary/);

  await strikethroughButton.click();
  await expect(strikethroughButton).toHaveClass(/secondary/);
  await page.keyboard.type(' strike');
  await expect(editor.locator('s, strike, del')).toContainText('strike');
});

test('rich toolbar preserves visible spaces while typing', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p><br></p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.keyboard.type('Hello ');
  await expect(editor).toContainText('Hello');
  await expect(editor.locator('p')).toHaveJSProperty('innerHTML', 'Hello&nbsp;');

  await page.keyboard.type('world');
  await expect(editor).toContainText('Hello world');
});

test('inline code autoformats from backticks and escapes with arrow or click', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p><br></p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.keyboard.type('Use `foobar`');
  await expect(editor.locator('p code')).toHaveText('foobar');
  await expect(editor.locator('p')).not.toContainText('`');

  await editor.locator('p code').evaluate((node) => {
    const textNode = node.firstChild!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node.parentElement?.closest('.rich-editor') as HTMLElement | null)?.focus();
  });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type(' plain');
  await expect(editor.locator('p code')).toHaveText('foobar');
  await expect(editor.locator('p')).toContainText('Use foobar plain');

  await editor.evaluate((node) => {
    node.innerHTML = '<p><code>clickme</code></p>';
    const code = node.querySelector('code')!;
    const textNode = code.firstChild!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  const codeBox = await editor.locator('p code').boundingBox();
  expect(codeBox).not.toBeNull();
  await page.mouse.click(codeBox!.x + codeBox!.width + 8, codeBox!.y + codeBox!.height / 2);
  await page.keyboard.type(' plain');
  await expect(editor.locator('p code')).toHaveText('clickme');
  await expect(editor.locator('p')).toContainText('clickme plain');
});

test('link toolbar button and keyboard shortcut open the link modal and apply links', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Link me</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.getByRole('button', { name: 'Link' }).first().click();
  await expect(page.locator('#linkInlineModal')).toHaveClass(/is-open/);
  await page.locator('#linkInlineInput').fill('https://example.com');
  await page.keyboard.press('Enter');

  await expect(editor.locator('a[href="https://example.com"]')).toContainText('Link me');

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Shortcut link</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.keyboard.press('Control+K');
  await expect(page.locator('#linkInlineModal')).toHaveClass(/is-open/);
  await page.locator('#linkInlineInput').fill('#section-id');
  await page.keyboard.press('Enter');

  await expect(editor.locator('a[href="#section-id"]')).toContainText('Shortcut link');
});

test('toolbar block style row covers text and all heading buttons', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const textButton = page.getByRole('button', { name: 'Text' }).first();

  for (const item of [
    { button: 'H1', tag: 'h1' },
    { button: 'H2', tag: 'h2' },
    { button: 'H3', tag: 'h3' },
    { button: 'H4', tag: 'h4' },
  ]) {
    const headingButton = page.getByRole('button', { name: item.button }).first();
    await editor.evaluate((node) => {
      node.innerHTML = '<p>Heading text</p>';
      const paragraph = node.querySelector('p');
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(paragraph!);
      selection?.removeAllRanges();
      selection?.addRange(range);
      (node as HTMLElement).focus();
    });

    await headingButton.click();
    await expect(editor.locator(item.tag)).toContainText('Heading text');
    await expect(headingButton).toHaveClass(/secondary/);
    await expect(textButton).not.toHaveClass(/secondary/);

    await headingButton.click();
    await expect(editor.locator('p')).toContainText('Heading text');
    await expect(textButton).toHaveClass(/secondary/);
    await expect(headingButton).not.toHaveClass(/secondary/);

    await editor.evaluate((node) => {
      node.innerHTML = '<p>ab</p>';
      const textNode = node.querySelector('p')?.firstChild;
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(textNode!, 1);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      (node as HTMLElement).focus();
    });

    await headingButton.click();
    await page.keyboard.type('X');
    await expect(editor.locator(item.tag)).toHaveText('aXb');
    await expect(headingButton).toHaveClass(/secondary/);
  }
});

test('heading enter exits to normal text and updates toolbar state', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const h1Button = page.getByRole('button', { name: 'H1' }).first();
  const textButton = page.getByRole('button', { name: 'Text' }).first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p><br></p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await h1Button.click();
  await page.keyboard.type('Heading');
  await expect(h1Button).toHaveClass(/secondary/);
  await page.keyboard.press('Enter');

  await expect(h1Button).not.toHaveClass(/secondary/);
  await expect(textButton).toHaveClass(/secondary/);
  await page.keyboard.type('Body');
  await expect(editor.locator('h1')).toHaveText('Heading');
  await expect(editor.locator('p').last()).toHaveText('Body');
});

test('empty heading buttons keep the caret available for typing', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  for (const item of [
    { button: 'H1', tag: 'h1' },
    { button: 'H2', tag: 'h2' },
    { button: 'H3', tag: 'h3' },
    { button: 'H4', tag: 'h4' },
  ]) {
    await editor.evaluate((node) => {
      node.innerHTML = '<p><br></p>';
      const paragraph = node.querySelector('p');
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(paragraph!);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      (node as HTMLElement).focus();
    });

    const headingButton = page.getByRole('button', { name: item.button }).first();
    await headingButton.click();
    await expect(headingButton).toHaveClass(/secondary/);
    await page.keyboard.type(item.button);
    await expect(editor.locator(item.tag)).toHaveText(item.button);
  }
});

test('toolbar alignment buttons update alignment and selected state', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();

  for (const item of [
    { button: 'Align center', value: 'center' },
    { button: 'Align right', value: 'right' },
    { button: 'Align left', value: 'left' },
  ]) {
    await page.getByRole('button', { name: item.button }).first().click();
    const button = page.getByRole('button', { name: item.button }).first();
    await expect(button).toHaveClass(/secondary/);
    await expect(page.locator('.rich-editor').first()).toHaveAttribute('style', new RegExp(`text-align: ${item.value}`));
    await expect(page.locator('.rich-editor').first()).toBeFocused();
  }
});

test('toolbar buttons expose platform hotkeys in titles', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();

  await expect(page.getByRole('button', { name: 'Bold' }).first()).toHaveAttribute('title', /Bold \((Cmd|Ctrl)\+B\)/);
  await expect(page.getByRole('button', { name: 'Italic' }).first()).toHaveAttribute('title', /Italic \((Cmd|Ctrl)\+I\)/);
  await expect(page.getByRole('button', { name: 'Underline' }).first()).toHaveAttribute('title', /Underline \((Cmd|Ctrl)\+U\)/);
  await expect(page.getByRole('button', { name: 'Link' }).first()).toHaveAttribute('title', /Link \((Cmd|Ctrl)\+K\)/);
});


test('section add component affordance is a compact single row', async ({ page }) => {
  await page.goto('/');

  const addComponent = page.locator('.compact-add-component-ghost').first();
  const box = await addComponent.boundingBox();

  await expect(addComponent).toContainText('+');
  await expect(addComponent.locator('select')).toHaveCount(0);
  expect(box?.height ?? 0).toBeLessThanOrEqual(46);
});

test('component picker opens categories and adds selected component', async ({ page }) => {
  await page.goto('/');

  const addComponent = page.locator('.compact-add-component-ghost').first();
  await addComponent.getByRole('button', { name: 'Section component type' }).click();

  const picker = addComponent.locator('.component-picker-popover');
  const rootPane = picker.locator('.component-picker-pane-root');
  await expect(rootPane.locator('.component-picker-row-title', { hasText: 'Text' })).toBeVisible();
  await expect(rootPane.locator('.component-picker-row-title', { hasText: 'Image' })).toBeVisible();
  await expect(rootPane.locator('.component-picker-row-title', { hasText: 'Table' })).toBeVisible();
  await expect(rootPane.locator('.component-picker-row-title', { hasText: 'Containers' })).toBeVisible();
  await expect(rootPane.locator('.component-picker-row-title', { hasText: 'Custom' })).toBeVisible();
  await expect(rootPane.locator('.component-picker-row-title', { hasText: 'Plugin' })).toBeVisible();
  await expect(rootPane.locator('.component-picker-row-direct[data-component="text"] .component-picker-row-description')).toBeHidden();
  await rootPane.locator('.component-picker-row-direct[data-component="text"]').hover();
  await expect(rootPane.locator('.component-picker-row-direct[data-component="text"] .component-picker-row-description')).toBeVisible();

  await picker.locator('.component-picker-row-category', { hasText: 'Containers' }).click();
  await expect(picker.locator('[data-picker-pane="containers"] .component-picker-row-title', { hasText: 'Container' })).toBeVisible();
  await addComponent.getByRole('button', { name: 'Section component type' }).click();
  await expect(rootPane.locator('.component-picker-row-title', { hasText: 'Text' })).toBeVisible();
  await expect(picker.locator('[data-picker-pane="containers"] .component-picker-row-title', { hasText: 'Container' })).toBeHidden();
  await rootPane.click({ position: { x: 112, y: 112 } });
  await expect(picker).toBeHidden();
  await addComponent.getByRole('button', { name: 'Section component type' }).click();

  await picker.locator('.component-picker-row-category', { hasText: 'Plugin' }).click();
  await expect(picker.locator('[data-picker-pane="plugins"] .component-picker-row-title', { hasText: 'DB Table' })).toBeVisible();
  await addComponent.getByRole('button', { name: 'Section component type' }).click();

  await picker.locator('.component-picker-row-direct[data-component="text"]').click();

  await expect(page.locator('.editor-block .rich-editor').first()).toBeVisible();
});

test('component picker adds a selected plugin directly', async ({ page }) => {
  await page.goto('/');

  const addComponent = page.locator('.compact-add-component-ghost').first();
  await addComponent.getByRole('button', { name: 'Section component type' }).click();

  const picker = addComponent.locator('.component-picker-popover');
  await picker.locator('.component-picker-row-category', { hasText: 'Plugin' }).click();
  await picker.locator('[data-picker-pane="plugins"] .component-picker-row-title', { hasText: 'DB Table' }).click();

  await expect(page.locator('.editor-block-title', { hasText: 'DB Table' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use Plugin' })).toHaveCount(0);
});

test('markdown editor auto-upgrades raw task markers', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p></p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await editor.click();
  await page.keyboard.type('[ ] Draft task');

  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(1);
  await expect(editor.locator('input[type="checkbox"]').first()).not.toBeChecked();

  await editor.evaluate((node) => {
    node.innerHTML = '<p></p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await editor.click();
  await page.keyboard.type('[x] Done task');

  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(1);
  await expect(editor.locator('input[type="checkbox"]').first()).toBeChecked();
});
