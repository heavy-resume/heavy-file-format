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

test('toolbar exposes quote and code block actions', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Quoted</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByRole('button', { name: 'Quote' }).first().click();
  await expect(editor.locator('blockquote')).toContainText('Quoted');

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
  await page.getByRole('button', { name: 'Code' }).first().click();
  await expect(editor.locator('pre code')).toHaveCount(1);
});

test('section add component affordance is a compact single row', async ({ page }) => {
  await page.goto('/');

  const addComponent = page.locator('[data-action="add-block"]').first();
  const box = await addComponent.boundingBox();

  await expect(addComponent).toContainText('+');
  await expect(addComponent).toContainText('Add Component');
  await expect(addComponent.locator('select')).toHaveCount(0);
  expect(box?.height ?? 0).toBeLessThanOrEqual(42);
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
