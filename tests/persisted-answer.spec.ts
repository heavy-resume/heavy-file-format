import { expect, test, type Page } from '@playwright/test';

/**
 * Waits until the active block stops re-rendering. Coordinates measured while the block is
 * still settling can point outside the text area — at the Done button, for instance — so
 * the click lands on the wrong element entirely.
 */
async function waitForActiveBlockIdle(page: Page, quietMs = 250): Promise<void> {
  await page.locator('.editor-block[data-active-editor-block="true"]').first()
    .evaluate((root, quiet) => new Promise<void>((resolve) => {
      let timer = window.setTimeout(finish, quiet as number);
      const observer = new MutationObserver(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(finish, quiet as number);
      });
      function finish(): void {
        observer.disconnect();
        resolve();
      }
      observer.observe(root, { subtree: true, childList: true, attributes: true });
    }), quietMs);
}

test('survey example presents persisted single and multiple answers', async ({ page }) => {
  await page.goto('/');
  await page.locator('.document-menu').evaluate((menu) => {
    if (menu instanceof HTMLDetailsElement) menu.open = true;
  });
  await page.locator('.document-menu-panel').getByRole('button', { name: 'Survey Example', exact: true }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  await expect(page.getByLabel('Download file name')).toHaveValue('survey.hvy');
  const reader = page.locator('#readerDocument');
  await expect(reader.getByRole('radio')).toHaveCount(7);
  await expect(reader.getByRole('checkbox')).toHaveCount(7);
  const firstRatingBounds = await reader.getByRole('radio').nth(0).locator('..').boundingBox();
  const secondRatingBounds = await reader.getByRole('radio').nth(1).locator('..').boundingBox();
  if (!firstRatingBounds || !secondRatingBounds) throw new Error('Survey rating rows were not measurable.');
  expect(secondRatingBounds.y - (firstRatingBounds.y + firstRatingBounds.height)).toBeLessThanOrEqual(1);
  const goodRadio = reader.getByRole('radio').nth(1);
  await expect(goodRadio).toHaveCSS('appearance', 'none');
  await expect(goodRadio).toHaveCSS('border-radius', '50%');
  expect(await goodRadio.evaluate((input) => getComputedStyle(input, '::before').transform)).toBe('matrix(0, 0, 0, 0, 0, 0)');
  await goodRadio.check();
  await reader.getByRole('checkbox').nth(2).check();
  await reader.getByRole('checkbox').nth(3).check();
  await expect(goodRadio).toBeChecked();
  expect(await goodRadio.evaluate((input) => getComputedStyle(input, '::before').transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
  await expect(reader.getByRole('checkbox').nth(2)).toBeChecked();
  await expect(reader.getByRole('checkbox').nth(3)).toBeChecked();

  const textResponses = reader.locator('.hvy-editable-text-reader [data-field="hvy-plugin-text-editor"]');
  await expect(textResponses).toHaveCount(2);
  await expect(textResponses.first()).toHaveAttribute(
    'data-placeholder',
    'Share the practices, decisions, or moments that helped the project succeed.'
  );
  await textResponses.first().click();
  await page.keyboard.type('Clear ownership helped the team move quickly.');
  await expect(textResponses.first()).toBeFocused();

  const expectedResult = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections
      .flatMap((section) => section.blocks)
      .find((block) => block.schema.id === 'positive-feedback')?.text;
  });
  expect(expectedResult).toBe('Clear ownership helped the team move quickly.');
});

test('survey editable text preserves reader scroll while typing', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 520 });
  await page.goto('/');
  await page.locator('.document-menu').evaluate((menu) => {
    if (menu instanceof HTMLDetailsElement) menu.open = true;
  });
  await page.locator('.document-menu-panel').getByRole('button', { name: 'Survey Example', exact: true }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  const readerPane = page.locator('.reader-pane');
  const editor = page.locator('#readerDocument .hvy-editable-text-reader [data-field="hvy-plugin-text-editor"]').last();
  await editor.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await editor.click();
  const scrollBefore = await readerPane.evaluate((node) => node.scrollTop);
  const topBefore = await editor.evaluate((node) => node.getBoundingClientRect().top);

  await page.keyboard.type('Typing should stay put.');

  await expect(editor).toBeFocused();
  expect(await readerPane.evaluate((node) => node.scrollTop)).toBe(scrollBefore);
  expect(await editor.evaluate((node) => node.getBoundingClientRect().top)).toBe(topBefore);
});

test('the answer type popover converts a run without answering it', async ({ page }) => {
  await page.goto('/');
  await page.locator('.document-menu').evaluate((menu) => {
    if (menu instanceof HTMLDetailsElement) menu.open = true;
  });
  await page.locator('.document-menu-panel').getByRole('button', { name: 'Survey Example', exact: true }).click();

  await page.locator('.editor-block-passive', { hasText: 'Excellent' }).click();
  const activeEditor = page.locator('.editor-block[data-active-editor-block="true"] .rich-editor');
  await expect(activeEditor.locator('input[type="radio"]')).toHaveCount(4);

  await activeEditor.locator('input[type="radio"]').nth(1).click();

  const popover = page.getByRole('dialog', { name: 'Selected answer block type' });
  await expect(popover).toBeVisible();
  await expect(activeEditor.locator('input[type="radio"]').nth(1)).not.toBeChecked();

  await popover.locator('[data-answer-type="checkbox"]').click();
  await expect(page.locator('.editor-block[data-active-editor-block="true"] .rich-editor input[type="checkbox"]')).toHaveCount(4);
});

test('a new radio group spans components and clears selections across them', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').evaluate((textarea, value) => {
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Raw editor textarea missing.');
    textarea.value = value;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  }, `---
hvy_version: 0.1
---

<!--hvy: {"id":"survey"}-->
#! Survey

 <!--hvy:text {"id":"preferred"}-->
  [ ] Email
  [ ] Phone

 <!--hvy:text {"id":"fallback"}-->
  [ ] Postal mail
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Email' }).first().click();
  await page.locator('.editor-block[data-active-editor-block="true"] .rich-editor input').first().click();
  const popover = page.getByRole('dialog', { name: 'Selected answer block type' });
  await popover.locator('[data-field="inline-answer-new-group"]').click();
  await popover.locator('.choice-mode-name-input').fill('contact');
  await popover.locator('.choice-mode-name-confirm').click();

  await expect(page.locator('.editor-block[data-active-editor-block="true"] .rich-editor input[type="radio"]')).toHaveCount(2);

  await page.locator('.editor-block-passive', { hasText: 'Postal mail' }).first().click();
  await page.locator('.editor-block[data-active-editor-block="true"] .rich-editor input').first().click();
  await expect(popover.locator('.choice-mode-group-option', { hasText: 'contact' })).toBeVisible();
  await popover.locator('.choice-mode-group-option', { hasText: 'contact' }).click();

  await page.getByRole('button', { name: 'Viewer' }).click();
  const radios = page.locator('#readerDocument input[type="radio"]');
  await expect(radios).toHaveCount(3);
  await radios.nth(0).check();
  await radios.nth(2).check();

  await expect(radios.nth(0)).not.toBeChecked();
  expect(await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return Object.fromEntries(
      state.document.sections.flatMap((section) => section.blocks).map((block) => [block.schema.id, block.text])
    );
  })).toEqual({
    preferred: '<!--hvy:radio-group contact-->\n( ) Email\n( ) Phone',
    fallback: '(x) Postal mail',
  });
});

test('viewer selections write through to inline checkbox and radio marker source', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').evaluate((textarea, value) => {
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Raw editor textarea missing.');
    textarea.value = value;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  }, `---
hvy_version: 0.1
---

<!--hvy: {"id":"survey"}-->
#! Survey

 <!--hvy:text {"id":"approved"}-->
  [ ] Approved

 <!--hvy:text {"id":"contact"}-->
  - (x) Email
  - ( ) Phone
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  const reader = page.locator('#readerDocument');
  await reader.locator('.hvy-inline-checkbox-line', { hasText: 'Approved' }).locator('input').check();
  await reader.locator('li', { hasText: 'Phone' }).locator('input').check();
  await expect(reader.locator('li', { hasText: 'Email' }).locator('input')).not.toBeChecked();

  expect(await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return Object.fromEntries(
      state.document.sections.flatMap((section) => section.blocks).map((block) => [block.schema.id, block.text])
    );
  })).toEqual({ approved: '[x] Approved', contact: '- ( ) Email\n- (x) Phone' });

  // Returning to the editor keeps the checkbox but drops the radio, which has no other
  // way to be deselected.
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('[x] Approved');
  await expect(page.locator('#rawEditor')).toContainText('- ( ) Email\n  - ( ) Phone');
});

test('clicking past an answer label places the caret at the end of that line', async ({ page }) => {
  await page.goto('/');
  await page.locator('.document-menu').evaluate((menu) => {
    if (menu instanceof HTMLDetailsElement) menu.open = true;
  });
  await page.locator('.document-menu-panel').getByRole('button', { name: 'Survey Example', exact: true }).click();

  await page.locator('.editor-block-passive', { hasText: 'Communication' }).click();
  await waitForActiveBlockIdle(page);
  const communicationRow = page.locator(
    '.editor-block[data-active-editor-block="true"] .hvy-inline-checkbox-line',
    { hasText: 'Communication' }
  );
  const rowBounds = await communicationRow.boundingBox();
  if (!rowBounds) throw new Error('Communication answer row was not measurable.');
  const editorBounds = await page.locator('.editor-block[data-active-editor-block="true"] .rich-editor').boundingBox();
  if (!editorBounds) throw new Error('Active answer editor was not measurable.');
  const contentRight = await communicationRow.evaluate((row) => {
    const textNode = [...row.childNodes].findLast((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim());
    if (!textNode) throw new Error('Communication label text was not measurable.');
    const range = document.createRange();
    range.selectNodeContents(textNode);
    return range.getBoundingClientRect().right;
  });
  await page.mouse.move((contentRight + editorBounds.x + editorBounds.width) / 2, rowBounds.y + rowBounds.height / 2);
  await page.mouse.down();
  const caretIsAtCommunicationEnd = await page.evaluate(() => {
    const selection = window.getSelection();
    const row = selection?.anchorNode instanceof Element
      ? selection.anchorNode.closest('.hvy-inline-checkbox-line')
      : selection?.anchorNode?.parentElement?.closest('.hvy-inline-checkbox-line');
    return Boolean(
      row
      && selection?.isCollapsed
      && selection.anchorNode === row
      && selection.anchorOffset === row.childNodes.length
    );
  });
  expect(caretIsAtCommunicationEnd).toBe(true);
  await page.mouse.up();
  await page.keyboard.type('Z');

  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections
      .flatMap((section) => section.blocks)
      .find((block) => block.schema.id === 'successful-areas')?.text;
  })).toContain('[ ] CommunicationZ');
});

test('entering editor mode clears radio selections made while reading', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').evaluate((textarea, value) => {
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Raw editor textarea missing.');
    textarea.value = value;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  }, `---
hvy_version: 0.1
---

<!--hvy: {"id":"survey"}-->
#! Survey

 <!--hvy:text {"id":"pick"}-->
  ( ) Email
  ( ) Phone

 <!--hvy:text {"id":"extras"}-->
  [ ] Send a copy
`);
  await page.getByRole('button', { name: 'Apply' }).click();

  await page.getByRole('button', { name: 'Viewer' }).click();
  await page.locator('#readerDocument input[type="radio"]').first().check();
  await page.locator('#readerDocument input[type="checkbox"]').first().check();

  const blockTexts = () => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return Object.fromEntries(
      state.document.sections.flatMap((section) => section.blocks).map((block) => [block.schema.id, block.text])
    );
  });
  expect(await blockTexts()).toEqual({ pick: '(x) Email\n( ) Phone', extras: '[x] Send a copy' });

  await page.getByRole('button', { name: 'Editor' }).click();

  await expect.poll(blockTexts).toEqual({ pick: '( ) Email\n( ) Phone', extras: '[x] Send a copy' });
});

test('the answer type popover opens for a checkbox written mid-sentence', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').evaluate((textarea, value) => {
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Raw editor textarea missing.');
    textarea.value = value;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  }, `---
hvy_version: 0.1
---

<!--hvy: {"id":"survey"}-->
#! Survey

 <!--hvy:text {"id":"terms"}-->
  Agree to terms [ ] and conditions
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Agree to terms' }).first().click();
  await page.locator('.editor-block[data-active-editor-block="true"] .rich-editor input.hvy-inline-checkbox').first().click();

  await expect(page.getByRole('dialog', { name: 'Selected answer block type' })).toBeVisible();
});

test('a radio group directive takes up no room in the editor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').evaluate((textarea, value) => {
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Raw editor textarea missing.');
    textarea.value = value;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  }, `---
hvy_version: 0.1
---

<!--hvy: {"id":"survey"}-->
#! Survey

 <!--hvy:text {"id":"grouped"}-->
  <!--hvy:radio-group contact-->
  ( ) Email
  ( ) Phone
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Email' }).first().click();
  const activeEditor = page.locator('.editor-block[data-active-editor-block="true"] .rich-editor');

  // The directive stays in the DOM so it round-trips, but it must not be laid out.
  await expect(activeEditor.locator('[data-hvy-radio-group]')).toHaveCount(1);
  expect(await activeEditor.locator('[data-hvy-radio-group]').evaluate((node) => ({
    display: getComputedStyle(node).display,
    width: node.getBoundingClientRect().width,
    height: node.getBoundingClientRect().height,
  }))).toEqual({ display: 'none', width: 0, height: 0 });

  // Both answers keep their own line, left-aligned with each other.
  const answerLines = activeEditor.locator('.hvy-inline-checkbox-line');
  await expect(answerLines).toHaveCount(2);
  const [firstLine, secondLine] = await answerLines.evaluateAll((rows) =>
    rows.map((row) => Math.round(row.getBoundingClientRect().x))
  );
  expect(firstLine).toBe(secondLine);
});
