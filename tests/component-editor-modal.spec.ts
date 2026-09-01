import { expect, test } from '@playwright/test';

test('narrow nested component editors use stacked modal contexts with fixed actions', async ({ page }) => {
  test.setTimeout(5_000);
  page.setDefaultTimeout(1_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:grid {"id":"outer-grid","gridColumns":3,"gridStackWidth":"never"}-->
  <!--hvy:grid:0 {"id":"outer-first"}-->
   <!--hvy:grid {"id":"inner-grid","gridColumns":3,"gridStackWidth":"never"}-->
    <!--hvy:grid:0 {"id":"inner-first"}-->
     <!--hvy:text {"id":"nested-text"}-->
      Nested expected result

    <!--hvy:grid:1 {"id":"inner-second"}-->
     <!--hvy:text {}-->
      Second

    <!--hvy:grid:2 {"id":"inner-third"}-->
     <!--hvy:text {}-->
      Third

  <!--hvy:grid:1 {"id":"outer-second"}-->
   <!--hvy:text {}-->
    Outer second

  <!--hvy:grid:2 {"id":"outer-third"}-->
   <!--hvy:text {}-->
    Outer third
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.getByRole('button', { name: 'Phone 390' }).click();
  await page.locator('.editor-block-passive', { hasText: 'Nested expected result' }).last().click();
  await page.locator('.editor-block-passive', { hasText: 'Outer second' }).last().dispatchEvent('click');

  const innerEdit = page.getByRole('button', { name: 'Edit grid' });
  await expect(innerEdit).toBeVisible();
  const preview = await innerEdit.locator('..').evaluate((gate) => {
    const content = gate.querySelector<HTMLElement>(':scope > .component-editor-inline-content');
    if (!content) return null;
    return {
      gateWidth: gate.getBoundingClientRect().width,
      gateCenterX: gate.getBoundingClientRect().left + (gate.getBoundingClientRect().width / 2),
      gateCenterY: gate.getBoundingClientRect().top + (gate.getBoundingClientRect().height / 2),
      contentWidth: content.getBoundingClientRect().width,
      contentCenterX: content.getBoundingClientRect().left + (content.getBoundingClientRect().width / 2),
      contentCenterY: content.getBoundingClientRect().top + (content.getBoundingClientRect().height / 2),
      contentDisplay: getComputedStyle(content).display,
      inert: content.hasAttribute('inert'),
      ariaHidden: content.getAttribute('aria-hidden'),
    };
  });
  expect(preview).not.toBeNull();
  expect(preview!.gateWidth).toBeLessThan(300);
  expect(preview!.contentWidth).toBeGreaterThanOrEqual(299);
  expect(Math.abs(preview!.contentCenterX - preview!.gateCenterX)).toBeLessThan(1);
  expect(Math.abs(preview!.contentCenterY - preview!.gateCenterY)).toBeLessThan(1);
  expect(preview!.contentDisplay).toBe('block');
  expect(preview!.inert).toBe(true);
  expect(preview!.ariaHidden).toBe('true');
  await innerEdit.click();

  const modal = page.getByRole('dialog', { name: 'Edit grid' });
  await expect(modal).toBeVisible();
  await expect(modal.locator('.component-editor-modal-actions').getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(modal.locator('.component-editor-modal-actions').getByRole('button', { name: 'Done' })).toBeVisible();
  await expect(modal.locator('.grid-item-component-label')).toHaveCount(0);

  await page.evaluate(async () => {
    const { getRenderApp } = await import('/src/state.ts');
    getRenderApp()();
  });
  await expect(page.getByRole('dialog', { name: 'Edit grid' })).toBeVisible();

  const nestedEdit = page.getByRole('dialog', { name: 'Edit grid' }).getByRole('button', { name: 'Edit text' });
  await expect(nestedEdit).toBeVisible();
  await nestedEdit.click();

  await expect(page.getByRole('dialog', { name: 'Edit text' })).toBeVisible();
  const contexts = page.locator('.component-editor-modal-context-item');
  await expect(contexts).toHaveCount(1);
  await expect(contexts.nth(0)).toHaveText(/grid/);
  await contexts.nth(0).click();
  await expect(page.getByRole('dialog', { name: 'Edit grid' })).toBeVisible();
  await page.locator('.component-editor-modal-actions').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.component-editor-modal-root')).toHaveCount(0);
  const reopenedGrid = page.getByRole('button', { name: 'Edit grid' });
  await expect(reopenedGrid).toBeVisible();
  await expect(reopenedGrid.locator('xpath=ancestor::*[@data-active-editor-block="true"][1]')).toHaveCount(1);
});

test('component editor modal body scrolls while Cancel and Done remain outside it', async ({ page }) => {
  test.setTimeout(5_000);
  page.setDefaultTimeout(1_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:grid {"id":"long-grid","gridColumns":2,"gridStackWidth":"never"}-->
  <!--hvy:grid:0 {"id":"long-cell"}-->
   <!--hvy:text {"id":"long-text"}-->
${Array.from({ length: 80 }, (_, index) => `    Expected result line ${index + 1}`).join('\n\n')}

  <!--hvy:grid:1 {"id":"short-cell"}-->
   <!--hvy:text {}-->
    Short
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.getByRole('button', { name: 'Phone 390' }).click();
  await page.locator('.reader-grid-cell > .editor-block-passive', { hasText: 'Expected result line 1' }).last().click();
  await page.getByRole('button', { name: 'Edit text' }).click();

  const modal = page.getByRole('dialog', { name: 'Edit text' });
  const result = await modal.evaluate((panel) => {
    const body = panel.querySelector<HTMLElement>('.component-editor-modal-body');
    const actions = panel.querySelector<HTMLElement>('.component-editor-modal-actions');
    if (!body || !actions) return null;
    body.scrollTop = body.scrollHeight;
    return {
      bodyScrollable: body.scrollHeight > body.clientHeight,
      bodyScrollTop: body.scrollTop,
      actionsVisible: actions.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom,
      actionsInsideBody: body.contains(actions),
    };
  });
  expect(result).toEqual({
    bodyScrollable: true,
    bodyScrollTop: expect.any(Number),
    actionsVisible: true,
    actionsInsideBody: false,
  });
  expect(result!.bodyScrollTop).toBeGreaterThan(0);
  const editorTree = page.locator('#editorTree');
  await editorTree.evaluate((element) => {
    element.scrollTop = Math.min(element.scrollHeight - element.clientHeight, element.scrollTop + 120);
  });
  const scrollTopBeforeCancel = await editorTree.evaluate((element) => element.scrollTop);
  await modal.locator('.component-editor-modal-actions').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.component-editor-modal-root')).toHaveCount(0);
  const reopenedText = page.getByRole('button', { name: 'Edit text' });
  await expect(reopenedText).toBeVisible();
  await expect(reopenedText.locator('xpath=ancestor::*[@data-active-editor-block="true"][1]')).toHaveCount(1);
  await expect.poll(async () => Math.abs(
    await editorTree.evaluate((element) => element.scrollTop) - scrollTopBeforeCancel
  )).toBeLessThanOrEqual(2);
});
