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

test('inline code shortcut stops formatting after the closing backtick', async ({ page }) => {
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
  await page.keyboard.type('Use `code` after');

  await expect(editor.locator('code')).toHaveText('code');
  await expect(editor.locator('code')).not.toContainText('after');
  await expect(editor).toContainText('Use code after');
});

test('typing at the end of inline code exits code formatting', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Use <code>study-tools</code></p>';
    const code = node.querySelector('code')!;
    const textNode = code.firstChild!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await editor.focus();
  await page.keyboard.type(' after');

  await expect(editor.locator('code')).toHaveText('study-tools');
  await expect(editor.locator('code')).not.toContainText('after');
  await expect(editor).toContainText('Use study-tools after');
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

test('pasting fenced code inside a code block inserts literal text without nesting', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<pre data-code-language="json"><code class="language-json" contenteditable="true">before</code></pre>';
    const textNode = node.querySelector('code')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, textNode!.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node.querySelector('code') as HTMLElement | null)?.focus();
  });

  const expectedResult = await editor.evaluate((node) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', '```ts\nconst value = 1;\n```');
    const beforeInputEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPaste',
      dataTransfer,
    });
    node.dispatchEvent(beforeInputEvent);
    return {
      defaultPrevented: beforeInputEvent.defaultPrevented,
      codeText: node.querySelector('code')?.textContent,
      preCount: node.querySelectorAll('pre').length,
    };
  });

  expect(expectedResult).toEqual({
    defaultPrevented: true,
    codeText: 'before```ts\nconst value = 1;\n```',
    preCount: 1,
  });
  await expect(editor.locator('pre')).toHaveCount(1);
  await expect(editor.locator('code').first()).toHaveText('before```ts\nconst value = 1;\n```');
});

test('rich code block language field updates serialized fence language', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    const sectionKey = node.dataset.sectionKey ?? '';
    const blockId = node.dataset.blockId ?? '';
    node.innerHTML = `<div class="rich-code-block-shell"><label class="rich-code-language-control" contenteditable="false"><span>Language</span><input type="text" data-field="rich-code-language" data-section-key="${sectionKey}" data-block-id="${blockId}" value=""></label><pre data-code-language="" contenteditable="false"><code contenteditable="true">const value = 1;</code></pre></div>`;
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = node.querySelector('code')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, textNode!.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  const languageInput = editor.locator('.rich-code-language-control input').first();
  await expect(languageInput).toBeVisible();
  await languageInput.fill('ts');

  const expectedResult = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return {
      text: state.document.sections[0]?.blocks[0]?.text,
      dataLanguage: document.querySelector('.rich-editor pre')?.getAttribute('data-code-language'),
      codeClass: document.querySelector('.rich-editor pre code')?.getAttribute('class'),
      activeField: (document.activeElement as HTMLElement | null)?.dataset.field ?? '',
    };
  });

  expect(expectedResult).toEqual({
    text: '```ts\nconst value = 1;\n```',
    dataLanguage: 'ts',
    codeClass: 'language-ts',
    activeField: 'rich-code-language',
  });
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

test('code block Enter suppresses the follow-up paragraph input', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  const expectedResult = await editor.evaluate((node) => {
    node.innerHTML = '<pre data-code-language="python"><code class="language-python" contenteditable="true">first</code></pre>';
    const code = node.querySelector('code')!;
    const textNode = code.firstChild!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    code.focus();

    const keydownEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    });
    code.dispatchEvent(keydownEvent);

    const beforeInputEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertParagraph',
    });
    code.dispatchEvent(beforeInputEvent);

    return {
      beforeInputPrevented: beforeInputEvent.defaultPrevented,
      codeText: code.textContent,
      keydownPrevented: keydownEvent.defaultPrevented,
      newlineCount: (code.textContent?.match(/\n/g) ?? []).length,
    };
  });

  expect(expectedResult).toEqual({
    beforeInputPrevented: true,
    codeText: 'first\n\u200b',
    keydownPrevented: true,
    newlineCount: 1,
  });
});

test('tab and shift tab indent fenced code inside the text editor by two spaces', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<pre data-code-language="js"><code class="language-js" contenteditable="true">alpha\n  beta</code></pre>';
    const code = node.querySelector('code')!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(code);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await page.keyboard.press('Tab');

  await expect(editor.locator('pre code')).toHaveText('  alpha\n    beta');

  await page.keyboard.press('Shift+Tab');

  await expect(editor.locator('pre code')).toHaveText('alpha\n  beta');

  await editor.evaluate((node) => {
    const textNode = node.querySelector('code')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 5);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await page.keyboard.press('Tab');

  await expect(editor.locator('pre code')).toHaveText('alpha  \n  beta');
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
