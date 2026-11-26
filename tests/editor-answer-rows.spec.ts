import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

async function openAnswerRows(page: Page, lines: string[]): Promise<{ activeTextBlock: Locator; editor: Locator }> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:text {"id":"answer-rows"}-->
${lines.map((line) => `  ${line}`).join('\n\n')}
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive', { has: page.locator('[data-component-id="answer-rows"]') }).click();
  const activeTextBlock = page.locator('.editor-block[data-active-editor-block="true"]').first();
  const editor = activeTextBlock.locator('.rich-editor').first();
  // Activation reveals the toolbar and shifts the rows; pointer tests measure after that settles.
  await editor.evaluate((node) => new Promise<void>((resolve) => {
    node.scrollIntoView({ block: 'center' });
    let lastTop = Number.NaN;
    let stableFrames = 0;
    const check = () => {
      const top = node.getBoundingClientRect().top;
      stableFrames = top === lastTop ? stableFrames + 1 : 0;
      lastTop = top;
      if (stableFrames >= 3) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }));
  return { activeTextBlock, editor };
}

async function readAnswerRowsSource(page: Page, activeTextBlock: Locator): Promise<string> {
  await activeTextBlock.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  const raw = await page.locator('#rawEditor').inputValue();
  return raw.slice(raw.indexOf('"answer-rows"}-->') + '"answer-rows"}-->'.length).trim();
}

/** Horizontal gap between the end of `before` and the start of `after` within the same row. */
async function measureTextGap(surface: Locator, before: string, after: string): Promise<number> {
  return surface.evaluate((node, [beforeText, afterText]) => {
    const rectOf = (needle: string) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
        const index = text.data.indexOf(needle);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + needle.length);
        return range.getBoundingClientRect();
      }
      throw new Error(`Missing text: ${needle}`);
    };
    return rectOf(afterText!).left - rectOf(beforeText!).right;
  }, [before, after]);
}

async function textBounds(editor: Locator, needle: string): Promise<{ left: number; right: number; y: number }> {
  return editor.evaluate((node, text) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let current = walker.nextNode() as Text | null; current; current = walker.nextNode() as Text | null) {
      const index = current.data.indexOf(text);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(current, index);
      range.setEnd(current, index + text.length);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 };
    }
    throw new Error(`Missing text: ${text}`);
  }, needle);
}

test('expected result: a formatted run in an answer row keeps the space after it', async ({ page }) => {
  // BEFORE
  const { activeTextBlock, editor } = await openAnswerRows(page, ['[ ] _(fake optional)_ Fake task']);

  // ACTION: none, the row is rendered from source.

  // AFTER
  expect(await measureTextGap(editor, 'optional)', 'Fake task')).toBeGreaterThan(2);
  expect(await readAnswerRowsSource(page, activeTextBlock)).toBe('[ ] _(fake optional)_ Fake task');
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  expect(await measureTextGap(page.locator('.reader-block .hvy-inline-checkbox-line').first(), 'optional)', 'Fake task')).toBeGreaterThan(2);
});

test('expected result: dragging past the end of an answer row keeps the dragged text selected', async ({ page }) => {
  // BEFORE
  const { editor } = await openAnswerRows(page, ['[ ] Fake value']);
  const label = await textBounds(editor, 'Fake value');

  // ACTION
  await page.mouse.move(label.left + 2, label.y);
  await page.mouse.down();
  await page.mouse.move(label.right + 80, label.y, { steps: 4 });
  await page.mouse.up();

  // AFTER
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe('Fake value');
});

test('expected result: a drag starting past the end of an answer row selects into the next row', async ({ page }) => {
  // BEFORE
  const { editor } = await openAnswerRows(page, ['[ ] Fake first', '[ ] Fake second']);
  const first = await textBounds(editor, 'Fake first');
  const second = await textBounds(editor, 'Fake second');

  // ACTION
  await page.mouse.move(first.right + 40, first.y);
  await page.mouse.down();
  await page.mouse.move(second.right + 40, second.y, { steps: 4 });
  await page.mouse.up();

  // AFTER
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe('Fake second');
});

test('expected result: an inserted checkbox is spaced like a loaded one and saves with a separator', async ({ page }) => {
  // BEFORE
  const { activeTextBlock, editor } = await openAnswerRows(page, ['[ ] Fake loaded', 'Fake plain']);
  const plain = await textBounds(editor, 'Fake plain');
  await page.mouse.click(plain.left + 1, plain.y);
  await activeTextBlock.getByRole('button', { name: 'Show all text controls' }).first().click();

  // ACTION
  await activeTextBlock.getByRole('button', { name: 'Checkbox' }).click();

  // AFTER
  expect((await textBounds(editor, 'Fake plain')).left).toBeCloseTo((await textBounds(editor, 'Fake loaded')).left, 0);
  expect(await editor.evaluate((node) => node.contains(window.getSelection()?.anchorNode ?? null))).toBe(true);
  expect(await readAnswerRowsSource(page, activeTextBlock)).toBe('[ ] Fake loaded\n  \n  [ ] Fake plain');
});

test('expected result: rows copied from the end of a line paste onto a new line', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native clipboard shortcut coverage is chromium-only here.');
  // BEFORE
  const { activeTextBlock, editor } = await openAnswerRows(page, ['[ ] Fake first', '[ ] Fake second', '[ ] Fake third']);
  await editor.evaluate((node) => {
    const labels = [...node.querySelectorAll('.hvy-inline-checkbox-line')].map((row) => row.lastChild as Text);
    const range = document.createRange();
    range.setStart(labels[0]!, labels[0]!.length);
    range.setEnd(labels[1]!, labels[1]!.length);
    node.focus();
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  await page.keyboard.press('ControlOrMeta+C');
  await editor.evaluate((node) => {
    const label = node.querySelectorAll('.hvy-inline-checkbox-line')[2]!.lastChild as Text;
    const range = document.createRange();
    range.setStart(label, label.length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });

  // ACTION
  await page.keyboard.press('ControlOrMeta+V');

  // AFTER
  expect(await editor.evaluate((node) => [...node.children].map((row) => `${row.tagName} ${row.textContent?.trim()}`))).toEqual([
    'P Fake first',
    'P Fake second',
    'P Fake third',
    'P Fake second',
  ]);
  expect(await readAnswerRowsSource(page, activeTextBlock)).toBe(
    '[ ] Fake first\n  \n  [ ] Fake second\n  \n  [ ] Fake third\n  \n  [ ] Fake second'
  );
});
