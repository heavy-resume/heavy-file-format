import { expect, test } from '@playwright/test';

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
