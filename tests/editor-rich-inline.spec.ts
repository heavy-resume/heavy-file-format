import { expect, test } from '@playwright/test';

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

test('rich editor wraps long text without expanding its block', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 720 });
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const block = page.locator('.editor-block').first();

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

  const widthBefore = await block.evaluate((node) => node.getBoundingClientRect().width);
  await page.keyboard.type('supercalifragilisticexpialidocious'.repeat(8));
  const widthAfter = await block.evaluate((node) => node.getBoundingClientRect().width);

  expect(widthAfter).toBeLessThanOrEqual(widthBefore + 1);
  await expect(editor.locator('p')).toHaveCSS('overflow-wrap', 'anywhere');
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

test('code button wraps selected text as inline code and preserves angle brackets', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Use &lt;tag&gt; now</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 4);
    range.setEnd(textNode!, 9);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.getByRole('button', { name: 'Code block' }).first().click();

  await expect(editor.locator('p code')).toHaveText('<tag>');
  await expect(editor.locator('p')).toHaveText('Use <tag> now');
  await expect(editor.locator('pre')).toHaveCount(0);

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('Use `<tag>` now');
  await page.getByRole('button', { name: 'Basic' }).click();
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
